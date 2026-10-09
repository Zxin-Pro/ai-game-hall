import type { GameConfig, GameState, PlayerState } from './types.js';
import type { Action, GameEngine, Message, Prompt, SummaryCard, WinResult } from './engine.js';
import {
  actionSpec, alivePlayers, baseSystem, buildSummary, clone, extractJson, filterVisible,
  renderHistory, resolveRoles, str, uid,
} from './base.js';

/* ------------------------------------------------------------------ */
/* debate：模拟法庭                                                     */
/* ------------------------------------------------------------------ */

interface DebateData {
  /** 案件事实 */
  case?: { title: string; facts: string; charge: string; evidence: string[] };
  /** 双方立场得分 */
  score: { plaintiff: number; defendant: number };
  /** 已提交证据 */
  evidence: { by: string; name: string; weight: number; text: string }[];
  /** 反对计数 */
  objections: { by: string; target: string; text: string; sustained: boolean }[];
  /** 陪审团投票 */
  juryVotes: Record<string, 'plaintiff' | 'defendant'>;
}

export class DebateEngine implements GameEngine {
  readonly type = 'debate' as const;

  initState(config: GameConfig, players: PlayerState[], roomId: string): GameState {
    const assigned = resolveRoles(config, players);
    const next = players.map((p, i) => {
      const role = assigned[i]!;
      const isJudge = /judge|法官/.test(role.key);
      const camp = role.camp && role.camp !== '' ? role.camp
        : /plaintiff|原告/.test(role.key) ? 'plaintiff'
          : /defendant|被告/.test(role.key) ? 'defendant'
            : /jury|陪审/.test(role.key) ? 'jury'
              : /witness|证人/.test(role.key) ? 'witness' : 'judge';
      return {
        ...clone(p),
        seat: p.seat ?? i,
        roleKey: role.key,
        camp: isJudge ? 'judge' : camp,
        alive: true,
        score: 0,
        private: {} as Record<string, unknown>,
      };
    });

    const pool = (config.data?.cases ?? []) as { title: string; facts: string; charge: string; evidence: string[] }[];
    const caseFile = pool.length ? pool[Math.floor(Math.random() * pool.length)]! : undefined;

    const data: DebateData = {
      case: caseFile,
      score: { plaintiff: 0, defendant: 0 },
      evidence: [],
      objections: [],
      juryVotes: {},
    };

    if (caseFile) {
      for (const p of next) {
        if (/plaintiff|原告/.test(p.roleKey)) p.private['你的当事人主张'] = `${caseFile.charge}｜${caseFile.facts}`;
        if (/defendant|被告/.test(p.roleKey)) p.private['你要反驳的指控'] = caseFile.charge;
        if (/witness|证人/.test(p.roleKey)) p.private['你知道的证词'] = caseFile.evidence[0] ?? '';
      }
    }

    return {
      roomId,
      gameId: config.id,
      engineType: 'debate',
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
    const d = s.data as unknown as DebateData;
    const cur = config.phases[s.phaseIndex]!;
    if (cur.key === 'cross_examination') d.objections = [];
    if (cur.key === 'verdict') d.juryVotes = {};

    s.phaseIndex += 1;
    if (s.phaseIndex >= config.phases.length) {
      s.phaseIndex = config.phases.length - 1;
      s.finished = true;
      s.status = 'finished';
      s.winner = this.decide(s, config);
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
    const d = state.data as unknown as DebateData;
    const camp = player.camp;

    const extra = [
      `【当前阶段】${phase.name}`,
      `【案件】${d.case?.title ?? ''}｜${d.case?.facts ?? ''}`,
      `【指控】${d.case?.charge ?? ''}`,
      `【你的立场】${camp === 'plaintiff' ? '原告方，你要证明对方有罪' : camp === 'defendant' ? '被告方，你要争取无罪或减责' : '中立，你要公正裁判'}`,
      `【庭审纪律】一次只说一个动作，涉及证据要引用具体证据名，涉及反对要在对方发言后立刻提出`,
      '不要背法条，用常识和逻辑说服陪审团',
    ];

    if (/judge|法官/.test(player.roleKey)) {
      extra.push('【法官职责】维持秩序、裁定反对是否成立、最后宣判。裁定用 rule 动作，option 填 sustained/overruled');
    }
    if (/jury|陪审/.test(player.roleKey)) {
      extra.push(`【陪审团】你只根据双方表现和证据判断，不受情绪影响。目前原告得分 ${d.score.plaintiff}，被告得分 ${d.score.defendant}`);
    }

    const system = baseSystem({ config, player, memories, extra: extra.join('\n') });
    const expect = phase.allowActions ?? ['speak'];
    const user = [
      `【庭审记录】\n${renderHistory(visible, config.costs?.contextWindow ?? 20)}`,
      actionSpec(expect, config),
    ].join('\n\n');

    return {
      system,
      messages: [{ role: 'user', content: user }],
      expect,
      outputMode: 'json',
      model: player.model || '',
      maxTokens: config.costs?.maxOutputTokens ?? 400,
      temperature: 0.85,
    };
  }

  parseAction(aiOutput: string, player: PlayerState, _config: GameConfig): Action {
    const j = extractJson(aiOutput);
    if (!j) return { kind: 'speak', actorId: player.id, text: aiOutput.trim().slice(0, 240) };
    return {
      kind: (str(j.kind) ?? 'speak') as Action['kind'],
      actorId: player.id,
      targetId: str(j.target),
      text: str(j.text) ?? str(j.content),
      option: str(j.option),
      amount: typeof j.amount === 'number' ? j.amount : undefined,
      raw: j,
    };
  }

  applyAction(state: GameState, action: Action, config: GameConfig): GameState {
    const s = clone(state);
    const d = s.data as unknown as DebateData;
    const actor = s.players.find((p) => p.id === action.actorId);
    if (!actor) return s;

    switch (action.kind) {
      case 'present_evidence': {
        const name = action.text ?? '未命名证据';
        d.evidence.push({ by: actor.name, name, weight: 1, text: name });
        if (actor.camp === 'plaintiff') d.score.plaintiff += 1;
        else if (actor.camp === 'defendant') d.score.defendant += 1;
        break;
      }
      case 'objection': {
        const target = action.targetId ?? '';
        const judge = s.players.find((p) => /judge|法官/.test(p.roleKey));
        // 规则化裁定：反对成功率跟"是否有证据支撑"挂钩
        const hasEvidence = d.evidence.length > 0;
        const sustained = hasEvidence && Math.random() < 0.6;
        d.objections.push({ by: actor.name, target, text: action.text ?? '', sustained });
        if (judge) {
          s.log.push({
            round: s.round, phase: s.phase, visibleTo: null, kind: 'ruling',
            text: `法官裁定：反对${sustained ? '成立' : '不成立'}`,
          });
        }
        break;
      }
      case 'vote': {
        if (actor.camp === 'judge') break;
        d.juryVotes[actor.id] = (action.option === 'defendant' ? 'defendant' : 'plaintiff');
        break;
      }
      case 'speak':
      default: {
        // 发言质量粗判：引用证据 / 逻辑连接词 → 加分
        const t = action.text ?? '';
        const bonus = (/(证据|证词|矛盾|时间线|因此|所以|反证)/.test(t) ? 1 : 0);
        if (actor.camp === 'plaintiff') d.score.plaintiff += bonus * 0.5;
        if (actor.camp === 'defendant') d.score.defendant += bonus * 0.5;
        break;
      }
    }

    s.data = d as unknown as Record<string, unknown>;
    return s;
  }

  nextSpeaker(state: GameState, config: GameConfig, alreadySpoke: string[]): PlayerState | null {
    const phase = config.phases[state.phaseIndex]!;
    const actors = phase.actors ?? 'all';

    const matches = (p: PlayerState): boolean => {
      switch (actors) {
        case 'host': return /judge|法官/.test(p.roleKey);
        case 'plaintiff': return p.camp === 'plaintiff' || /plaintiff|原告/.test(p.roleKey);
        case 'defendant': return p.camp === 'defendant' || /defendant|被告/.test(p.roleKey);
        case 'lawyers': return /lawyer|律师/.test(p.roleKey);
        case 'witness': return /witness|证人/.test(p.roleKey);
        case 'jury': return /jury|陪审/.test(p.roleKey);
        case 'custom': return p.camp !== 'judge';
        case 'alive':
        default: return true;
      }
    };

    const pool = state.players
      .filter((p) => p.alive && matches(p))
      .sort((a, b) => a.seat - b.seat);

    if (!pool.length) return null;

    const limit = phase.speaksPerActor ?? 1;
    if (limit > 1 && (phase.mode === 'sequential' || phase.mode === 'parallel')) {
      const counts = new Map<string, number>();
      for (const id of alreadySpoke) counts.set(id, (counts.get(id) ?? 0) + 1);
      const next = [...pool]
        .filter((p) => (counts.get(p.id) ?? 0) < limit)
        .sort((a, b) => (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0) || a.seat - b.seat)[0];
      return next ?? null;
    }

    if (phase.mode === 'sequential' || phase.mode === 'parallel' || phase.mode === 'vote') {
      return pool.find((p) => !alreadySpoke.includes(p.id)) ?? null;
    }
    return null;
  }

  narration(state: GameState, config: GameConfig): string | null {
    const phase = config.phases[state.phaseIndex]!;
    const d = state.data as unknown as DebateData;
    if (phase.narration) return phase.narration;
    if (phase.key === 'opening') return `现在开庭。本案：${d.case?.title ?? ''}`;
    if (phase.mode === 'vote') return '陪审团开始评议，请投票';
    return null;
  }

  private decide(state: GameState, config: GameConfig): WinResult {
    const d = state.data as unknown as DebateData;
    const votesPl = Object.values(d.juryVotes).filter((v) => v === 'plaintiff').length;
    const votesDf = Object.values(d.juryVotes).filter((v) => v === 'defendant').length;
    const total = d.score.plaintiff + d.score.defendant;
    const plRatio = total > 0 ? d.score.plaintiff / total : 0.5;

    if (votesPl === votesDf) {
      // 陪审团平票 → 看表现分
      if (plRatio > 0.62) return { winner: 'plaintiff', label: '原告胜诉', reason: '陪审团意见分歧，但原告举证更有力' };
      if (plRatio < 0.38) return { winner: 'defendant', label: '被告胜诉', reason: '陪审团意见分歧，被告抗辩更站得住' };
      return { winner: 'draw', label: '和议未决', reason: '双方表现势均力敌' };
    }
    return votesPl > votesDf
      ? { winner: 'plaintiff', label: '原告胜诉', reason: `陪审团 ${votesPl}:${votesDf} 支持原告` }
      : { winner: 'defendant', label: '被告胜诉', reason: `陪审团 ${votesDf}:${votesPl} 支持被告` };
  }

  checkWin(state: GameState, config: GameConfig): WinResult | null {
    if (!state.finished) return null;
    return this.decide(state, config);
  }

  summarize(state: GameState, config: GameConfig): SummaryCard {
    const d = state.data as unknown as DebateData;
    const keyEvidence = [...d.evidence].sort((a, b) => b.weight - a.weight).slice(0, 3);
    return buildSummary({
      title: `${config.name} · ${d.case?.title ?? '庭审结束'}`,
      winner: state.winner?.label ?? '休庭',
      highlights: [
        state.winner?.reason ?? '',
        `关键证据：${keyEvidence.map((e) => e.name).join('、') || '双方均未提交有效证据'}`,
        `反对 ${d.objections.length} 次，其中 ${d.objections.filter((o) => o.sustained).length} 次被采纳`,
      ],
      stats: [
        { label: '原告表现分', value: d.score.plaintiff.toFixed(1) },
        { label: '被告表现分', value: d.score.defendant.toFixed(1) },
        { label: '陪审票', value: `${Object.values(d.juryVotes).filter((v) => v === 'plaintiff').length} : ${Object.values(d.juryVotes).filter((v) => v === 'defendant').length}` },
      ],
      mvp: d.evidence.length
        ? { name: d.evidence[0]!.by, reason: '第一个把关键证据甩在桌上的人' }
        : undefined,
      review: [
        '庭上第一句定调，谁先框住议题谁占优',
        '反对不是为了打断，是为了留下«对方急了»的印象',
        '如果重来：把最有力的证据留到结案陈词',
      ],
      roomId: state.roomId,
    });
  }
}
