import type { GameConfig, GameState, PlayerState, EngineType } from './types.js';

/* ------------------------------------------------------------------ */
/* 消息 / 动作 / 提示词 / 结算 的基本类型                              */
/* ------------------------------------------------------------------ */

export interface Message {
  id: string;
  seq: number;
  senderType: 'user' | 'ai' | 'system' | 'judge';
  senderId: string | null;          // room_players.id
  senderName: string;
  content: string;
  round: number;
  phase: string;
  /** null = 公开；数组 = 仅这些 seat 可见 */
  visibleTo: number[] | null;
  createdAt: string;
}

export type ActionKind =
  | 'speak' | 'think' | 'pass'
  | 'kill' | 'save' | 'poison' | 'investigate' | 'guard'
  | 'vote' | 'describe'
  | 'offer' | 'counter' | 'threaten' | 'walk_away' | 'accept'
  | 'objection' | 'present_evidence' | 'question' | 'rule'
  | 'ask' | 'guess' | 'answer'
  | 'invest' | 'build' | 'hire' | 'pitch' | 'cut'
  | 'flirt' | 'confess'
  | 'interject';                    // 用户随时插话

export interface Action {
  kind: ActionKind;
  /** room_players.id */
  actorId: string;
  /** 目标玩家 id（投票、杀、查、报价对象） */
  targetId?: string;
  /** 自由文本（发言内容、证据名、问题） */
  text?: string;
  /** 数值（出价、投资额、好感度加成） */
  amount?: number;
  /** 选项型（save/poison/accept/objection 的 yes/no） */
  option?: string;
  /** 可见范围：null=公开，数组=仅这些 seat */
  visibleTo?: number[] | null;
  /** 结构化 JSON 原始输出，便于调试与回放 */
  raw?: unknown;
}

export interface EventLog {
  round: number;
  phase: string;
  text: string;                     // 一句话概括，喂 context 用
  visibleTo: number[] | null;
  kind: string;
}

/* ------------------------------------------------------------------ */
/* Prompt：引擎交给 LLM 的完整弹药包                                    */
/* ------------------------------------------------------------------ */

export interface Prompt {
  system: string;                   // 人设 + 规则 + 私有信息（可缓存前缀）
  messages: { role: 'user' | 'assistant'; content: string }[];
  /** 该角色这次要产出的 action 类型 */
  expect: string[];
  /** 要求模型输出的格式：'text' 直接说话 / 'json' 结构化动作 */
  outputMode: 'text' | 'json';
  model: string;
  maxTokens: number;
  temperature: number;
}

/* ------------------------------------------------------------------ */
/* 胜负 / 结算卡                                                       */
/* ------------------------------------------------------------------ */

export interface WinResult {
  winner: 'wolf' | 'good' | 'undercover' | 'civilian' | 'plaintiff' | 'defendant'
        | 'buyer' | 'seller' | 'draw' | 'company' | 'user' | 'ai' | string;
  label: string;                    // 「狼人阵营胜利」
  reason: string;
}

export interface SummaryCard {
  title: string;
  winner: string;
  /** 前半段由引擎确定性生成，后半段由 LLM 润色 */
  highlights: string[];
  stats: { label: string; value: string }[];
  mvp?: { name: string; reason: string };
  /** 复盘三句话，引擎填骨架，LLM 填血肉 */
  review: string[];
  shareText: string;
  replayUrl: string;
}

/* ================================================================== */
/*  GameEngine 接口 —— 五种子类型必须全部实现                          */
/* ================================================================== */

export interface GameEngine {
  readonly type: EngineType;

  /** 1. 按 config + 座位表初始化一局 */
  initState(config: GameConfig, players: PlayerState[], roomId: string): GameState;

  /** 2. 推进到下一阶段（轮次自增、旁白、状态重置都在这里） */
  nextPhase(state: GameState, config: GameConfig): GameState;

  /** 3. 这个玩家能看到哪些消息（私有信息隔离的唯一闸口） */
  getVisibleMessages(state: GameState, playerId: string, all: Message[]): Message[];

  /** 4. 给这个玩家拼 prompt（人设 + 可见历史 + 私有信息 + 记忆） */
  buildPrompt(
    state: GameState,
    player: PlayerState,
    config: GameConfig,
    visible: Message[],
    memories: string[],
  ): Prompt;

  /** 5. 把模型输出解析成结构化动作 */
  parseAction(aiOutput: string, player: PlayerState, config: GameConfig): Action;

  /** 6. 应用动作，返回新状态（纯函数，不改原对象） */
  applyAction(state: GameState, action: Action, config: GameConfig): GameState;

  /** 7. 判胜负，没结束返回 null */
  checkWin(state: GameState, config: GameConfig): WinResult | null;

  /** 8. 生成结算卡（确定性部分，LLM 润色在外面） */
  summarize(state: GameState, config: GameConfig): SummaryCard;

  /* ------------------- 引擎自选的钩子（可选实现） ---------------- */

  /** 某一阶段该轮到谁说话，返回 null = 本阶段结束 */
  nextSpeaker?(state: GameState, config: GameConfig, alreadySpoke: string[]): PlayerState | null;

  /** parallel/vote 阶段收完动作后的统一结算（结算动作也在这里产出） */
  resolvePending?(
    state: GameState,
    config: GameConfig,
  ): { state: GameState; events: { kind: string; text: string; visibleTo: number[] | null; targetIds?: string[] }[] };

  /** 进入阶段的旁白消息 */
  narration?(state: GameState, config: GameConfig): string | null;

  /** 引擎自己的胜负提前判定（如卧底活到剩 3 人） */
  earlyWin?(state: GameState, config: GameConfig): WinResult | null;
}
