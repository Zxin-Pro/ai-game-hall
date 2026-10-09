import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from './env.js';
import { logger } from './logger.js';
import { migrate } from './db/migrate.js';
import authPlugin from './plugins/auth.js';
import authRoutes from './routes/auth.js';
import gameRoutes, { roomListRoutes } from './routes/games.js';
import roomRoutes from './routes/rooms.js';
import meRoutes from './routes/me.js';
import uploadRoutes from './routes/uploads.js';
import { wsHub } from './ws/hub.js';
import { getRoomManager } from './services/roomManager.js';
import { installUsageSink } from './services/usage.js';
import { roomStore } from './services/roomStore.js';
import { seedGames } from './gameconfig/seed.js';

export async function buildServer() {
  const app = Fastify({
    logger,
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(cors, { origin: true, credentials: true });

  // 全局限流：按 IP。登录/注册再单独收紧
  await app.register(rateLimit, {
    max: 240,
    timeWindow: '1 minute',
    keyGenerator: (req) => (req.headers['x-device-id'] as string) ?? req.ip,
  });

  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024 } });

  mkdirSync(resolve(env.UPLOAD_DIR), { recursive: true });
  await app.register(fastifyStatic, {
    root: resolve(env.UPLOAD_DIR),
    prefix: '/static/',
    decorateReply: false,
  });

  await app.register(authPlugin);

  // 健康检查
  app.get('/health', async () => ({
    ok: true,
    env: env.NODE_ENV,
    uptime: process.uptime(),
    rooms: getRoomManager().activeCount(),
    ws: wsHub.stats(),
  }));

  // 业务路由
  await app.register(async (i) => { await i.register(authRoutes); }, { prefix: '/api' });
  await app.register(async (i) => { await i.register(gameRoutes); }, { prefix: '/api' });
  await app.register(async (i) => { await i.register(roomListRoutes); }, { prefix: '/api' });
  await app.register(async (i) => { await i.register(roomRoutes); }, { prefix: '/api' });
  await app.register(async (i) => { await i.register(meRoutes); }, { prefix: '/api' });
  await app.register(async (i) => { await i.register(uploadRoutes); }, { prefix: '/api' });

  return app;
}

async function main() {
  await migrate();
  await seedGames();
  installUsageSink();

  const app = await buildServer();
  wsHub.attach(app);
  await getRoomManager().sweepZombies();

  await app.listen({ port: env.PORT, host: env.HOST });
  logger.info(`AI 游戏厅后端已启动 http://${env.HOST}:${env.PORT}`);

  // 每 5 分钟检查一次全局日预算，超了只告警不停服
  setInterval(() => { void roomStore.checkBudget(); }, 5 * 60 * 1000);

  const shutdown = async (sig: string) => {
    logger.info({ sig }, '收到退出信号，开始优雅关闭');
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    logger.error(e, '启动失败');
    process.exit(1);
  });
}
