import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, sql as raw } from 'drizzle-orm';
import { db } from '../db/index.js';
import { games, rooms, roomPlayers, summaries, reports, users } from '../db/schema.js';
import { roomStore } from '../services/roomStore.js';
import { wsHub } from '../ws/hub.js';
import { getRoomManager } from '../services/roomManager.js';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { moderate } from '../llm/prompts.js';
import type { GameConfig } from '../engine/types.js';
import type { Action } from '../engine/engine.js';

/* ------------------------------------------------------------------ */
/* 房间路由：创建 / 加入 / 开始 / 插话 / 动作 / 暂停 / 举报               */
/* ------------------------------------------------------------------ */

const createSchema = z.object({
  gameId: z.string().min(1),
  topic: z.string().max(120).optional(),
  /** 选中的 AI 角色 key 列表，不传则按 config 默认 */
  roleKeys: z.array(z.string()).max(9).optional(),
  /** 每个角色指定模型：{ roleKey: modelId } */
  modelOverrides: z.record(z.string()).optional(),
  /** 用户是否参战 */
  joinAsPlayer: z.boolean().optional(),
  roundLimit: z.number().int().min(1).max(10).optional(),
});

export default async function roomRoutes(app: FastifyInstance) {
  /* ---------------------------------------------------------------- */
  /** 创建房间 —— 组装座位表，把 config 快照写进 rooms.config_json */
  /* ---------------------------------------------------------------- */
  app.post('/rooms', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: '参数不合法' });

    const userId = req.authUser!.sub;
    const manager = getRoomManager();
    if (manager.activeCount() >= env.MAX_CONCURRENT_ROOMS) {
      return reply.code(503).send({ error: '当前房间已满，请稍后再试' });
    }

    const rows = await db.select().from(games).where(eq(games.id, parsed.data.gameId));
    const game = rows[0];
    if (!game) return reply.code(404).send({ error: '游戏不存在' });

    const config = game.configJson as unknown as GameConfig;
    if (!config?.phases?.length) return reply.code(500).send({ error: '游戏配置损坏' });

    const me = await db.select().from(users).where(eq(users.id, userId));
    const meRow = me[0]!;

    // 1) 拼玩家表
    const maxRounds = Math.min(parsed.data.roundLimit ?? config.maxRounds, config.maxRounds);
    const effConfig: GameConfig = { ...config, maxRounds };

    const wanted = parsed.data.roleKeys?.length
      ? parsed.data.roleKeys
      : effConfig.roles.filter((r) => r.count > 0).flatMap((r) => Array(r.count).fill(r.key));

    const seats: {
      aiRoleId: string | null; isAi: boolean; name: string; avatar: string | null;
      userId: string | null; model: string | null;
    }[] = [];

    // AI 座位（按角色池展开；不够就循环取）
    const aiRoles = effConfig.roles.filter((r) => r.isAi);
    const totalAI = Math.max(effConfig.minPlayers, Math.min(wanted.length || effConfig.maxPlayers, effConfig.maxPlayers))
      - (parsed.data.joinAsPlayer ? 1 : 0);

    for (let i = 0; i < totalAI; i++) {
      const key = wanted[i % Math.max(wanted.length, 1)] ?? aiRoles[0]?.key ?? 'ai';
      const role = effConfig.roles.find((r) => r.key === key) ?? aiRoles[0]!;
      seats.push({
        aiRoleId: role.key,
        isAi: true,
        name: role.name,
        avatar: role.avatar ?? `https://api.dicebear.com/7.x/bottts/png?seed=${encodeURIComponent(role.name + i)}`,
        userId: null,
        model: parsed.data.modelOverrides?.[role.key] ?? role.model ?? null,
      });
    }

    // 用户座位（可选）
    if (parsed.data.joinAsPlayer) {
      seats.unshift({
        aiRoleId: null, isAi: false, name: meRow.nickname,
        avatar: meRow.avatar, userId, model: null,
      });
    }

    const [room] = await db.insert(rooms).values({
      gameId: game.id,
      hostId: userId,
      status: 'waiting',
      topic: parsed.data.topic?.slice(0, 120) ?? pickTopic(effConfig),
      configJson: {
        ...effConfig,
        modelOverrides: parsed.data.modelOverrides ?? {},
        hostName: meRow.nickname,
      },
      round: 0,
      phase: 'init',
    }).returning();

    await db.insert(roomPlayers).values(seats.map((s, i) => ({
      roomId: room!.id, userId: s.userId, aiRoleId: s.aiRoleId, isAi: s.isAi,
      seat: i, alive: true, name: s.name, avatar: s.avatar, model: s.model, privateJson: {},
    })));

    await roomStore.markGamePlayed(userId);
    logger.info({ roomId: room!.id, game: game.id, seats: seats.length }, '房间创建');

    return {
      roomId: room!.id,
      topic: room!.topic,
      seats: seats.map((s, i) => ({ seat: i, ...s })),
      maxRounds,
      uiSchema: game.uiSchemaJson,
    };
  });

  /* ---------------------------------------------------------------- */
  /** 开局 */
  /* ---------------------------------------------------------------- */
  app.post('/rooms/:id/start', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = req.authUser!.sub;
    const rows = await db.select().from(rooms).where(eq(rooms.id, id));
    const room = rows[0];
    if (!room) return reply.code(404).send({ error: '房间不存在' });
    if (room.hostId !== userId) return reply.code(403).send({ error: '只有房主能开局' });
    if (room.status !== 'waiting') return reply.code(409).send({ error: '这局已经开始了' });

    const manager = getRoomManager();
    await manager.create(id);
    const rt = manager.get(id);
    rt?.start();

    // 前端拉一次全量，确保 seq 对齐
    return { ok: true, status: 'running' };
  });

  /* ---------------------------------------------------------------- */
  /** 用户插话 */
  /* ---------------------------------------------------------------- */
  app.post('/rooms/:id/interject', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ text: z.string().min(1).max(300) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: '说点什么吧' });

    const mod = await moderate(body.data.text);
    if (!mod.ok) return reply.code(422).send({ error: mod.reason ?? '内容不合规' });

    const rt = getRoomManager().get(id);
    if (!rt) return reply.code(409).send({ error: '房间未在运行' });
    await rt.userSpeak(req.authUser!.sub, body.data.text);
    return { ok: true };
  });

  /* ---------------------------------------------------------------- */
  /** 用户动作（投票 / 出价 / 举证 / 反对） */
  /* ---------------------------------------------------------------- */
  app.post('/rooms/:id/action', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      kind: z.string().min(1),
      targetId: z.string().optional(),
      text: z.string().max(300).optional(),
      amount: z.number().optional(),
      option: z.string().optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: '动作不合法' });

    const rt = getRoomManager().get(id);
    if (!rt) return reply.code(409).send({ error: '房间未在运行' });
    await rt.userAction(req.authUser!.sub, { ...body.data, kind: body.data.kind as Action['kind'] });
    return { ok: true };
  });

  /* ---------------------------------------------------------------- */
  /** 暂停 / 继续 / 强制结算 */
  /* ---------------------------------------------------------------- */
  app.post('/rooms/:id/pause', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const rt = getRoomManager().get((req.params as { id: string }).id);
    if (!rt) return reply.code(409).send({ error: '房间未在运行' });
    rt.pause();
    return { ok: true, paused: true };
  });

  app.post('/rooms/:id/resume', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const rt = getRoomManager().get((req.params as { id: string }).id);
    if (!rt) return reply.code(409).send({ error: '房间未在运行' });
    rt.resume();
    return { ok: true, paused: false };
  });

  app.post('/rooms/:id/force-end', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const rt = getRoomManager().get((req.params as { id: string }).id);
    if (!rt) return reply.code(409).send({ error: '房间未在运行' });
    rt.stop();
    return { ok: true };
  });

  /* ---------------------------------------------------------------- */
  /** 退出房间 */
  /* ---------------------------------------------------------------- */
  app.post('/rooms/:id/leave', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const rt = getRoomManager().get(id);
    rt?.stop();
    getRoomManager().drop(id);
    await db.update(rooms).set({ status: 'archived' }).where(eq(rooms.id, id));
    return { ok: true };
  });

  /* ---------------------------------------------------------------- */
  /** 保存分享图 URL（客户端截图后上传，再把地址存进来） */
  /* ---------------------------------------------------------------- */
  app.post('/rooms/:id/share-image', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ url: z.string().min(1).max(500) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: '参数不合法' });

    const rows = await db.select().from(rooms).where(eq(rooms.id, id));
    if (!rows[0]) return reply.code(404).send({ error: '房间不存在' });
    if (rows[0].hostId !== req.authUser!.sub) return reply.code(403).send({ error: '只有房主能保存' });

    await db.update(summaries)
      .set({ shareImageUrl: body.data.url })
      .where(eq(summaries.roomId, id));

    return { ok: true, url: body.data.url };
  });

  /* ---------------------------------------------------------------- */
  /** 举报 */
  /* ---------------------------------------------------------------- */
  app.post('/reports', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const body = z.object({
      messageId: z.string().uuid(),
      reason: z.string().max(40).default('other'),
      detail: z.string().max(300).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: '参数不合法' });
    await db.insert(reports).values({
      messageId: body.data.messageId,
      reporterId: req.authUser!.sub,
      reason: body.data.reason,
      detail: body.data.detail ?? null,
    });
    return { ok: true, message: '已收到举报，我们会尽快处理' };
  });
}

function pickTopic(config: GameConfig): string {
  const pool = config.topicPool ?? [];
  return pool.length ? pool[Math.floor(Math.random() * pool.length)]! : config.name;
}
