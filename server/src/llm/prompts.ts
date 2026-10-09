import { env, models } from '../env.js';
import { callLLM, callOnce, type ChatMessage } from './client.js';

/* ------------------------------------------------------------------ */
/* 裁判 / 总结 / 内容安全 的提示词与调用                                 */
/* ------------------------------------------------------------------ */

const JUDGE_SYSTEM = `你是一个多人游戏的无情裁判。你只做判定，不参与游戏，不讨好任何人。
你收到的是本轮发生的事实，你要输出严格的 JSON，不要任何解释文字。`;

export async function judgePhase(payload: {
  gameName: string;
  phase: string;
  round: number;
  transcript: string;
  question: string;
  schemaHint: string;
  model?: string;
}): Promise<Record<string, unknown>> {
  const res = await callLLM({
    model: payload.model || models.judge || models.speak,
    purpose: 'judge',
    temperature: 0.2,
    maxTokens: 400,
    messages: [
      { role: 'system', content: JUDGE_SYSTEM },
      {
        role: 'user',
        content: [
          `游戏：${payload.gameName}`,
          `阶段：第 ${payload.round} 轮 ${payload.phase}`,
          `【局面记录】\n${payload.transcript.slice(-3000)}`,
          `【你要判定】${payload.question}`,
          `【输出格式】${payload.schemaHint}`,
          '只输出这个 JSON。',
        ].join('\n\n'),
      },
    ],
  });
  const m = res.text.match(/\{[\s\S]*\}/);
  if (!m) return {};
  try { return JSON.parse(m[0]) as Record<string, unknown>; } catch { return {}; }
}

const SUMMARY_SYSTEM = `你是一个游戏复盘写手，风格像朋友在群里回看刚才那局，短、准、有点毒舌但不刻薄。
不要写"本局游戏"这种客套话，直接说事。禁止使用 emoji。`;

/** 给引擎产出的确定性结算卡做润色：只改文字，不改数据 */
export async function polishSummary(payload: {
  gameName: string;
  winner: string;
  highlights: string[];
  stats: { label: string; value: string }[];
  transcript: string;
  model?: string;
}): Promise<{ review: string[]; mvpReason?: string } | null> {
  try {
    const res = await callOnce({
      model: payload.model || models.summary || models.speak,
      purpose: 'summary',
      temperature: 0.7,
      maxTokens: 400,
      messages: [
        { role: 'system', content: SUMMARY_SYSTEM },
        {
          role: 'user',
          content: [
            `游戏：${payload.gameName}`,
            `结果：${payload.winner}`,
            `关键点：${payload.highlights.join('；')}`,
            `数据：${payload.stats.map((s) => `${s.label}=${s.value}`).join('，')}`,
            `【对局记录】\n${payload.transcript.slice(-2500)}`,
            '请输出 JSON：{"review":["三句话复盘，每句不超过30字"],"mvpReason":"一句话点评 MVP"}',
            '复盘要指出谁做对了什么、谁在哪一步翻车、如果重来该怎么做。',
          ].join('\n\n'),
        },
      ],
    });
    const m = res.text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const j = JSON.parse(m[0]) as { review?: string[]; mvpReason?: string };
    return {
      review: Array.isArray(j.review) ? j.review.filter(Boolean).slice(0, 4) : [],
      mvpReason: j.mvpReason,
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 内容安全：轻量本地关键词 + 可选模型二次确认                           */
/* ------------------------------------------------------------------ */

const BLOCK_PATTERNS: RegExp[] = [
  /(操你|草你|傻逼|妈的死|去死吧|滚你妈)/,
  /(约炮|裸聊|色情|援交|卖淫)/,
  /(自杀|自残|割腕|跳楼吧)/,
  /(毒品|冰毒|海洛因|大麻)/,
  /(银行卡号|身份证号|验证码发我)/,
];

export interface ModerationResult {
  ok: boolean;
  reason?: string;
}

/** 先用本地词表，命中再让模型判一次，省钱 */
export async function moderate(text: string): Promise<ModerationResult> {
  const hit = BLOCK_PATTERNS.find((r) => r.test(text));
  if (!hit) return { ok: true };
  try {
    const res = await callOnce({
      model: models.judge || models.speak,
      purpose: 'other',
      temperature: 0,
      maxTokens: 60,
      messages: [
        { role: 'system', content: '你是内容安全审核员。只回答 allowed 或 blocked，不要解释。' },
        { role: 'user', content: `这句话在多人闲聊游戏里出现，是否违规（色情/暴力/自伤/违法/人身攻击严重）？违规回答 blocked，否则 allowed。\n"${text.slice(0, 200)}"` },
      ],
    });
    const blocked = /blocked/i.test(res.text);
    return blocked ? { ok: false, reason: '内容不合规' } : { ok: true };
  } catch {
    return { ok: false, reason: '内容不合规' };
  }
}

/* ------------------------------------------------------------------ */
/* 记忆抽取：一局结束后，抽取关于用户的长期偏好                          */
/* ------------------------------------------------------------------ */

export async function extractMemories(payload: {
  gameName: string;
  transcript: string;
  model?: string;
}): Promise<{ key: string; value: string }[]> {
  try {
    const res = await callOnce({
      model: payload.model || models.summary || models.speak,
      purpose: 'summary',
      temperature: 0.3,
      maxTokens: 300,
      messages: [
        { role: 'system', content: '你从对局记录里抽取关于「主角/用户」的长期偏好，用于以后更好的陪玩。只输出 JSON 数组，最多 3 条，没有就输出 []。' },
        {
          role: 'user',
          content: `游戏：${payload.gameName}\n记录：\n${payload.transcript.slice(-2000)}\n\n输出格式：[{"key":"偏好标签(6字内)","value":"具体描述(30字内)"}]`,
        },
      ],
    });
    const m = res.text.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const arr = JSON.parse(m[0]) as { key: string; value: string }[];
    return arr.filter((x) => x?.key && x?.value).slice(0, 3);
  } catch {
    return [];
  }
}

export const systemMessage = (content: string): ChatMessage => ({ role: 'system', content });
