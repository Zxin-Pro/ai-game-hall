import { env, providerChain, models } from '../env.js';
import { logger } from '../logger.js';

/* ------------------------------------------------------------------ */
/* 统一 LLM 客户端                                                      */
/*  - OpenAI 兼容接口，支持任意 model                                    */
/*  - 流式 / 非流式                                                     */
/*  - 超时 30s，失败重试 2 次，再失败切 fallback 供应商                  */
/*  - 每次调用记 token + 耗时，写日志并汇总到全局用量                     */
/* ------------------------------------------------------------------ */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CallOptions {
  model?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  /** 流式回调 */
  onDelta?: (chunk: string) => void;
  /** 用途标签，只用于日志 */
  purpose?: 'speak' | 'judge' | 'summary' | 'other';
  /** 覆盖默认超时 */
  timeoutMs?: number;
  /** 禁用 fallback（比如已经试过一次） */
  noFallback?: boolean;
}

export interface CallResult {
  text: string;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** 首字延迟 ms */
  ttftMs: number;
  /** 纯生成耗时 ms */
  genMs: number;
  /** 是否估算值（供应商没返回 usage） */
  estimated: boolean;
  /** 生成速率 tok/s */
  rate: number;
}

/* ------------------------------------------------------------------ */
/* token 估算：中文 0.75 tok/字，其他 0.3 tok/字                        */
/* ------------------------------------------------------------------ */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(ch)) cjk++;
    else other++;
  }
  return Math.ceil(cjk * 0.75 + other * 0.3);
}

export function messagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((n, m) => n + estimateTokens(m.content) + 4, 0);
}

/* ------------------------------------------------------------------ */
/* 用量汇总（内存 + 由上层落库）                                        */
/* ------------------------------------------------------------------ */
export interface UsageSink {
  onUsage(info: {
    tokens: number;
    model: string;
    purpose: string;
    ok: boolean;
    ms: number;
    userId?: string;
    roomId?: string;
  }): void;
}

let sink: UsageSink | null = null;
export function setUsageSink(s: UsageSink) { sink = s; }

/* ------------------------------------------------------------------ */
/* 核心请求                                                             */
/* ------------------------------------------------------------------ */

async function once(
  provider: { name: string; baseUrl: string; apiKey: string },
  opts: CallOptions,
  signal: AbortSignal,
): Promise<CallResult> {
  const model = opts.model && opts.model.trim() ? opts.model.trim() : (models.speak || models.list[0] || 'gpt-4o-mini');
  const url = `${provider.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const stream = opts.stream ?? Boolean(opts.onDelta);

  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    max_tokens: opts.maxTokens ?? env.MAX_OUTPUT_TOKENS,
    temperature: opts.temperature ?? 0.9,
    stream,
  };
  // 有些便宜供应商不认 stream_options，先带上，400 了再摘
  if (stream) body.stream_options = { include_usage: true };

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`;

  const t0 = Date.now();
  let res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });

  // stream_options 兼容降级
  if (res.status === 400 && stream) {
    const errText = await res.text();
    if (/stream_options|unknown field|invalid.*param|unrecognized/i.test(errText)) {
      delete body.stream_options;
      res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    } else {
      throw new ApiError(`400: ${errText.slice(0, 300)}`, 400);
    }
  }

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new ApiError(`${res.status} ${res.statusText}: ${t.slice(0, 300)}`, res.status);
  }

  if (!stream || !res.body) {
    // 非流式
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      model?: string;
    };
    const text = json.choices?.[0]?.message?.content ?? '';
    const tEnd = Date.now();
    const usage = json.usage;
    const pTok = usage?.prompt_tokens ?? messagesTokens(opts.messages);
    const cTok = usage?.completion_tokens ?? estimateTokens(text);
    const estimated = !usage;
    const genMs = tEnd - t0;
    return {
      text, model: json.model ?? model, provider: provider.name,
      promptTokens: pTok, completionTokens: cTok, totalTokens: pTok + cTok,
      ttftMs: genMs,               // 非流式拿不到真 ttft，退化处理
      genMs,
      estimated,
      rate: genMs > 0 ? cTok / (genMs / 1000) : 0,
    };
  }

  // 流式
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let ttft = 0;
  let tEnd = 0;
  let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;
  let modelOut = model;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || !line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const chunk = JSON.parse(payload) as {
          model?: string;
          choices?: { delta?: { content?: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        };
        if (chunk.model) modelOut = chunk.model;
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          const now = Date.now();
          if (!ttft) ttft = now;
          tEnd = now;
          text += delta;
          opts.onDelta?.(delta);
        }
        if (chunk.usage) usage = chunk.usage;
      } catch {
        // 单个 chunk 解析失败不能炸整条流
      }
    }
  }

  const t1 = Date.now();
  if (!ttft) ttft = t1;
  if (!tEnd) tEnd = t1;
  const pTok = usage?.prompt_tokens ?? messagesTokens(opts.messages);
  const cTok = usage?.completion_tokens ?? estimateTokens(text);
  const genMs = Math.max(1, tEnd - ttft);
  return {
    text, model: modelOut, provider: provider.name,
    promptTokens: pTok, completionTokens: cTok, totalTokens: pTok + cTok,
    ttftMs: ttft - t0,
    genMs,
    estimated: !usage,
    rate: cTok / (genMs / 1000),
  };
}

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

const isRetryable = (e: unknown): boolean => {
  if (e instanceof ApiError) return e.status >= 500 || e.status === 429 || e.status === 408;
  if (e instanceof Error) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') return true;
    return /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|network/i.test(e.message);
  }
  return false;
};

/**
 * 对外唯一入口：重试 + 供应商切换全在这里
 */
export async function callLLM(opts: CallOptions): Promise<CallResult> {
  const chain = opts.noFallback ? providerChain.slice(0, 1) : providerChain;
  let lastErr: unknown;

  for (let pi = 0; pi < chain.length; pi++) {
    const provider = chain[pi]!;
    const attempts = pi === 0 ? env.LLM_RETRY + 1 : 1;
    for (let a = 0; a < attempts; a++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? env.LLM_TIMEOUT_MS);
      try {
        const r = await once(provider, opts, ac.signal);
        logger.info({
          provider: r.provider, model: r.model, purpose: opts.purpose,
          promptTokens: r.promptTokens, completionTokens: r.completionTokens,
          ttftMs: r.ttftMs, genMs: r.genMs, rate: Number(r.rate.toFixed(1)), estimated: r.estimated,
        }, 'llm 调用成功');
        sink?.onUsage({
          tokens: r.totalTokens, model: r.model, purpose: opts.purpose ?? 'other',
          ok: true, ms: r.ttftMs + r.genMs,
        });
        return r;
      } catch (e) {
        lastErr = e;
        const retryable = isRetryable(e);
        logger.warn({ provider: provider.name, attempt: a + 1, err: String(e).slice(0, 200), retryable }, 'llm 调用失败');
        sink?.onUsage({ tokens: 0, model: opts.model ?? '', purpose: opts.purpose ?? 'other', ok: false, ms: 0 });
        if (!retryable) break;
      } finally {
        clearTimeout(timer);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('LLM 调用失败');
}

/**
 * 只调一次不做任何重试的轻量入口（用于摘要等非关键路径）
 */
export async function callOnce(opts: CallOptions): Promise<CallResult> {
  return callLLM({ ...opts, noFallback: true, timeoutMs: opts.timeoutMs ?? 15000 });
}
