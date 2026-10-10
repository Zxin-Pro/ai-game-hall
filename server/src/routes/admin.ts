import type { FastifyInstance } from 'fastify';
import { env, cfg, HOT_KEYS, getModels, getProviderChain } from '../env.js';
import { listSettings, saveSettings, resetSetting } from '../services/settings.js';
import { callLLM } from '../llm/client.js';
import { logger } from '../logger.js';

/**
 * 管理后台接口。
 * 鉴权：请求头 `x-admin-key` 必须等于 env.ADMIN_KEY（或 ADMIN_PASSWORD）。
 * 这里只管「配置」，业务数据（房间/用户/用量）由独立的 admin 服务直连数据库读。
 */

function adminKey(): string {
  return process.env.ADMIN_KEY || process.env.ADMIN_PASSWORD || '';
}

/** 需要脱敏的键：只回传掩码，不回传真值 */
const SECRET_KEYS = new Set(['MODEL_PROVIDER_KEY', 'FALLBACK_PROVIDER_KEY']);

function mask(v: string): string {
  if (!v) return '';
  if (v.length <= 10) return '****';
  return v.slice(0, 6) + '****' + v.slice(-4);
}

export default async function adminRoutes(app: FastifyInstance) {
  // ---- 鉴权钩子 ----------------------------------------------------------
  app.addHook('onRequest', async (req, reply) => {
    const key = adminKey();
    if (!key) {
      return reply.code(503).send({ error: '服务端没有配置 ADMIN_KEY，管理接口已禁用' });
    }
    const given = String(req.headers['x-admin-key'] ?? '');
    if (given !== key) {
      return reply.code(401).send({ error: '管理员密钥错误' });
    }
  });

  // 管理接口一律不缓存
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('Cache-Control', 'no-store');
    return payload;
  });

  // ---- 配置读写 ----------------------------------------------------------

  /** 列出所有可热更新的配置（密钥做掩码） */
  app.get('/settings', async () => {
    const rows = await listSettings();
    const list = rows.map((r) => ({
      ...r,
      value: SECRET_KEYS.has(r.key) && r.value ? mask(r.value) : r.value,
    }));
    return { settings: list, hotKeys: HOT_KEYS };
  });

  /** 写配置。只传要改的键即可，改完立刻热生效，不用重启 */
  app.put('/settings', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply.code(400).send({ error: '请求体必须是对象' });
    }
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (!(HOT_KEYS as readonly string[]).includes(k)) continue;
      // 密钥传掩码等于「不改」，跳过
      if (SECRET_KEYS.has(k) && typeof v === 'string' && v.includes('****')) continue;
      clean[k] = v;
    }
    const changed = await saveSettings(clean);
    logger.info({ changed }, '[admin] 运行期配置已更新');
    return { ok: true, changed, models: getModels() };
  });

  /** 删除某项覆盖，回退到 .env 默认值 */
  app.delete('/settings/:key', async (req, reply) => {
    const key = String((req.params as { key: string }).key);
    if (!(HOT_KEYS as readonly string[]).includes(key)) {
      return reply.code(400).send({ error: '这个键不允许改' });
    }
    await resetSetting(key);
    return { ok: true };
  });

  // ---- 连通性自检 --------------------------------------------------------

  /** 拿当前配置试打一次模型，测通不通、耗时多少 */
  app.post('/test-model', async (req, reply) => {
    const body = (req.body ?? {}) as { model?: string };
    const chain = getProviderChain();
    const target = body.model || getModels().speak || getModels().list[0];
    if (!target) return reply.code(400).send({ error: '没指定模型，也没有默认模型' });

    const t0 = Date.now();
    try {
      const r = await callLLM({
        model: target,
        messages: [
          { role: 'system', content: '你是测试探针，只回四个字。' },
          { role: 'user', content: '请回复：连接正常' },
        ],
        maxTokens: 64,
        temperature: 0,
        stream: false,
        purpose: 'other',
        noFallback: true,
      });
      return {
        ok: true,
        model: r.model || target,
        ms: Date.now() - t0,
        ttftMs: r.ttftMs,
        tokens: r.totalTokens,
        text: (r.text || '').slice(0, 120),
        provider: chain[0]?.name ?? 'unknown',
        baseUrl: chain[0]?.baseUrl ?? '',
      };
    } catch (e) {
      return reply.code(200).send({
        ok: false,
        model: target,
        ms: Date.now() - t0,
        error: String(e).slice(0, 300),
        provider: chain[0]?.name ?? 'unknown',
        baseUrl: chain[0]?.baseUrl ?? '',
      });
    }
  });

  /** 拉取上游的模型列表（OpenAI 兼容的 /models） */
  app.get('/upstream-models', async (_req, reply) => {
    const chain = getProviderChain();
    const p = chain[0];
    if (!p?.baseUrl) return reply.code(400).send({ error: '没配置供应商地址' });
    try {
      const res = await fetch(p.baseUrl.replace(/\/+$/, '') + '/models', {
        headers: { authorization: 'Bearer ' + p.apiKey },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        return reply.code(200).send({ ok: false, status: res.status, error: (await res.text()).slice(0, 200) });
      }
      const j = (await res.json()) as { data?: { id: string }[] };
      const ids = (j.data ?? []).map((m) => m.id).sort();
      return { ok: true, count: ids.length, models: ids };
    } catch (e) {
      return reply.code(200).send({ ok: false, error: String(e).slice(0, 200) });
    }
  });

  /** 当前生效的配置概览（不含密钥明文） */
  app.get('/effective', async () => {
    const m = getModels();
    const chain = getProviderChain();
    return {
      baseUrl: chain[0]?.baseUrl ?? '',
      hasKey: !!chain[0]?.apiKey,
      keyMasked: mask(chain[0]?.apiKey ?? ''),
      speak: m.speak,
      judge: m.judge,
      summary: m.summary,
      list: m.list,
      maxOutputTokens: Number(cfg('MAX_OUTPUT_TOKENS')) || env.MAX_OUTPUT_TOKENS,
      llmTimeoutMs: Number(cfg('LLM_TIMEOUT_MS')) || env.LLM_TIMEOUT_MS,
      llmRetry: Number(cfg('LLM_RETRY')) || env.LLM_RETRY,
      contextWindow: Number(cfg('CONTEXT_MESSAGE_WINDOW')) || env.CONTEXT_MESSAGE_WINDOW,
      nodeEnv: env.NODE_ENV,
    };
  });
}
