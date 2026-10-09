import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { resolve, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { env } from '../env.js';

/* ------------------------------------------------------------------ */
/* 上传：分享图 / 自定义头像                                             */
/* ------------------------------------------------------------------ */

const ALLOWED = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

export default async function uploadRoutes(app: FastifyInstance) {
  app.post('/uploads', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: '没有文件' });

    const ext = extname(file.filename ?? '').toLowerCase();
    if (!ALLOWED.has(ext)) return reply.code(415).send({ error: '只支持图片' });

    const name = `${randomUUID()}${ext}`;
    const dest = resolve(env.UPLOAD_DIR, name);
    await pipeline(file.file, createWriteStream(dest));

    return {
      ok: true,
      url: `${env.PUBLIC_BASE_URL}/static/${name}`,
      path: `/static/${name}`,
    };
  });
}
