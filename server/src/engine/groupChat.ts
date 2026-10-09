import type { GameConfig, GameState, PlayerState } from './types.js';
import type { Action, GameEngine, Message, Prompt, SummaryCard, WinResult } from './engine.js';
import {
  actionSpec, alivePlayers, baseSystem, buildSummary, clone, extractJson, filterVisible,
  renderHistory, resolveRoles, resolvePlayer, str, uid,
} from './base.js';

/* ------------------------------------------------------------------ */
/* group_chat：AI 恋爱模拟 + 海龟汤                                     */
/* ------------------------------------------------------------------ */

interface GroupChatData {
  /** 海龟汤：真相 + 已问过的问题 */
  riddle?: { truth: string; title: string; hints: string[] };
  asked?: { who: string; q: string; a: string }[];
  /** 恋爱：好感度事件流 */
  affectionLog?: { who: string; delta: number; reason: string }[];
  /** 恋爱的冲突触发标志 */
  conflictTriggered?: boolean;
  /** 本阶段已发言 */
  spoke: string[];
}

const POS_WORDS = ['谢谢', '喜欢', '可爱', '温柔', '帅', '美', '一起', '陪你', '在乎', '想你', '好呀', '开心'];
const NEG_WORDS = ['滚', '烦', '闭嘴', '讨厌', '无聊', '别来', '不理', '谁啊', '少管', '蠢'];

export class GroupChatEngine implements GameEngine {
  readonly type = 'group_chat' as const;

  initState(config: GameConfig, players: PlayerState[], roomId: string): GameState {
    const assigned = resolveRoles(config, players);
    const next = players.map((p, i) => {
      const role = assigned[i]!;
      return {
        ...clone(p),
        seat: p.seat ?? i,
        roleKey: role.key,
        camp: role.camp || role.key,
        alive: true,
        score: 0,
        private: {} as Record<string, unknown>,
      };
    });

    const data: GroupChatData = { spoke: [], affectionLog: [] };

    const pool = (config.data?.riddles ?? []) as { title: string; truth: string; hints: string[] }[];
    if (pool.length) data.riddle = pool[Math.floor(Math.random() * pool.length)]!;

    // 主持人知道真相
    if (data.riddle) {
      for (const p of next) {
        if (/host|主持/.test(p.roleKey)) p.private['真相'] = data.riddle.truth;
      }
      // 搅局者知道部分提示
      for (const p of next) {
        if (/troll|搅局/.test(p.roleKey)) p.private['你知道的线索'] = data.riddle.hints.slice(0, 1).join('；');
      }
    }

    return {
      roomId,
      gameId: config.id,
      engineType: 'group_chat',
      round: 1,
      phase: config.phases[0]!.key,
      phaseIndex: 0,
      status: 'running',
      players: next,
      data: data as unknown as Record<string, unknown>,
      log: [],
      pending: [],
      finished: false,
    };
  }

  nextPhase(state: GameState, config: GameConfig): GameState {
    const s = clone(state);
    const d = s.data as unknown as GroupChatData;
    d.spoke = [];
    s.phaseIndex += 1;
    if (s.phaseIndex >= config.phases.length) {
      if (s.round >= config.maxRounds) {
        s.phaseIndex = config.phases.length - 1;
        s.phase = config.phases[s.phaseIndex]!.key;
        s.pending = [];
        s.finished = true;
        s.status = 'finished';
        s.winner = this.checkWin(s, config) ?? { winner: 'ai', label: '故事告一段落', reason: '轮次用尽' };
        s.data = d as unknown as Record<string, unknown>;
        return s;
      }
      s.phaseIndex = 0;
      s.round += 1;
    }
    s.phase = config.phases[s.phaseIndex]!.key;
    s.pending = [];
    s.data = d as unknown as Record<string, unknown>;
    return s;
  }

  getVisibleMessages(state: GameState, playerId: string, all: Message[]): Message[] {
    const p = state.players.find((x) => x.id === playerId);
    return p ? filterVisible(all, p) : all.filter((m) => m.visibleTo === null);
  }

  buildPrompt(
    state: GameState, player: PlayerState, config: GameConfig, visible: Message[], memories: string[],
  ): Prompt {
    const phase = config.phases[state.phaseIndex]!;
    const isSoup = Boolean((state.data as unknown as GroupChatData).riddle);

    const extra: string[] = [
      `【当前阶段】第 ${state.round} 轮 · ${phase.name}`,
      `【在场的人】${alivePlayers(state).map((p) => p.name).join('、')}`,
    ];

    if (isSoup) {
      extra.push(
        '【你是海龟汤的回答者】你只能回答「是」「不是」「无关」三种，不能多说一个字',
        '回答前先在心里对照你掌握的真相判断，不要被用户的措辞带偏',
        '轮到你猜答案时，如果猜得接近真相就回答「接近了」，完全正确就公布真相',
      );
    } else {
      const top = [...state.players].filter((p) => p.id !== player.id).sort((a, b) => b.score - a.score)[0];
      extra.push(
        '【恋爱线】你要争取主角的注意力，但不要直接说「我喜欢你」，用行动和细节表达',
        `【当前好感度领先的是】${top ? `${top.name}（${top.score}）` : '无人'}`,
        '【机制】主角说的话会影响你对他的好感，也会让你对其他角色产生竞争/吃醋心理',
        '每个阶段只需要一个动作：说一句话，或者做一个亲密举动（flirt/confess）',
      );
    }

    const system = baseSystem({ config, player, memories, extra: extra.join('\n') });

    const expect: string[] = isSoup
      ? (/host|主持/.test(player.roleKey) ? ['answer'] : ['ask', 'speak'])
      : ['speak', 'flirt', 'confess'];

    const user = [
      `【最近发生的】\n${renderHistory(visible, config.costs?.contextWindow ?? 20)}`,
      actionSpec(expect, config),
    ].join('\n\n');

    return {
      system,
      messages: [{ role: 'user', content: user }],
      expect,
      outputMode: 'json',
      model: player.model || '',
      maxTokens: config.costs?.maxOutputTokens ?? 300,
      temperature: 1.0,
    };
  }

  parseAction(aiOutput: string, player: PlayerState, _config: GameConfig): Action {
    const j = extractJson(aiOutput);
    if (!j) return { kind: 'speak', actorId: player.id, text: aiOutput.trim().slice(0, 200) };
    return {
      kind: (str(j.kind) ?? 'speak') as Action['kind'],
      actorId: player.id,
      targetId: str(j.target),
      text: str(j.text) ?? str(j.content) ?? str(j.answer),
      raw: j,
    };
  }

  applyAction(state: GameState, action: Action, config: GameConfig): GameState {
    const s = clone(state);
    const d = s.data as unknown as GroupChatData;
    const actor = s.players.find((p) => p.id === action.actorId);
    if (!actor) return s;

    // 恋爱：文本内容影响所有 AI 对主角的印象
    // （用户发言的加减分走 applyUserMessage，由 Runtime 调用）

    if (action.kind === 'ask' || action.kind === 'question') {
      d.asked = d.asked ?? [];
      const host = s.players.find((p) => /host|主持/.test(p.roleKey));
      d.asked.push({ who: actor.name, q: action.text ?? '', a: '(待主持回答)' });
      if (host && d.riddle) host.private['最近被问'] = action.text ?? '';
    }

    if (action.kind === 'answer' && action.amount !== undefined) {
      const last = d.asked?.[d.asked.length - 1];
      if (last) last.a = action.text ?? '';
    }

    if (action.kind === 'flirt' || action.kind === 'confess') {
      actor.score += action.kind === 'confess' ? 2 : 1;
      d.affectionLog = d.affectionLog ?? [];
      d.affectionLog.push({ who: actor.name, delta: 1, reason: action.kind });
    }

    s.data = d as unknown as Record<string, unknown>;
    return s;
  }

  /** 用户插话时：给所有 AI 算好感度增减 */
  applyUserMessage(state: GameState, text: string, config: GameConfig): GameState {
    const s = clone(state);
    const d = s.data as unknown as GroupChatData;
    if (d.riddle) return s;

    let delta = 0;
    for (const w of POS_WORDS) if (text.includes(w)) delta += 1;
    for (const w of NEG_WORDS) if (text.includes(w)) delta -= 1;
    delta = Math.max(-2, Math.min(2, delta));
    if (delta === 0) delta = 0.5;                       // 中性发言也涨一点，避免卡死
    for (const p of s.players) p.score += delta;

    if (d.affectionLog) d.affectionLog.push({ who: '主角', delta, reason: text.slice(0, 12) });

    // 好感度分化触发冲突
    const scores = s.players.map((p) => p.score);
    if (!d.conflictTriggered && Math.max(...scores) - Math.min(...scores) > 8) {
      d.conflictTriggered = true;
      s.log.push({
        round: s.round, phase: s.phase, kind: 'conflict',
        text: '有人忍不住了，气氛变得微妙', visibleTo: null,
      });
    }
    s.data = d as unknown as Record<string, unknown>;
    return s;
  }

  nextSpeaker(state: GameState, config: GameConfig, alreadySpoke: string[]): PlayerState | null {
    const phase = config.phases[state.phaseIndex]!;
    const all = state.players.filter((p) => p.isAi && p.alive);
    // actors 支持：all / alive / host（只让主持人说）/ askers（除了主持人，都能提问）
    const pool = phase.actors === 'host'
      ? all.filter((p) => /host|主持|judge|法官/.test(p.roleKey))
      : phase.actors === 'custom'
        ? all.filter((p) => !/host|主持|judge|法官/.test(p.roleKey))
        : all;

    if (phase.mode === 'sequential') {
      // speaksPerActor > 1 时，同一个角色在一个阶段里能说多句
      const limit = phase.speaksPerActor ?? 1;
      if (limit > 1) {
        const counts = new Map<string, number>();
        for (const id of alreadySpoke) counts.set(id, (counts.get(id) ?? 0) + 1);
        const next = pool.find((p) => (counts.get(p.id) ?? 0) < limit);
        if (!next) return null;
        // 轮转：优先找发言次数最少、座位最靠前的
        return [...pool].sort((a, b) => (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0) || a.seat - b.seat)[0]!;
      }
      return pool.find((p) => !alreadySpoke.includes(p.id)) ?? null;
    }
    if (phase.mode === 'parallel') return pool.find((p) => !alreadySpoke.includes(p.id)) ?? null;
    return null;
  }

  narration(state: GameState, config: GameConfig): string | null {
    const phase = config.phases[state.phaseIndex]!;
    if (phase.narration) return phase.narration;
    const d = state.data as unknown as GroupChatData;
    if (phase.key === 'riddle' && !state.log.some((l) => l.kind === 'riddle_shown')) {
      return `汤面：${d.riddle?.title ?? ''}`;
    }
    return null;
  }

  checkWin(state: GameState, config: GameConfig): WinResult | null {
    const d = state.data as unknown as GroupChatData;
    if (d.riddle) {
      const solved = state.log.some((l) => l.kind === 'solved');
      if (solved) return { winner: 'user', label: '真相被还原', reason: '问题问到了关键点' };
      return null;
    }
    const best = [...state.players].sort((a, b) => b.score - a.score)[0];
    if (best && best.score >= Number(config.winCondition.confessThreshold ?? 20)) {
      return { winner: 'ai', label: `${best.name} 赢了`, reason: `好感度 ${best.score} 达到表白线` };
    }
    return null;
  }

  summarize(state: GameState, config: GameConfig): SummaryCard {
    const d = state.data as unknown as GroupChatData;
    const isSoup = Boolean(d.riddle);

    if (isSoup) {
      const asked = d.asked ?? [];
      return buildSummary({
        title: `${config.name} · 真相揭晓`,
        winner: state.winner?.label ?? '故事结束',
        highlights: [
          `真相：${d.riddle?.truth ?? ''}`,
          `共提问 ${asked.length} 次`,
          asked.length ? `最后的问题：${asked[asked.length - 1]!.q}` : '没人问到关键点',
        ],
        stats: [
          { label: '轮次', value: String(state.round) },
          { label: '提问数', value: String(asked.length) },
        ],
        mvp: asked.length
          ? { name: asked.sort((a, b) => b.a.length - a.a.length)[0]!.who, reason: '问到了最接近真相的那个问题' }
          : undefined,
        review: [
          '海龟汤的关键是把大问题拆成小问题',
          '「是不是有人死了」这类问题信息量最大',
          '如果重来：先定死时间地点，再问动机',
        ],
        roomId: state.roomId,
      });
    }

    const ranked = [...state.players].sort((a, b) => b.score - a.score);
    const cp = ranked[0];
    return buildSummary({
      title: `${config.name} · 结局`,
      winner: state.winner?.label ?? `好感度最高：${cp?.name ?? '无人'}`,
      highlights: [
        `最终 CP：${cp ? `${cp.name}（好感度 ${cp.score}）` : '单身结局'}`,
        `好感度曲线：${(d.affectionLog ?? []).slice(-6).map((l) => `${l.who}${l.delta > 0 ? '+' : ''}${l.delta}`).join(' ')}`,
        d.conflictTriggered ? '中间爆发过一次正面冲突' : '全程气氛平和，没有人撕破脸',
      ],
      stats: ranked.slice(0, 4).map((p) => ({ label: p.name, value: String(p.score) })),
      mvp: cp ? { name: cp.name, reason: '笑到最后的那个人' } : undefined,
      review: [
        '你更偏心谁，谁就更容易主动',
        '冷落的人会明显变得沉默，但不会明说',
        '如果重来：在冲突那轮选边站，结局会完全不同',
      ],
      roomId: state.roomId,
    });
  }
}
