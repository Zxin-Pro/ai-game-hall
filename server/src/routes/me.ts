import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, sql as raw } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, memories, dailyUsage, globalUsage } from '../db/schema.js';
import { env } from '../env.js';

/* ------------------------------------------------------------------ */
/* 我的：资料 / 记忆偏好 / 用量                                          */
/* ------------------------------------------------------------------ */

export default async function meRoutes(app: FastifyInstance) {
  app.get('/me', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const userId = req.authUser!.sub;
    const rows = await db.select().from(users).where(eq(users.id, userId));
    const u = rows[0];
    if (!u) return reply.code(404).send({ error: '用户不存在' });

    const usage = await db.select().from(dailyUsage)
      .where(raw`${dailyUsage.userId} = ${userId} AND ${dailyUsage.date} = CURRENT_DATE`);
    const global = await db.select().from(globalUsage)
      .where(raw`${globalUsage.date} = CURRENT_DATE`);

    return {
      user: { id: u.id, nickname: u.nickname, avatar: u.avatar, createdAt: u.createdAt },
      today: {
        gamesPlayed: usage[0]?.gamesPlayed ?? 0,
        tokensUsed: usage[0]?.tokensUsed ?? 0,
      },
      /** 只用于展示，不做任何限制 —— 完全免费，无内购 */
      note: '完全免费，不设局数上限',
      globalTokensToday: global[0]?.tokensUsed ?? 0,
    };
  });

  app.patch('/me', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const body = z.object({
      nickname: z.string().min(2).max(16).optional(),
      avatar: z.string().max(255).optional(),
      pushToken: z.string().max(255).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: '参数不合法' });
    await db.update(users).set({
      ...(body.data.nickname ? { nickname: body.data.nickname } : {}),
      ...(body.data.avatar ? { avatar: body.data.avatar } : {}),
      ...(body.data.pushToken ? { pushToken: body.data.pushToken } : {}),
    }).where(eq(users.id, req.authUser!.sub));
    return { ok: true };
  });

  /** AI 记忆偏好：我告诉 AI 的事 */
  app.get('/me/memories', { preHandler: [app.requireAuth] }, async (req) => {
    const rows = await db.select().from(memories).where(eq(memories.userId, req.authUser!.sub));
    return { memories: rows.map((r) => ({ id: r.id, key: r.key, value: r.value, createdAt: r.createdAt })) };
  });

  app.post('/me/memories', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const body = z.object({ key: z.string().min(1).max(20), value: z.string().min(1).max(200) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: '参数不合法' });
    await db.execute(raw`
      INSERT INTO memories (user_id, key, value)
      VALUES (${req.authUser!.sub}, ${body.data.key}, ${body.data.value})
      ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value
    `);
    return { ok: true };
  });

  app.delete('/me/memories/:id', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.delete(memories).where(raw`${memories.id} = ${id} AND ${memories.userId} = ${req.authUser!.sub}`);
    return { ok: true };
  });

  /** 我的 token 用量曲线（自己看自己烧了多少） */
  app.get('/me/usage', { preHandler: [app.requireAuth] }, async (req) => {
    const rows = await db.execute(raw`
      SELECT date, games_played, tokens_used FROM daily_usage
      WHERE user_id = ${req.authUser!.sub} ORDER BY date DESC LIMIT 30
    `);
    return { items: rows, budgetK: env.DAILY_TOKEN_BUDGET_K };
  });

  /** 防沉迷：在线时长提醒（客户端自己记，这里只返回阈值） */
  app.get('/me/playtime-policy', async () => ({
    remindAfterMinutes: 60,
    remindText: '已经玩了一小时啦，起来活动一下',
    ageRating: '12+',
  }));
}
