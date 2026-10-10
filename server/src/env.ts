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

  // ---- App 版本 / 更新 ------------------------------------------------
  // 发新包时由 CI 自动写进来，App 启动时查 /api/app/latest 就知道要不要更新
  APP_VERSION_CODE: num(1),
  APP_VERSION_NAME: z.string().default('1'),
  APP_APK_URL: z.string().default(''),
  APP_UPDATE_NOTE: z.string().default(''),
  APP_MIN_VERSION_CODE: num(0),   // 低于它的强制更新（0 = 不强制）
  APK_MIRROR_PREFIX: z.string().default(''),   // 拉 GitHub 时套的加速前缀

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

/** 启动时的基础配置（来自 .env / 环境变量），运行期不可变 */
export const env = parsed.data;

// ============================================================================
//  运行期可覆盖的配置
//  ---------------------------------------------------------------------------
//  管理后台改的 API 配置写进数据库，进程里靠这份内存覆盖层生效，
//  不用重启容器。改完调 applySettings() 立刻热更新。
// ============================================================================

/** 可热更新的字段白名单 —— 只有这些字段允许被数据库覆盖 */
export const HOT_KEYS = [
  'MODEL_PROVIDER_URL',
  'MODEL_PROVIDER_KEY',
  'MODEL_LIST',
  'DEFAULT_SPEAK_MODEL',
  'DEFAULT_JUDGE_MODEL',
  'DEFAULT_SUMMARY_MODEL',
  'FALLBACK_PROVIDER_URL',
  'FALLBACK_PROVIDER_KEY',
  'MAX_OUTPUT_TOKENS',
  'LLM_TIMEOUT_MS',
  'LLM_RETRY',
  'CONTEXT_MESSAGE_WINDOW',
  'DAILY_TOKEN_BUDGET_K',
  'INVITE_CODES',
  'APP_VERSION_CODE',
  'APP_VERSION_NAME',
  'APP_APK_URL',
  'APP_UPDATE_NOTE',
  'APP_MIN_VERSION_CODE',
  'APK_MIRROR_PREFIX',
] as const;

export type HotKey = (typeof HOT_KEYS)[number];

/** 内存覆盖层：键 -> 值。启动后用数据库里的值填充 */
const overrides = new Map<string, string>();

export function setOverrides(next: Record<string, string | undefined>) {
  overrides.clear();
  for (const k of HOT_KEYS) {
    const v = next[k];
    if (v !== undefined && v !== null && String(v) !== '') overrides.set(k, String(v));
  }
  recompute();
}

export function currentOverrides(): Record<string, string> {
  return Object.fromEntries(overrides);
}

/**
 * 读配置：优先内存覆盖 → 再退回 .env 基础值
 */
export function cfg(key: HotKey): string {
  const v = overrides.get(key);
  if (v !== undefined) return v;
  return String((env as unknown as Record<string, unknown>)[key] ?? '');
}

export function cfgNum(key: HotKey, fallback: number): number {
  const n = Number(cfg(key));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ---- 派生对象：随覆盖层变化而重建 -----------------------------------------
// 用函数导出，调用方每次拿到的都是最新的（导出 let 会被解构固化）

const _derived = {
  models: { list: [] as string[], speak: '', judge: '', summary: '' },
  inviteCodes: [] as string[],
  providerChain: [] as { name: string; baseUrl: string; apiKey: string }[],
};

function recompute() {
  _derived.models = {
    list: cfg('MODEL_LIST').split(',').map((s) => s.trim()).filter(Boolean),
    speak: cfg('DEFAULT_SPEAK_MODEL'),
    judge: cfg('DEFAULT_JUDGE_MODEL'),
    summary: cfg('DEFAULT_SUMMARY_MODEL'),
  };
  _derived.inviteCodes = cfg('INVITE_CODES').split(',').map((s) => s.trim()).filter(Boolean);
  _derived.providerChain = [
    { name: 'primary', baseUrl: cfg('MODEL_PROVIDER_URL'), apiKey: cfg('MODEL_PROVIDER_KEY') },
    ...(cfg('FALLBACK_PROVIDER_URL')
      ? [{ name: 'fallback', baseUrl: cfg('FALLBACK_PROVIDER_URL'), apiKey: cfg('FALLBACK_PROVIDER_KEY') }]
      : []),
  ];
}

// 启动先算一遍（此时还没有覆盖层，等于用 .env 的值）
recompute();

export function getModels() {
  return _derived.models;
}
export function getInviteCodes() {
  return _derived.inviteCodes;
}
export function getProviderChain() {
  return _derived.providerChain;
}
