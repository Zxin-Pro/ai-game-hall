import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, or } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { hashPassword, checkPassword } from '../plugins/auth.js';
import { getInviteCodes } from '../env.js';
import { logger } from '../logger.js';

/* ------------------------------------------------------------------ */
/* 认证路由：注册 / 登录 / 刷新 / 登出                                   */
/* ------------------------------------------------------------------ */

const registerSchema = z.object({
  nickname: z.string().min(2).max(16),
  password: z.string().min(6).max(64),
  inviteCode: z.string().optional(),
  deviceFingerprint: z.string().max(128).optional(),
  avatar: z.string().max(255).optional(),
});

const loginSchema = z.object({
  nickname: z.string().min(2).max(16),
  password: z.string().min(1),
  deviceFingerprint: z.string().max(128).optional(),
});

export default async function authRoutes(app: FastifyInstance) {
  app.post('/auth/register', async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: '参数不合法', detail: parsed.error.flatten() });
    const { nickname, password, inviteCode, deviceFingerprint, avatar } = parsed.data;

    const codes = getInviteCodes();
    if (codes.length && (!inviteCode || !codes.includes(inviteCode))) {
      return reply.code(403).send({ error: '邀请码无效' });
    }

    const exists = await db.select({ id: users.id }).from(users)
      .where(or(eq(users.nickname, nickname)));
    if (exists.length) return reply.code(409).send({ error: '昵称已被占用' });

    const [created] = await db.insert(users).values({
      nickname,
      passwordHash: await hashPassword(password),
      deviceFingerprint: deviceFingerprint ?? null,
      avatar: avatar ?? `https://api.dicebear.com/7.x/thumbs/png?seed=${encodeURIComponent(nickname)}`,
    }).returning();

    const access = app.signAccess(created!.id, created!.nickname);
    const refresh = await app.issueRefresh(created!.id);
    logger.info({ nickname }, '新用户注册');
    return { user: publicUser(created!), access, refresh };
  });

  app.post('/auth/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: '参数不合法' });
    const { nickname, password, deviceFingerprint } = parsed.data;

    const rows = await db.select().from(users).where(eq(users.nickname, nickname));
    const user = rows[0];
    if (!user || !(await checkPassword(password, user.passwordHash))) {
      return reply.code(401).send({ error: '昵称或密码不对' });
    }
    if (deviceFingerprint && !user.deviceFingerprint) {
      await db.update(users).set({ deviceFingerprint }).where(eq(users.id, user.id));
    }
    const access = app.signAccess(user.id, user.nickname);
    const refresh = await app.issueRefresh(user.id);
    return { user: publicUser(user), access, refresh };
  });

  app.post('/auth/refresh', async (req, reply) => {
    const body = z.object({ refresh: z.string().min(10) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: '参数不合法' });
    const out = await app.rotateRefresh(body.data.refresh);
    if (!out) return reply.code(401).send({ error: '登录已过期，请重新登录' });
    return {
      access: app.signAccess(out.userId, out.nickname),
      refresh: out.refresh,
    };
  });

  app.post('/auth/logout', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const body = z.object({ refresh: z.string().optional() }).safeParse(req.body ?? {});
    if (body.success && body.data.refresh) {
      const { createHash } = await import('node:crypto');
      const h = createHash('sha256').update(body.data.refresh).digest('hex');
      await db.execute(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (await import('drizzle-orm')).sql`UPDATE refresh_tokens SET revoked = true WHERE token_hash = ${h}`,
      );
    }
    return { ok: true };
  });
}

function publicUser(u: { id: string; nickname: string; avatar: string | null; createdAt: Date }) {
  return { id: u.id, nickname: u.nickname, avatar: u.avatar, createdAt: u.createdAt };
}
