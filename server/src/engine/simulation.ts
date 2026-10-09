import type { GameConfig, GameState, PlayerState } from './types.js';
import type { Action, GameEngine, Message, Prompt, SummaryCard, WinResult } from './engine.js';
import {
  actionSpec, baseSystem, buildSummary, clone, extractJson, filterVisible, resolveRoles,
  renderHistory, str, uid,
} from './base.js';

/* ------------------------------------------------------------------ */
/* simulation：AI 创业公司                                              */
/* ------------------------------------------------------------------ */

interface SimData {
  /** 公司指标 */
  valuation: number;      // 估值（万）
  cash: number;           // 现金（万）
  product: number;        // 产品力 0-100
  team: number;           // 团队 0-100
  market: number;         // 市场热度 0-100
  /** 本轮事件 */
  event?: { title: string; desc: string; effect: string };
  /** 决策记录 */
  decisions: { who: string; kind: string; text: string; round: number; delta: Record<string, number> }[];
  /** 估值曲线 */
  curve: number[];
  /** 最大失误 */
  worst?: { who: string; kind: string; text: string; round: number };
}

const EVENTS = [
  { title: '竞品融资', desc: '最大竞品拿到 5000 万 A 轮', effect: 'market-15', d: { market: -15 } },
  { title: '政策利好', desc: '行业被写进政府工作报告', effect: 'market+20', d: { market: 20 } },
  { title: '黑天鹅', desc: '核心供应商突然断供', effect: 'product-20', d: { product: -20 } },
  { title: '病毒式传播', desc: '产品被大 V 自发安利', effect: 'market+25 product+5', d: { market: 25, product: 5 } },
  { title: '核心员工离职', desc: '技术负责人被挖走', effect: 'team-18', d: { team: -18 } },
  { title: '大厂入场', desc: '巨头宣布下场做同款', effect: 'market-25', d: { market: -25 } },
  { title: '资本寒冬', desc: '融资环境骤然收紧', effect: 'cash-80', d: { cash: -80 } },
];

export class SimulationEngine implements GameEngine {
  readonly type = 'simulation' as const;

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
        private: {
          '你的岗位 KPI': /ceo/i.test(role.key) ? '把估值做上去，别把钱烧光'
            : /cto/i.test(role.key) ? '产品力和团队不能塌'
              : /cmo/i.test(role.key) ? '市场热度是你的命'
                : /cfo/i.test(role.key) ? '现金流断了大家一起死'
                  : '投出下一个百倍',
          '你的秘密担忧': /cfo/i.test(role.key) ? 'CEO 总是乱花钱' : '这一轮融资可能撑不过去',
        } as Record<string, unknown>,
      };
    });

    // 起始盘：现金够烧 4 轮左右，逼玩家在「做产品」和「砸市场」之间取舍
    const data: SimData = {
      valuation: 1000, cash: 1200, product: 40, team: 50, market: 30,
      decisions: [], curve: [1000],
    };

    return {
      roomId, gameId: config.id, engineType: 'simulation',
      round: 1, phase: config.phases[0]!.key, phaseIndex: 0, status: 'running',
      players: next, data: data as unknown as Record<string, unknown>,
      log: [], pending: [], finished: false,
    };
  }

  nextPhase(state: GameState, config: GameConfig): GameState {
    const s = clone(state);
    const d = s.data as unknown as SimData;
    s.phaseIndex += 1;
    if (s.phaseIndex >= config.phases.length) {
      s.phaseIndex = 0;
      s.round += 1;
      // 每轮开头抛一个事件
      const ev = EVENTS[Math.floor(Math.random() * EVENTS.length)]!;
      d.event = ev;
      for (const [k, v] of Object.entries(ev.d)) {
        (d as unknown as Record<string, number>)[k] += v as number;
      }
      s.log.push({ round: s.round, phase: 'event', kind: 'event', visibleTo: null, text: `【${ev.title}】${ev.desc}` });
      d.curve.push(Math.round(d.valuation));
    }
    s.phase = config.phases[s.phaseIndex]!.key;
    s.pending = [];

    // 破产 / 估值到顶 / 轮次用完
    if (d.cash <= 0 || s.round > config.maxRounds) {
      s.finished = true;
      s.status = 'finished';
      s.winner = this.decide(s, config);
    }
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
    const d = state.data as unknown as SimData;
    const extra = [
      `【当前阶段】第 ${state.round} 轮 · ${phase.name}`,
      `【公司现状】估值 ${d.valuation.toFixed(0)} 万｜现金 ${d.cash.toFixed(0)} 万｜产品力 ${d.product.toFixed(0)}｜团队 ${d.team.toFixed(0)}｜市场热度 ${d.market.toFixed(0)}`,
      d.event ? `【本轮事件】${d.event.title}：${d.event.desc}` : '',
      `【你的岗位】${player.roleKey}`,
      '【决策原则】每个决策都要落到具体数字上，说清花多少钱、换来什么，别喊口号',
      '如果现金低于 100 万，任何花钱提案都要先说明回本路径',
    ].filter(Boolean);

    return {
      system: baseSystem({ config, player, memories, extra: extra.join('\n') }),
      messages: [{
        role: 'user',
        content: [
          `【会议记录】\n${renderHistory(visible, config.costs?.contextWindow ?? 20)}`,
          actionSpec(phase.allowActions ?? ['invest', 'build'], config),
        ].join('\n\n'),
      }],
      expect: phase.allowActions ?? ['speak'],
      outputMode: 'json',
      model: player.model || '',
      maxTokens: config.costs?.maxOutputTokens ?? 350,
      temperature: 0.9,
    };
  }

  parseAction(aiOutput: string, player: PlayerState, _config: GameConfig): Action {
    const j = extractJson(aiOutput);
    if (!j) return { kind: 'speak', actorId: player.id, text: aiOutput.trim().slice(0, 200) };
    return {
      kind: (str(j.kind) ?? 'speak') as Action['kind'],
      actorId: player.id,
      text: str(j.text) ?? str(j.content),
      amount: typeof j.amount === 'number' ? j.amount : Number(String(j.amount ?? '').replace(/[^\d.]/g, '')) || undefined,
      option: str(j.option),
      raw: j,
    };
  }

  applyAction(state: GameState, action: Action, config: GameConfig): GameState {
    const s = clone(state);
    const d = s.data as unknown as SimData;
    const actor = s.players.find((p) => p.id === action.actorId);
    if (!actor) return s;

    const delta: Record<string, number> = {};
    switch (action.kind) {
      case 'invest': {
        const amt = Math.min(action.amount ?? 50, Math.max(d.cash, 0));
        d.cash -= amt;
        d.market += amt * 0.15;
        delta.cash = -amt; delta.market = amt * 0.15;
        break;
      }
      case 'build': {
        const amt = Math.min(action.amount ?? 40, Math.max(d.cash, 0));
        d.cash -= amt;
        d.product += amt * 0.35;
        delta.cash = -amt; delta.product = amt * 0.35;
        break;
      }
      case 'hire': {
        const amt = Math.min(action.amount ?? 30, Math.max(d.cash, 0));
        d.cash -= amt;
        d.team += amt * 0.3;
        delta.cash = -amt; delta.team = amt * 0.3;
        break;
      }
      case 'pitch': {
        const rounds = Math.max(1, s.round);
        const gain = (d.product * 0.5 + d.market * 0.6 + d.team * 0.3) * (0.6 + Math.random() * 0.5);
        d.valuation += gain;
        d.cash += gain * 0.4;
        delta.valuation = gain; delta.cash = gain * 0.4;
        break;
      }
      case 'cut': {
        d.cash += 60;
        d.team -= 15;
        d.product -= 5;
        delta.cash = 60; delta.team = -15;
        break;
      }
      default: break;
    }

    // 数值封顶，防止跑飞
    d.product = Math.max(0, Math.min(120, d.product));
    d.team = Math.max(0, Math.min(120, d.team));
    d.market = Math.max(0, Math.min(120, d.market));

    const rec = { who: actor.name, kind: action.kind, text: action.text ?? '', round: s.round, delta };
    d.decisions.push(rec);
    // 记录最差决策
    if (!d.worst && (d.cash < 50 || d.product < 10)) d.worst = rec;

    s.data = d as unknown as Record<string, unknown>;
    return s;
  }

  resolvePending(state: GameState, config: GameConfig) {
    const s = clone(state);
    const d = s.data as unknown as SimData;
    // 每阶段末结算估值：估值 = 基础盘 + 产品/团队/市场加权
    const base = 300 + d.product * 3 + d.team * 2.5 + d.market * 4 + d.cash * 0.6;
    const drift = (base - d.valuation) * 0.25;
    d.valuation += drift;
    d.curve.push(Math.round(d.valuation));
    s.data = d as unknown as Record<string, unknown>;
    return { state: s, events: [{ kind: 'valuation', text: `当前估值 ${d.valuation.toFixed(0)} 万｜现金 ${d.cash.toFixed(0)} 万`, visibleTo: null }] };
  }

  nextSpeaker(state: GameState, config: GameConfig, alreadySpoke: string[]): PlayerState | null {
    const phase = config.phases[state.phaseIndex]!;
    const pool = state.players.filter((p) => p.alive).sort((a, b) => a.seat - b.seat);
    if (phase.mode === 'sequential' || phase.mode === 'parallel') {
      return pool.find((p) => !alreadySpoke.includes(p.id)) ?? null;
    }
    return null;
  }

  narration(state: GameState, config: GameConfig): string | null {
    const phase = config.phases[state.phaseIndex]!;
    const d = state.data as unknown as SimData;
    if (phase.narration) return phase.narration;
    if (phase.key === 'round_event' && d.event) return `【${d.event.title}】${d.event.desc}`;
    return null;
  }

  private decide(state: GameState, config: GameConfig): WinResult {
    const d = state.data as unknown as SimData;
    if (d.cash <= 0) return { winner: 'company', label: '公司破产清算', reason: '现金流断裂，故事终止' };
    if (d.valuation >= 5000) return { winner: 'company', label: '独角兽达成', reason: `估值 ${d.valuation.toFixed(0)} 万，成功上岸` };
    return {
      winner: 'company',
      label: `止步于 ${d.valuation.toFixed(0)} 万估值`,
      reason: `轮次用尽，现金还剩 ${d.cash.toFixed(0)} 万`,
    };
  }

  checkWin(state: GameState, config: GameConfig): WinResult | null {
    if (!state.finished) return null;
    return this.decide(state, config);
  }

  summarize(state: GameState, config: GameConfig): SummaryCard {
    const d = state.data as unknown as SimData;
    const curve = d.curve.map((v) => v.toFixed(0)).join(' → ');
    const byWho: Record<string, number> = {};
    for (const dec of d.decisions) byWho[dec.who] = (byWho[dec.who] ?? 0) + 1;
    const busiest = Object.entries(byWho).sort((a, b) => b[1] - a[1])[0];

    return buildSummary({
      title: `${config.name} · 复盘`,
      winner: state.winner?.label ?? '创业未半',
      highlights: [
        `估值曲线：${curve}`,
        `关键决策 ${d.decisions.length} 个`,
        d.worst ? `最大失误：${d.worst.who} 在第 ${d.worst.round} 轮 ${d.worst.kind}` : '全程没有明显翻车',
      ],
      stats: [
        { label: '终局估值', value: `${d.valuation.toFixed(0)} 万` },
        { label: '剩余现金', value: `${d.cash.toFixed(0)} 万` },
        { label: '产品力 / 团队 / 市场', value: `${d.product.toFixed(0)}/${d.team.toFixed(0)}/${d.market.toFixed(0)}` },
      ],
      mvp: busiest ? { name: busiest[0], reason: `全程做了 ${busiest[1]} 个决策，最敢拍板` } : undefined,
      review: [
        '钱要花在能立刻拉动估值的动作上，别均匀撒',
        '市场热度比产品力更容易被资本看见，但要产品托底',
        d.worst ? `第 ${d.worst.round} 轮那个决策把节奏带偏了` : '如果重来：融资窗口一开就 pitch，别等指标完美',
      ],
      roomId: state.roomId,
    });
  }
}
