import type { FastifyInstance } from 'fastify';
import { createWriteStream, mkdirSync, statSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import https from 'node:https';
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

/** 默认从哪拉：GitHub Release 的固定 latest 标签 */
const DEFAULT_RELEASE_URL =
  'https://github.com/Zxin-Pro/ai-game-hall/releases/download/latest/ai-game-hall.apk';
/** 国内直连 GitHub 慢，默认套一层加速前缀（后台可改） */
const DEFAULT_MIRROR = 'https://gh-proxy.com/';

/**
 * 把远端文件下载到本地。
 * 直接手写 https 请求 —— 不用 fetch 是因为这里要跟进度、要能延长时间，
 * 而且服务端到 GitHub 的握手偶尔很慢。
 */
function downloadTo(url: string, dest: string): Promise<number> {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: { 'user-agent': 'ai-game-hall' } }, (r) => {
      if (r.statusCode && r.statusCode >= 400) {
        r.resume();
        return rej(new Error(`HTTP ${r.statusCode}`));
      }
      // 中间可能有跳转
      if (r.statusCode && r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        r.resume();
        return res(downloadTo(new URL(r.headers.location, url).toString(), dest));
      }
      let n = 0;
      const out = createWriteStream(dest);
      r.on('data', (c: Buffer) => { n += c.length; });
      r.pipe(out);
      out.on('finish', () => res(n));
      out.on('error', rej);
      r.on('error', rej);
    });
    req.setTimeout(180_000, () => req.destroy(new Error('下载超时')));
    req.on('error', rej);
  });
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

  /**
   * 发布 App：直接收下新的 APK 并登记版本号。
   *
   * CI 构建完就调这个，一次把「文件 + 版本号 + 更新说明」全登记好，
   * 管理后台和 App 的自更新查询立刻就是最新的，不用人插手。
   * 参数（multipart）：file=apk，versionCode，versionName，note，minVersionCode
   */
  app.post('/publish-apk', async (req, reply) => {
    const parts = req.parts();
    let saved = '';
    let bytes = 0;
    const fields: Record<string, string> = {};

    for await (const part of parts) {
      if (part.type === 'file') {
        const dir = resolve(env.UPLOAD_DIR, 'apk');
        mkdirSync(dir, { recursive: true });
        const dest = resolve(dir, 'ai-game-hall.apk');
        await pipeline(part.file, createWriteStream(dest));
        bytes = statSync(dest).size;
        saved = dest;
      } else {
        fields[part.fieldname] = String(part.value ?? '');
      }
    }

    if (!saved) return reply.code(400).send({ error: '没收到 apk 文件（字段名要是 file）' });

    const versionCode = Number(fields.versionCode || 0);
    const versionName = fields.versionName || String(versionCode);
    const note = fields.note || '';
    const minVersionCode = Number(fields.minVersionCode || 0);

    // 文件对外地址：PUBLIC_BASE_URL + /static/apk/xxx.apk
    const apkUrl = `${env.PUBLIC_BASE_URL}/static/apk/ai-game-hall.apk`;

    const changed: string[] = [];
    if (versionCode > 0) {
      await saveSettings({ APP_VERSION_CODE: String(versionCode) });
      changed.push('APP_VERSION_CODE');
    }
    await saveSettings({ APP_VERSION_NAME: versionName });
    await saveSettings({ APP_APK_URL: apkUrl });
    if (note) await saveSettings({ APP_UPDATE_NOTE: note });
    if (minVersionCode >= 0) {
      await saveSettings({ APP_MIN_VERSION_CODE: String(minVersionCode) });
    }

    logger.info({ bytes, versionCode, versionName }, '[admin] App 新版本已发布');
    return { ok: true, bytes, versionCode, versionName, apkUrl, changed };
  });

  /**
   * 从 GitHub 拉新版 APK 并登记版本。
   *
   * 为什么不直接在 CI 里传 73MB 上来：GitHub runner 到这台机器的长连接
   * 会卡死（等满超时、0 字节），实测过两次。改成 CI 只发一个几百字节的
   * JSON，服务端自己去 GitHub 把包拉回来 —— 又快又稳。
   */
  app.post('/sync-apk', async (req, reply) => {
    const b = (req.body ?? {}) as {
      versionCode?: number | string;
      versionName?: string;
      note?: string;
      minVersionCode?: number | string;
      sourceUrl?: string;
    };

    const versionCode = Number(b.versionCode || 0);
    if (!versionCode) return reply.code(400).send({ error: '缺少 versionCode' });

    const src = b.sourceUrl || DEFAULT_RELEASE_URL;
    // 每次换一下前缀，避免单个镜像被限速拖死
    const mirror = cfg('APK_MIRROR_PREFIX') || DEFAULT_MIRROR;

    const dir = resolve(env.UPLOAD_DIR, 'apk');
    mkdirSync(dir, { recursive: true });
    const dest = resolve(dir, 'ai-game-hall.apk');
    const tmp = `${dest}.tmp`;

    // ★ 先把整个包下完再切换，下载中途别让用户拿到半个包
    let got = 0;
    try {
      got = await downloadTo(`${mirror}${src}`, tmp);
    } catch (e) {
      logger.warn({ err: String(e), mirror }, '[admin] 走加速拉包失败，回退直连');
      try {
        got = await downloadTo(src, tmp);
      } catch (e2) {
        return reply.code(502).send({ error: `拉包失败：${String(e2)}` });
      }
    }

    if (got < 5 * 1024 * 1024) {
      return reply.code(502).send({ error: `拉到的包太小（${got} 字节），不像 APK` });
    }

    renameSync(tmp, dest);

    const apkUrl = `${env.PUBLIC_BASE_URL}/static/apk/ai-game-hall.apk`;
    await saveSettings({ APP_VERSION_CODE: String(versionCode) });
    await saveSettings({ APP_VERSION_NAME: b.versionName || String(versionCode) });
    await saveSettings({ APP_APK_URL: apkUrl });
    if (b.note) await saveSettings({ APP_UPDATE_NOTE: b.note });
    if (b.minVersionCode !== undefined) {
      await saveSettings({ APP_MIN_VERSION_CODE: String(b.minVersionCode) });
    }

    logger.info({ bytes: got, versionCode }, '[admin] 已从 GitHub 同步并发布新版');
    return { ok: true, bytes: got, versionCode, apkUrl, mirror: `${mirror}${src}` };
  });

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
