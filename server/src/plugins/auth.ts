import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../env.js';
import { db } from '../db/index.js';
import { users, refreshTokens } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

/* ------------------------------------------------------------------ */
/* JWT + bcrypt 自建认证                                                */
/* ------------------------------------------------------------------ */

export interface AccessPayload {
  sub: string;
  nickname: string;
  typ: 'access';
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AccessPayload;
  }
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export async function authPlugin(app: FastifyInstance) {
  await app.register(jwt, { secret: env.JWT_SECRET });

  // 把 jwt 的校验能力暴露给 WS Hub
  bindTokenVerifier((token) => app.jwt.verify<AccessPayload>(token));

  app.decorate('signAccess', (userId: string, nickname: string) =>
    app.jwt.sign({ sub: userId, nickname, typ: 'access' }, { expiresIn: env.JWT_ACCESS_TTL }));

  app.decorate('issueRefresh', async (userId: string) => {
    const raw = randomBytes(32).toString('hex');
    await db.insert(refreshTokens).values({
      userId, tokenHash: sha(raw),
      expiresAt: new Date(Date.now() + env.JWT_REFRESH_TTL * 1000),
    });
    return raw;
  });

  app.decorate('rotateRefresh', async (raw: string) => {
    const rows = await db.select().from(refreshTokens)
      .where(and(eq(refreshTokens.tokenHash, sha(raw)), eq(refreshTokens.revoked, false)));
    const row = rows[0];
    if (!row || row.expiresAt.getTime() < Date.now()) return null;
    await db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.id, row.id));
    const user = await db.select().from(users).where(eq(users.id, row.userId));
    if (!user[0]) return null;
    const next = await app.issueRefresh(row.userId);
    return { userId: row.userId, nickname: user[0].nickname, refresh: next };
  });

  app.decorateRequest('authUser');

  app.decorate('requireAuth', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = await req.jwtVerify<AccessPayload>();
      if (payload.typ !== 'access') throw new Error('bad token type');
      req.authUser = payload;
    } catch {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });
}

/**
 * 供 WS 握手用的纯函数校验。
 * 这里手写 HMAC 校验，避免为了校验一个 token 把 fastify 实例传进 hub。
 */
let jswebtokenVerify: ((token: string) => AccessPayload) | null = null;

export function bindTokenVerifier(v: (token: string) => AccessPayload) {
  jswebtokenVerify = v;
}

export function verifyAccessToken(token: string): AccessPayload | null {
  if (!jswebtokenVerify || !token) return null;
  try {
    const p = jswebtokenVerify(token);
    return p && p.typ === 'access' ? p : null;
  } catch {
    return null;
  }
}

export const hashPassword = (pwd: string) => bcrypt.hash(pwd, 10);
export const checkPassword = (pwd: string, hash: string) => bcrypt.compare(pwd, hash);

declare module 'fastify' {
  interface FastifyInstance {
    signAccess(userId: string, nickname: string): string;
    issueRefresh(userId: string): Promise<string>;
    rotateRefresh(raw: string): Promise<{ userId: string; nickname: string; refresh: string } | null>;
    requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void>;
  }
}

export default fp(authPlugin, { name: 'auth' });
