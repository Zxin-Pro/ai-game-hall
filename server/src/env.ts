import 'dotenv/config';
import { z } from 'zod';

const num = (def: number) => z.coerce.number().default(def);

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: num(8787),
  HOST: z.string().default('0.0.0.0'),
  PUBLIC_BASE_URL: z.string().default('http://127.0.0.1:8787'),

  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),

  JWT_SECRET: z.string().min(8),
  JWT_ACCESS_TTL: num(900),
  JWT_REFRESH_TTL: num(2592000),
  INVITE_CODES: z.string().default(''),

  MODEL_PROVIDER_URL: z.string(),
  MODEL_PROVIDER_KEY: z.string().default(''),
  MODEL_LIST: z.string().default(''),

  DEFAULT_SPEAK_MODEL: z.string().default(''),
  DEFAULT_JUDGE_MODEL: z.string().default(''),
  DEFAULT_SUMMARY_MODEL: z.string().default(''),

  FALLBACK_PROVIDER_URL: z.string().default(''),
  FALLBACK_PROVIDER_KEY: z.string().default(''),

  MAX_OUTPUT_TOKENS: num(2000),
  LLM_TIMEOUT_MS: num(30000),
  LLM_RETRY: num(2),
  CONTEXT_MESSAGE_WINDOW: num(20),
  MAX_CONCURRENT_ROOMS: num(100),

  DAILY_TOKEN_BUDGET_K: num(3000),
  BUDGET_ALERT_WEBHOOK: z.string().default(''),

  UPLOAD_DIR: z.string().default('./data/uploads'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('[env] 配置校验失败:');
  // eslint-disable-next-line no-console
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

export const models = {
  list: env.MODEL_LIST.split(',').map((s) => s.trim()).filter(Boolean),
  speak: env.DEFAULT_SPEAK_MODEL,
  judge: env.DEFAULT_JUDGE_MODEL,
  summary: env.DEFAULT_SUMMARY_MODEL,
};

export const inviteCodes = env.INVITE_CODES.split(',').map((s) => s.trim()).filter(Boolean);

/** 主供应商 + 备用供应商，按顺序尝试 */
export const providers = [
  { name: 'primary', baseUrl: env.MODEL_PROVIDER_URL, apiKey: env.MODEL_PROVIDER_KEY },
  ...(env.FALLBACK_PROVIDER_URL
    ? [{ name: 'fallback', baseUrl: env.FALLBACK_PROVIDER_URL, apiKey: env.FALLBACK_PROVIDER_KEY }]
    : []),
];

export { providers as providerChain };
