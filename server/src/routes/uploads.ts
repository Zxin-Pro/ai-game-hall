import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { promises as fsp, createWriteStream } from 'node:fs';
import { resolve, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { env } from '../env.js';

/* ------------------------------------------------------------------ */
/* 上传：分享图 / 自定义头像                                             */
/* ------------------------------------------------------------------ */

const ALLOWED = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

/** 用户上传的图片上限，单独把关（全局上限放宽是为了管理端能传 APK） */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export default async function uploadRoutes(app: FastifyInstance) {
  app.post('/uploads', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: '没有文件' });

    const ext = extname(file.filename ?? '').toLowerCase();
    if (!ALLOWED.has(ext)) return reply.code(415).send({ error: '只支持图片' });

    const name = `${randomUUID()}${ext}`;
    const dest = resolve(env.UPLOAD_DIR, name);
    await pipeline(file.file, createWriteStream(dest));

    // 流式写完才拿得到真实大小，超了就删掉
    const { size } = await fsp.stat(dest);
    if (size > MAX_IMAGE_BYTES) {
      await fsp.unlink(dest).catch(() => {});
      return reply.code(413).send({ error: '图片太大了（上限 8MB）' });
    }

    return {
      ok: true,
      url: `${env.PUBLIC_BASE_URL}/static/${name}`,
      path: `/static/${name}`,
    };
  });
}
