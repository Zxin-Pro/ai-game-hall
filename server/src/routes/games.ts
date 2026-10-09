import type { FastifyInstance } from 'fastify';
import { eq, desc, and, sql as raw } from 'drizzle-orm';
import { db } from '../db/index.js';
import { games } from '../db/schema.js';
import { roomStore } from '../services/roomStore.js';
import { wsHub } from '../ws/hub.js';
import { logger } from '../logger.js';

export default async function gameRoutes(app: FastifyInstance) {
  /** 游戏厅列表 */
  app.get('/games', async () => {
    const rows = await db.select().from(games)
      .where(eq(games.enabled, true))
      .orderBy(games.sort);
    return {
      games: rows.map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        cover: g.cover,
        minPlayers: g.minPlayers,
        maxPlayers: g.maxPlayers,
        engineType: g.engineType,
        roles: g.rolesJson,
        roundLimit: (g.configJson as { maxRounds?: number })?.maxRounds ?? 5,
      })),
    };
  });

  /** 游戏详情：含规则 + ui schema + 可选角色 */
  app.get('/games/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await db.select().from(games).where(eq(games.id, id));
    const g = rows[0];
    if (!g) return reply.code(404).send({ error: '游戏不存在' });
    const cfg = (g.configJson ?? {}) as {
      maxRounds?: number; phases?: unknown; topicPool?: string[]; userRole?: string;
    };
    return {
      id: g.id,
      name: g.name,
      description: g.description,
      cover: g.cover,
      engineType: g.engineType,
      minPlayers: g.minPlayers,
      maxPlayers: g.maxPlayers,
      maxRounds: cfg.maxRounds ?? 5,
      userRole: cfg.userRole ?? 'spectator',
      rules: (g.rulesJson as { list?: string[] })?.list ?? [],
      roles: g.rolesJson,
      phases: cfg.phases ?? [],
      uiSchema: g.uiSchemaJson,
      topicPool: cfg.topicPool ?? [],
    };
  });

  /** 排行榜：最近完成的房间 */
  app.get('/games/:id/leaderboard', async (req) => {
    const { id } = req.params as { id: string };
    const rows = await db.execute(raw`
      SELECT r.id, r.topic, r.finished_at, s.result_json, u.nickname
      FROM rooms r
      JOIN summaries s ON s.room_id = r.id
      LEFT JOIN users u ON u.id = r.host_id
      WHERE r.game_id = ${id} AND r.status = 'finished'
      ORDER BY r.finished_at DESC LIMIT 20
    `);
    return { items: rows };
  });

  /** 全站统计，用于首页标语 */
  app.get('/stats', async () => {
    const rows = await db.execute(raw`
      SELECT
        (SELECT count(*) FROM rooms) AS rooms,
        (SELECT count(*) FROM rooms WHERE status = 'running') AS running,
        (SELECT count(*) FROM messages) AS messages,
        (SELECT count(*) FROM users) AS users
    `);
    return { ...(rows as unknown as Record<string, unknown>[])[0], ws: wsHub.stats() };
  });
}

export async function roomListRoutes(app: FastifyInstance) {
  /** 我的房间（进行中 + 最近） */
  app.get('/rooms', { preHandler: [app.requireAuth] }, async (req) => {
    const userId = req.authUser!.sub;
    const limit = Number((req.query as { limit?: string })?.limit ?? 30);
    const rows = await db.execute(raw`
      SELECT r.id, r.game_id, g.name AS game_name, r.status, r.topic, r.round, r.phase,
             r.created_at, r.finished_at,
             (SELECT count(*) FROM messages m WHERE m.room_id = r.id) AS message_count
      FROM rooms r JOIN games g ON g.id = r.game_id
      WHERE r.host_id = ${userId}
      ORDER BY (r.status = 'finished'), r.created_at DESC
      LIMIT ${limit}
    `);
    return { rooms: rows };
  });

  /** 战绩：已结束的局 + 结算卡 */
  app.get('/me/history', { preHandler: [app.requireAuth] }, async (req) => {
    const userId = req.authUser!.sub;
    const rows = await db.execute(raw`
      SELECT r.id, r.game_id, g.name AS game_name, r.topic, r.round, r.finished_at,
             s.result_json, s.share_image_url
      FROM rooms r
      JOIN games g ON g.id = r.game_id
      LEFT JOIN summaries s ON s.room_id = r.id
      WHERE r.host_id = ${userId} AND r.status = 'finished'
      ORDER BY r.finished_at DESC LIMIT 50
    `);
    return { items: rows };
  });

  /** 单个房间的状态（断线重连用） */
  app.get('/rooms/:id', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const info = await roomInfo(id);
    if (!info) return reply.code(404).send({ error: '房间不存在' });
    return info;
  });

  /** 补发消息：断线重连后拉 afterSeq 之后的内容 */
  app.get('/rooms/:id/messages', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const after = Number((req.query as { after?: string })?.after ?? 0);
    const msgs = await roomStore.loadMessages(id, after);
    if (!msgs.length) return { messages: [] };
    // 补上发送者名字
    const rows = await db.execute(raw`
      SELECT id, name, avatar, is_ai FROM room_players WHERE room_id = ${id}
    `);
    const map = new Map((rows as unknown as { id: string; name: string; avatar: string | null; is_ai: boolean }[])
      .map((r) => [r.id, r]));
    return {
      messages: msgs.map((m) => {
        const p = m.senderId ? map.get(m.senderId) : null;
        return {
          ...m,
          senderName: m.senderType === 'system' ? '系统' : (p?.name ?? m.senderName),
          avatar: p?.avatar ?? null,
          isAi: p?.is_ai ?? false,
        };
      }),
    };
  });

  /** 结算卡 */
  app.get('/rooms/:id/summary', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await db.execute(raw`
      SELECT result_json, share_image_url FROM summaries WHERE room_id = ${id}
    `);
    const row = (rows as unknown as { result_json: unknown; share_image_url: string | null }[])[0];
    if (!row) return reply.code(404).send({ error: '这局还没结算' });
    return { summary: row.result_json, shareImageUrl: row.share_image_url };
  });

  /** 回放：按回合分组的完整时间线 */
  app.get('/rooms/:id/replay', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const info = await roomInfo(id);
    if (!info) return reply.code(404).send({ error: '房间不存在' });
    const rows = await db.execute(raw`
      SELECT id, seq, sender_type, sender_id, content, round, phase, meta_json, created_at
      FROM messages WHERE room_id = ${id} AND (visible_to_json IS NULL)
      ORDER BY seq ASC LIMIT 2000
    `);
    const players = await db.execute(raw`
      SELECT id, name, avatar, ai_role_id, seat FROM room_players WHERE room_id = ${id} ORDER BY seat
    `);
    return { room: info, players, timeline: rows };
  });
}

export async function roomInfo(id: string) {
  const rows = await db.execute(raw`
    SELECT r.id, r.game_id, g.name AS game_name, g.engine_type, g.ui_schema_json,
           r.status, r.topic, r.round, r.phase, r.config_json, r.seq, r.tokens_used, r.created_at
    FROM rooms r JOIN games g ON g.id = r.game_id WHERE r.id = ${id}
  `);
  const room = (rows as unknown as Record<string, unknown>[])[0];
  if (!room) return null;
  const players = await db.execute(raw`
    SELECT id, seat, name, avatar, is_ai, alive, ai_role_id, score, user_id
    FROM room_players WHERE room_id = ${id} ORDER BY seat
  `);
  return { room, players };
}

export { logger, desc, and };
