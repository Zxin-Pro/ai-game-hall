import type { GameConfig, GameState, PlayerState, ConfigRole } from './types.js';
import type { Action, Message, Prompt, SummaryCard, WinResult } from './engine.js';

/* ------------------------------------------------------------------ */
/* 工具集：五个引擎共用                                                */
/* ------------------------------------------------------------------ */

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const uid = () => Math.random().toString(36).slice(2, 10);

/** 按 count 展开角色牌堆，不够的用 fallback 补 */
export function expandRoles(config: GameConfig, seats: number): ConfigRole[] {
  const out: ConfigRole[] = [];
  for (const r of config.roles) {
    if (r.count <= 0) continue;
    for (let i = 0; i < r.count; i++) out.push(r);
  }
  const filler = config.roles.find((r) => r.camp === 'civilian' || r.camp === 'good') ?? config.roles[0];
  while (out.length < seats && filler) out.push(filler);
  return out.slice(0, seats);
}

/** Fisher-Yates，用可注入的随机源，回放时能复现 */
export function shuffle<T>(arr: T[], rand: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 座位的公开称呼：1 号、2 号 */
export const seatLabel = (p: PlayerState) => `${p.seat + 1} 号 ${p.name}`;

export function alivePlayers(state: GameState): PlayerState[] {
  return state.players.filter((p) => p.alive);
}

export function byRole(state: GameState, roleKey: string): PlayerState[] {
  return state.players.filter((p) => p.roleKey === roleKey);
}

/**
 * ★ 把 config 里的角色牌发到座位上。
 * 优先尊重调用方已经定好的 roleKey（房间里选角色时定的），
 * 空位或者对不上的，再按 config 的 count 展开补齐。
 * 这样引擎既能独立跑测试，也能被房间的真实配置驱动。
 */
export function resolveRoles(config: GameConfig, players: PlayerState[]): ConfigRole[] {
  const byKey = new Map(config.roles.map((r) => [r.key, r]));
  const deck = expandRoles(config, players.length);

  const out: ConfigRole[] = [];
  let cursor = 0;
  for (let i = 0; i < players.length; i++) {
    const want = players[i]!.roleKey ? byKey.get(players[i]!.roleKey!) : undefined;
    if (want) {
      out.push(want);
    } else {
      // 跳过已经被别人占掉的牌，尽量避免重复关键角色
      while (cursor < deck.length) {
        const cand = deck[cursor++]!;
        const taken = out.filter((o) => o.key === cand.key).length;
        if (taken < Math.max(1, cand.count)) { out.push(cand); break; }
      }
      if (out.length === i) out.push(deck[i % deck.length]!);
    }
  }
  return out;
}

export function playerOf(state: GameState, id: string): PlayerState | undefined {
  return state.players.find((p) => p.id === id);
}

/* ------------------------------------------------------------------ */
/* 可见性                                                              */
/* ------------------------------------------------------------------ */

/** 一条消息对某个玩家是否可见 */
export function canSee(msg: Message, player: PlayerState): boolean {
  if (msg.visibleTo === null || msg.visibleTo === undefined) return true;
  return msg.visibleTo.includes(player.seat);
}

/** 通用过滤，五个引擎都能直接用；要额外规则再 override getVisibleMessages */
export function filterVisible(all: Message[], player: PlayerState): Message[] {
  return all.filter((m) => canSee(m, player));
}

/* ------------------------------------------------------------------ */
/* 提示词拼装：所有引擎共享的「一致性外壳」                            */
/* ------------------------------------------------------------------ */

export const BASE_RULES = [
  '你正在参与一场多 AI 的多人游戏，你是其中一名玩家，不是助手，不是 AI 客服',
  '永远用第一人称角色口吻说话，绝不复述规则，绝不解释自己在扮演角色',
  '绝不说「作为 AI」「我是一个语言模型」这类话',
  '每句话都要服务你的游戏目标，不闲聊、不跑题、不写作文',
  '参考前文语气接话，但不要机械重复别人的句式',
  '单次发言控制在 60 字以内，除非规则另有要求',
].join('\n- ');

export function roleBlock(player: PlayerState, role: ConfigRole | undefined, config: GameConfig): string {
  const r = role ?? config.roles.find((x) => x.key === player.roleKey);
  if (!r) return `你的身份：${player.roleKey}`;
  return [
    `你的名字：${player.name}`,
    `你的身份：${r.identity || r.name}（阵营：${r.camp}）`,
    `你的目标：${r.goal}`,
    `你的性格：${r.personality}`,
    `你的知识：${r.knowledge}`,
    r.taboo ? `你的忌讳：${r.taboo}` : '',
    `你的说话风格：${r.speakingStyle}`,
  ].filter(Boolean).join('\n');
}

export function privateBlock(player: PlayerState): string {
  const entries = Object.entries(player.private ?? {});
  if (!entries.length) return '';
  const lines = entries.map(([k, v]) => `- ${k}：${typeof v === 'string' ? v : JSON.stringify(v)}`);
  return `【只有你知道的信息】\n${lines.join('\n')}\n以上内容绝不能直接说出口，只能体现在你的判断和行动里`;
}

export function memoryBlock(memories: string[]): string {
  if (!memories.length) return '';
  return `【关于当前玩家的长期记忆】\n${memories.map((m) => `- ${m}`).join('\n')}`;
}

/** 把消息流压成 context 文本，超窗口时掐中间保头尾（缓存友好） */
export function renderHistory(msgs: Message[], window = 20, head = 2): string {
  if (!msgs.length) return '（还没有人说话）';
  const line = (m: Message) => {
    if (m.senderType === 'system' || m.senderType === 'judge') return `〔系统〕${m.content}`;
    return `${m.senderName}：${m.content}`;
  };
  if (msgs.length <= window) return msgs.map(line).join('\n');
  const tail = msgs.slice(msgs.length - (window - head));
  return [
    ...msgs.slice(0, head).map(line),
    `……（中间省略 ${msgs.length - window} 条）`,
    ...tail.map(line),
  ].join('\n');
}

export function actionSpec(kinds: string[], config: GameConfig): string {
  const all = (config.data?.actionGrammar as Record<string, string>) ?? {};
  const lines = kinds.map((k) => `- ${k}：${all[k] ?? '自由文本'}`);
  return [
    '【你可以输出一个动作，用 JSON 表示】',
    '{ "kind": "<动作名>", "target": "<目标玩家名字，可空>", "text": "<你说的话，可空>", "amount": <数字，可空>, "option": "<选项，可空>" }',
    '可用动作：',
    ...lines,
    '只输出这个 JSON，不要 markdown 代码块，不要任何解释文字',
  ].join('\n');
}

export function baseSystem(opts: {
  config: GameConfig;
  player: PlayerState;
  role?: ConfigRole;
  memories: string[];
  extra?: string;
}): string {
  const { config, player, role, memories, extra } = opts;
  return [
    `你是《${config.name}》里的一个角色。`,
    roleBlock(player, role, config),
    privateBlock(player),
    memoryBlock(memories),
    `【通用规则】\n- ${BASE_RULES}`,
    `【本局专用规则】\n${config.rules.map((r) => `- ${r}`).join('\n')}`,
    extra ?? '',
  ].filter(Boolean).join('\n\n');
}

/* ------------------------------------------------------------------ */
/* 解析：模型输出 → Action                                             */
/* ------------------------------------------------------------------ */

/** 从任意脏输出里抠出第一个 JSON 对象 */
export function extractJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

export const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

/** 名字 → 玩家：兼容「3 号」「张三」「3」等写法 */
export function resolvePlayer(state: GameState, ref: unknown): PlayerState | undefined {
  const s = str(ref);
  if (!s) return undefined;
  const digits = s.match(/\d+/);
  if (digits) {
    const seat = Number(digits[0]) - 1;
    const hit = state.players.find((p) => p.seat === seat);
    if (hit) return hit;
  }
  const lower = s.toLowerCase();
  return state.players.find((p) => p.name.toLowerCase() === lower)
    ?? state.players.find((p) => p.name.toLowerCase().includes(lower));
}

/* ------------------------------------------------------------------ */
/* 结算卡骨架：五个引擎共享排版，只换字段                              */
/* ------------------------------------------------------------------ */

export function buildSummary(opts: {
  title: string;
  winner: string;
  highlights: string[];
  stats: { label: string; value: string }[];
  mvp?: { name: string; reason: string };
  review: string[];
  roomId: string;
}): SummaryCard {
  return {
    ...opts,
    shareText: `${opts.title}｜${opts.winner}`,
    replayUrl: `/room/${opts.roomId}/replay`,
  };
}

export type { Action, Message, Prompt, SummaryCard, WinResult, PlayerState, GameState, GameConfig };
