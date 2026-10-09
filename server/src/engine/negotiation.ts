import type { GameConfig, GameState, PlayerState } from './types.js';
import type { Action, GameEngine, Message, Prompt, SummaryCard, WinResult } from './engine.js';
import {
  actionSpec, baseSystem, buildSummary, clone, extractJson, filterVisible, resolveRoles,
  renderHistory, str, num,
} from './base.js';

/* ------------------------------------------------------------------ */
/* negotiation：商业谈判                                                */
/* ------------------------------------------------------------------ */

interface NegotiationData {
  /** 每方隐藏底线 */
  anchors: Record<string, number>;       // playerId -> 真正底线
  /** 挂牌价 / 初始锚点 */
  listPrice: number;
  /** 当前最优报价 */
  bestOffer?: { by: string; amount: number; includes: string };
  /** 出价历史 */
  history: { by: string; amount: number; kind: string; round: number }[];
  /** 最后通牒轮 */
  ultimatum: boolean;
  /** 谁已走人 */
  walked: string[];
  /** 成交价 */
  dealPrice?: number;
}

const START_PRICE = 1000;

export class NegotiationEngine implements GameEngine {
  readonly type = 'negotiation' as const;

  initState(config: GameConfig, players: PlayerState[], roomId: string): GameState {
    const assigned = resolveRoles(config, players);
    const next = players.map((p, i) => {
      const role = assigned[i]!;
      const isBuyer = role.key === 'buyer';
      const isSeller = role.key === 'seller';
      const anchor = isBuyer
        ? START_PRICE * (0.9 + Math.random() * 0.3)     // 买方最高能给多少
        : isSeller
          ? START_PRICE * (0.45 + Math.random() * 0.25) // 卖方真正想拿多少
          : START_PRICE * 0.8;
      const pressure = isBuyer ? '你本周必须敲定，否则预算会被收回' : isSeller
        ? '你已经聊了三个买家，资金链撑不到下个月' : '你只是促成交易拿佣金';
      return {
        ...clone(p),
        seat: p.seat ?? i,
        roleKey: role.key,
        camp: role.camp || role.key,
        alive: true,
        score: 0,
        private: {
          '你的真实底线': isBuyer ? `最多出到 ${anchor.toFixed(0)}` : isSeller ? `低于 ${anchor.toFixed(0)} 就不卖` : '佣金 3%',
          '你的时间压力': pressure,
          '谈判禁忌': '永远不要第一个报出你的底线',
        } as Record<string, unknown>,
      };
    });

    const data: NegotiationData = {
      anchors: Object.fromEntries(next.map((p) => [p.id, Number(String(p.private['你的真实底线']).match(/\d+/)?.[0] ?? START_PRICE)])),
      listPrice: START_PRICE,
      history: [],
      ultimatum: false,
      walked: [],
    };

    return {
      roomId, gameId: config.id, engineType: 'negotiation',
      round: 1, phase: config.phases[0]!.key, phaseIndex: 0, status: 'running',
      players: next, data: data as unknown as Record<string, unknown>,
      log: [], pending: [], finished: false,
    };
  }

  nextPhase(state: GameState, config: GameConfig): GameState {
    const s = clone(state);
    const d = s.data as unknown as NegotiationData;
    s.phaseIndex += 1;
    const atEnd = s.phaseIndex >= config.phases.length;
    if (atEnd) {
      if (d.dealPrice !== undefined || d.walked.length >= s.players.length - 1 || s.round >= config.maxRounds) {
        s.finished = true;
        s.status = 'finished';
        s.winner = this.decide(s, config);
      } else {
        s.phaseIndex = config.phases.length - 1;  // 最后通牒阶段循环
        s.round += 1;
      }
    }
    s.phase = config.phases[s.phaseIndex]!.key;
    if (s.phase === 'ultimatum') d.ultimatum = true;
    if (s.round > config.maxRounds) {
      s.finished = true;
      s.status = 'finished';
      s.winner = this.decide(s, config);
    }
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
    const d = state.data as unknown as NegotiationData;
    const extra = [
      `【当前阶段】${phase.name}`,
      `【你的角色】${player.camp === 'buyer' ? '买方' : player.camp === 'seller' ? '卖方' : '中介'}`,
      `【当前最优报价】${d.bestOffer ? `${d.bestOffer.amount.toFixed(0)}（由 ${d.bestOffer.by} 提出）` : '还没有人开价'}`,
      `【你的底线只有你知道，绝不能报出来】`,
      d.ultimatum ? '【最后通牒】这是最后一轮，报价即终局，接受或走人' : '',
      '【谈判风格】先给理由再给数字，制造竞争感，必要时用沉默和走人施压',
      '一次只提一个报价，不要连报三个数字',
    ].filter(Boolean);

    return {
      system: baseSystem({ config, player, memories, extra: extra.join('\n') }),
      messages: [{
        role: 'user',
        content: [
          `【谈判记录】\n${renderHistory(visible, config.costs?.contextWindow ?? 20)}`,
          actionSpec(phase.allowActions ?? ['offer', 'accept', 'walk_away'], config),
        ].join('\n\n'),
      }],
      expect: phase.allowActions ?? ['offer'],
      outputMode: 'json',
      model: player.model || '',
      maxTokens: config.costs?.maxOutputTokens ?? 300,
      temperature: 0.9,
    };
  }

  parseAction(aiOutput: string, player: PlayerState, _config: GameConfig): Action {
    const j = extractJson(aiOutput);
    if (!j) {
      const amount = Number(aiOutput.match(/\d{2,6}/)?.[0] ?? NaN);
      return { kind: 'offer', actorId: player.id, text: aiOutput.trim().slice(0, 200), amount: Number.isFinite(amount) ? amount : undefined };
    }
    return {
      kind: (str(j.kind) ?? 'offer') as Action['kind'],
      actorId: player.id,
      targetId: str(j.target),
      text: str(j.text) ?? str(j.content),
      amount: num(j.amount) ?? num(j.price),
      option: str(j.option),
      raw: j,
    };
  }

  applyAction(state: GameState, action: Action, config: GameConfig): GameState {
    const s = clone(state);
    const d = s.data as unknown as NegotiationData;
    const actor = s.players.find((p) => p.id === action.actorId);
    if (!actor) return s;
    const mine = d.anchors[actor.id] ?? START_PRICE;

    switch (action.kind) {
      case 'offer':
      case 'counter': {
        const amount = action.amount ?? mine;
        // 违规：超出自己的底线 → 标记，扣分
        const illegal = actor.camp === 'buyer' ? amount > mine : actor.camp === 'seller' ? amount < mine : false;
        if (illegal) {
          actor.score -= 1;
          s.log.push({ round: s.round, phase: s.phase, kind: 'breach', visibleTo: null, text: `${actor.name} 报出了超出自己授权的价格` });
          break;
        }
        d.bestOffer = { by: actor.name, amount, includes: action.text ?? '' };
        d.history.push({ by: actor.name, amount, kind: action.kind, round: s.round });
        break;
      }
      case 'accept': {
        if (d.bestOffer) {
          d.dealPrice = d.bestOffer.amount;
          actor.score += 2;
          s.finished = true;
        }
        break;
      }
      case 'walk_away': {
        d.walked.push(actor.id);
        s.log.push({ round: s.round, phase: s.phase, kind: 'walk', visibleTo: null, text: `${actor.name} 起身离开谈判桌` });
        break;
      }
      case 'threaten': {
        // 威胁过度会扣信誉
        if ((action.text ?? '').length > 40) actor.score -= 0.5;
        break;
      }
    }

    if (d.dealPrice !== undefined) {
      s.finished = true;
      s.status = 'finished';
      s.winner = this.decide(s, config);
    }
    s.data = d as unknown as Record<string, unknown>;
    return s;
  }

  nextSpeaker(state: GameState, config: GameConfig, alreadySpoke: string[]): PlayerState | null {
    const phase = config.phases[state.phaseIndex]!;
    const pool = state.players.filter((p) => !(state.data as unknown as NegotiationData).walked.includes(p.id));
    if (phase.mode === 'sequential' || phase.mode === 'parallel') {
      return pool.find((p) => !alreadySpoke.includes(p.id)) ?? null;
    }
    return null;
  }

  narration(state: GameState, config: GameConfig): string | null {
    const phase = config.phases[state.phaseIndex]!;
    if (phase.narration) return phase.narration;
    if (phase.key === 'opening') return '谈判开始，桌子两边都坐好了';
    if (phase.key === 'ultimatum') return '时间到了，最后通牒';
    return null;
  }

  private decide(state: GameState, config: GameConfig): WinResult {
    const d = state.data as unknown as NegotiationData;
    if (d.dealPrice === undefined) {
      return { winner: 'draw', label: '谈判破裂', reason: '双方没能达成一致，各自离场' };
    }
    const buyers = state.players.filter((p) => p.camp === 'buyer');
    const sellers = state.players.filter((p) => p.camp === 'seller');
    const buyerCeil = Math.max(...buyers.map((p) => d.anchors[p.id] ?? START_PRICE), 0);
    const sellerFloor = sellers.length ? Math.min(...sellers.map((p) => d.anchors[p.id] ?? 0)) : 0;
    const mid = (buyerCeil + sellerFloor) / 2;
    if (d.dealPrice <= mid && sellers.length) {
      return { winner: 'buyer', label: '买方赢下这一局', reason: `成交价 ${d.dealPrice.toFixed(0)} 低于双方底线中位 ${mid.toFixed(0)}` };
    }
    return { winner: 'seller', label: '卖方赢下这一局', reason: `成交价 ${d.dealPrice.toFixed(0)} 高于双方底线中位 ${mid.toFixed(0)}` };
  }

  checkWin(state: GameState, config: GameConfig): WinResult | null {
    if (!state.finished) return null;
    return this.decide(state, config);
  }

  summarize(state: GameState, config: GameConfig): SummaryCard {
    const d = state.data as unknown as NegotiationData;
    const buyer = state.players.find((p) => p.camp === 'buyer');
    const seller = state.players.find((p) => p.camp === 'seller');
    const n = d.history.length;
    const shape = d.history.map((h) => h.amount.toFixed(0)).join(' → ');
    return buildSummary({
      title: `${config.name} · ${d.dealPrice !== undefined ? '成交' : '流局'}`,
      winner: state.winner?.label ?? '未成交',
      highlights: [
        d.dealPrice !== undefined ? `成交价 ${d.dealPrice.toFixed(0)}` : '没有成交',
        `买方底线 ${buyer ? (d.anchors[buyer.id] ?? 0).toFixed(0) : '-'}｜卖方底线 ${seller ? (d.anchors[seller.id] ?? 0).toFixed(0) : '-'}`,
        `出价轨迹（${n} 次）：${shape}`,
      ],
      stats: [
        { label: '出价次数', value: String(n) },
        { label: '离场人数', value: String(d.walked.length) },
        { label: '成交价', value: d.dealPrice !== undefined ? d.dealPrice.toFixed(0) : '—' },
      ],
      mvp: d.bestOffer ? { name: d.bestOffer.by, reason: '最后一次报价，把节奏攥在自己手里' } : undefined,
      review: [
        '先开价的人框定了整个区间，但风险是暴露意图',
        '真正的底线永远比说出口的低/高 15% 左右',
        d.dealPrice !== undefined ? '成交的关键是让对方觉得是自己赢的' : '如果重来：别把时间压力写在脸上',
      ],
      roomId: state.roomId,
    });
  }
}
