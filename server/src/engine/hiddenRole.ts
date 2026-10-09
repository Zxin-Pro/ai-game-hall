import type { ConfigPhase, GameConfig, GameState, PlayerState } from './types.js';
import type { Action, EventLog, GameEngine, Message, Prompt, SummaryCard, WinResult } from './engine.js';
import {
  actionSpec, alivePlayers, baseSystem, buildSummary, byRole, clone, expandRoles,
  extractJson, filterVisible, num, playerOf, renderHistory, resolvePlayer, shuffle, str, uid,
} from './base.js';

/* ------------------------------------------------------------------ */
/* hidden_role：狼人杀 + 谁是卧底                                       */
/* ------------------------------------------------------------------ */

interface HiddenRoleData {
  /** 夜晚技能收集 */
  night: {
    wolfKill?: string;
    wolfVotes?: Record<string, string>;   // actorId -> targetId
    seerCheck?: { actorId: string; targetId: string; isWolf: boolean };
    witchSave?: boolean;
    witchPoison?: string;
    guardTarget?: string;
  };
  /** 投票收集 */
  votes: Record<string, string>;          // actorId -> targetId
  /** 本轮死亡 */
  deaths: string[];
  /** 所有死亡的累计 */
  graveyard: string[];
  /** 卧底词对 */
  words?: { civilian: string; undercover: string; blank?: string };
  /** 每个玩家本阶段已描述过 */
  described: Record<string, string>;
}

export class HiddenRoleEngine implements GameEngine {
  readonly type = 'hidden_role' as const;

  /* ---------------- 1. initState ---------------- */
  initState(config: GameConfig, players: PlayerState[], roomId: string): GameState {
    const deck = shuffle(expandRoles(config, players.length));
    const next: PlayerState[] = players.map((p, i) => {
      const role = deck[i]!;
      return {
        ...clone(p),
        seat: p.seat ?? i,
        roleKey: role.key,
        camp: role.camp,
        model: p.model ?? role.model,
        alive: true,
        score: 0,
        private: {},
      };
    });

    // 狼人互认
    const wolves = next.filter((p) => p.camp === 'wolf');
    for (const w of wolves) {
      w.private['你的狼队友'] = wolves.filter((x) => x.id !== w.id).map((x) => `${x.seat + 1}号${x.name}`).join('、') || '（只有你一个）';
      w.private['本轮战术'] = config.data?.wolfTactic ?? '白天尽量伪装成好人，别急着跳';
    }

    // 女巫药水
    for (const p of next.filter((x) => /witch|女巫/.test(x.roleKey))) {
      p.private['解药'] = '还没用（可以救一个人）';
      p.private['毒药'] = '还没用（可以毒死一个人）';
      p.private['规则'] = '同一晚不能同时用药；你不知道今晚谁会被刀，但天亮的死人你会看到';
    }

    const data: HiddenRoleData = {
      night: {},
      votes: {},
      deaths: [],
      graveyard: [],
      described: {},
    };

    // 谁是卧底：发词
    if (config.data?.wordPairs) {
      const pairs = config.data.wordPairs as { civilian: string; undercover: string; blank?: string }[];
      const pair = pairs[Math.floor(Math.random() * pairs.length)]!;
      const undercover = next.filter((p) => p.camp === 'undercover');
      const blank = next.filter((p) => p.camp === 'blank');
      data.words = pair;
      for (const p of next) {
        if (undercover.some((u) => u.id === p.id)) p.private['你的词'] = pair.undercover;
        else if (blank.some((b) => b.id === p.id)) p.private['你的词'] = '（你是白板，你不知道自己的词，只能听别人说）';
        else p.private['你的词'] = pair.civilian;
      }
    }

    return {
      roomId,
      gameId: config.id,
      engineType: 'hidden_role',
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

  /* ---------------- 2. nextPhase ---------------- */
  nextPhase(state: GameState, config: GameConfig): GameState {
    const s = clone(state);
    const d = s.data as unknown as HiddenRoleData;

    // 阶段内数据清理：进入新阶段就重置收集器
    const cur = config.phases[s.phaseIndex]!;
    if (cur.mode === 'vote') d.votes = {};
    if (cur.key === 'night' || cur.mode === 'parallel') d.night = {};
    d.deaths = [];
    if (cur.mode === 'sequential') d.described = {};

    s.phaseIndex += 1;
    if (s.phaseIndex >= config.phases.length) {
      if (s.round >= config.maxRounds) {
        // 轮次真的用完了：停在最后一个阶段，直接结算，round 不再往上加
        s.phaseIndex = config.phases.length - 1;
        s.phase = config.phases[s.phaseIndex]!.key;
        s.pending = [];
        s.finished = true;
        s.status = 'finished';
        s.winner = this.forceEnd(s, config);
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

  /* ---------------- 3. 可见性 ---------------- */
  getVisibleMessages(_state: GameState, playerId: string, all: Message[]): Message[] {
    const p = _state.players.find((x) => x.id === playerId);
    if (!p) return all.filter((m) => m.visibleTo === null);
    return filterVisible(all, p);
  }

  /* ---------------- 4. buildPrompt ---------------- */
  buildPrompt(
    state: GameState,
    player: PlayerState,
    config: GameConfig,
    visible: Message[],
    memories: string[],
  ): Prompt {
    const phase = config.phases[state.phaseIndex]!;
    const others = alivePlayers(state).filter((p) => p.id !== player.id)
      .map((p) => `${p.seat + 1}号${p.name}${p.alive ? '' : '（已出局）'}`).join('、');

    const system = baseSystem({
      config,
      player,
      memories,
      extra: [
        `【当前阶段】第 ${state.round} 轮 · ${phase.name}`,
        `【场上存活】${alivePlayers(state).map((p) => `${p.seat + 1}号${p.name}`).join('、')}`,
        `【其他玩家】${others}`,
        this.phaseGuidance(state, player, config),
      ].join('\n'),
    });

    const expect = this.expectActions(state, player, config);
    const user = [
      `【最近发生的】\n${renderHistory(visible, config.costs?.contextWindow ?? 20)}`,
      actionSpec(expect, config),
    ].join('\n\n');

    return {
      system,
      messages: [{ role: 'user', content: user }],
      expect,
      outputMode: 'json',
      model: player.model || config.roles.find((r) => r.key === player.roleKey)?.model || '',
      maxTokens: config.costs?.maxOutputTokens ?? 400,
      temperature: 0.95,
    };
  }

  private phaseGuidance(state: GameState, player: PlayerState, config: GameConfig): string {
    const phase = config.phases[state.phaseIndex]!;
    const d = state.data as unknown as HiddenRoleData;
    const lines: string[] = [];

    if (phase.key === 'night') {
      if (player.camp === 'wolf') {
        lines.push('今晚你要和队友一起决定刀谁。text 里可以写你和队友的悄悄话，只有狼能看见。');
      } else if (/seer|预言/.test(player.roleKey)) {
        lines.push('今晚你要查验一个人，你会知道他是狼人还是好人。');
        const hist = player.private['查验记录'];
        if (hist) lines.push(`你之前的查验：${JSON.stringify(hist)}`);
      } else if (/witch|女巫/.test(player.roleKey)) {
        lines.push('今晚你要决定用不用药。save 救人 / poison 毒人 / pass 不用。你不能救自己。');
      } else if (/guard|守卫/.test(player.roleKey)) {
        lines.push('今晚你要守一个人，被守的人今晚不会被刀，但不能连守同一个。');
      } else {
        lines.push('你今晚没有技能，闭眼睡觉。输出 pass 即可。');
      }
    }
    if (phase.key === 'day' || phase.mode === 'narration') {
      lines.push('天亮了，先别急着说话，等待发言阶段。');
    }
    if (phase.key === 'speak') {
      lines.push(`轮到你发言。你可以分析、怀疑、跳身份、撒谎。已经说过的人不要重复。`);
      if (player.camp === 'wolf') lines.push('你是狼，必须伪装成好人，可以合理怀疑别人，但别把自己人推出去。');
    }
    if (phase.key === 'describe') {
      const w = player.private['你的词'];
      lines.push(`轮到你描述。你的词是「${w}」。用一个短句描述它，不能直接说出词本身，不能太明显也不能太抽象。`);
    }
    if (phase.mode === 'vote') {
      const cands = alivePlayers(state).filter((p) => p.id !== player.id)
        .map((p) => `${p.seat + 1}号${p.name}`).join('、');
      lines.push(`你要投票。候选人：${cands}。你可以投自己以外的任何人，也可以弃票（pass）。`);
      if (player.camp === 'wolf') lines.push('你是狼，优先投好人阵营里发言最有威胁的那个，或者跟票保命。');
    }
    if (d.words) lines.push('记住：你的任务是误导别人或者识破别人的词。');
    return lines.join('\n');
  }

  private expectActions(state: GameState, player: PlayerState, config: GameConfig): string[] {
    const phase = config.phases[state.phaseIndex]!;
    if (phase.allowActions?.length) return phase.allowActions;
    if (phase.key === 'night') {
      if (player.camp === 'wolf') return ['kill', 'pass'];
      if (/seer|预言/.test(player.roleKey)) return ['investigate', 'pass'];
      if (/witch|女巫/.test(player.roleKey)) return ['save', 'poison', 'pass'];
      if (/guard|守卫/.test(player.roleKey)) return ['guard', 'pass'];
      return ['pass'];
    }
    if (phase.key === 'speak') return ['speak'];
    if (phase.key === 'describe') return ['describe'];
    if (phase.mode === 'vote') return ['vote', 'pass'];
    return ['speak'];
  }

  /* ---------------- 5. parseAction ---------------- */
  parseAction(aiOutput: string, player: PlayerState, _config: GameConfig): Action {
    const j = extractJson(aiOutput);
    if (!j) {
      // 模型没按格式来 → 当发言处理，不丢内容
      return { kind: 'speak', actorId: player.id, text: aiOutput.trim().slice(0, 200) };
    }
    return {
      kind: (str(j.kind) ?? 'speak') as Action['kind'],
      actorId: player.id,
      targetId: str(j.target),
      text: str(j.text) ?? str(j.content),
      amount: num(j.amount),
      option: str(j.option),
      raw: j,
    };
  }

  /* ---------------- 6. applyAction ---------------- */
  applyAction(state: GameState, action: Action, config: GameConfig): GameState {
    const s = clone(state);
    const d = s.data as unknown as HiddenRoleData;
    const actor = s.players.find((p) => p.id === action.actorId);
    if (!actor) return s;
    // ★ 模型输出的是名字或座位号，必须转成玩家
    const target = action.targetId ? resolvePlayer(s, action.targetId) : undefined;

    switch (action.kind) {
      case 'kill': {
        if (!target) break;
        d.night.wolfVotes = d.night.wolfVotes ?? {};
        d.night.wolfVotes[actor.id] = target.id;
        // 多狼取票数最高，平票取先说的
        const tally: Record<string, number> = {};
        for (const t of Object.values(d.night.wolfVotes)) tally[t] = (tally[t] ?? 0) + 1;
        const best = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
        d.night.wolfKill = best?.[0];
        break;
      }
      case 'investigate': {
        if (!target) break;
        d.night.seerCheck = { actorId: actor.id, targetId: target.id, isWolf: target.camp === 'wolf' };
        const hist = (actor.private['查验记录'] as string[] | undefined) ?? [];
        hist.push(`${target.seat + 1}号${target.name} → ${d.night.seerCheck.isWolf ? '狼人' : '好人'}`);
        actor.private['查验记录'] = hist;
        break;
      }
      case 'save': {
        if (actor.private['解药'] && !String(actor.private['解药']).includes('已用')) {
          d.night.witchSave = true;
          actor.private['解药'] = '已用（救过一个人）';
        }
        break;
      }
      case 'poison': {
        if (target && actor.private['毒药'] && !String(actor.private['毒药']).includes('已用')) {
          d.night.witchPoison = target.id;
          actor.private['毒药'] = '已用（毒过一个人）';
        }
        break;
      }
      case 'guard': {
        if (target) d.night.guardTarget = target.id;
        break;
      }
      case 'vote': {
        if (target) d.votes[actor.id] = target.id;
        break;
      }
      case 'describe': {
        d.described[actor.id] = action.text ?? '';
        break;
      }
      case 'pass':
      default:
        break;
    }

    s.data = d as unknown as Record<string, unknown>;
    return s;
  }

  /* ---------------- 7. resolvePending ---------------- */
  resolvePending(state: GameState, config: GameConfig) {
    const s = clone(state);
    const d = s.data as unknown as HiddenRoleData;
    const phase = config.phases[s.phaseIndex]!;
    const events: { kind: string; text: string; visibleTo: number[] | null; targetIds?: string[] }[] = [];

    if (phase.mode === 'parallel' || phase.key === 'night') {
      const kills: string[] = [];
      if (d.night.wolfKill && d.night.wolfKill !== d.night.guardTarget) kills.push(d.night.wolfKill);
      if (d.night.witchSave && d.night.wolfKill) {
        const i = kills.indexOf(d.night.wolfKill);
        if (i >= 0) kills.splice(i, 1);
      }
      if (d.night.witchPoison) kills.push(d.night.witchPoison);

      for (const id of kills) {
        const p = s.players.find((x) => x.id === id);
        if (p && p.alive) {
          p.alive = false;
          d.deaths.push(id);
          d.graveyard.push(id);
          events.push({ kind: 'death', text: `${p.seat + 1} 号 ${p.name} 倒牌了`, visibleTo: null, targetIds: [id] });
        }
      }
      if (!kills.length) events.push({ kind: 'peace', text: '昨晚是平安夜，没有人出局', visibleTo: null });
      // 女巫救人不能自救的补充提示走私有系统消息
      if (d.night.witchSave && d.night.wolfKill) {
        const victim = s.players.find((x) => x.id === d.night.wolfKill);
        const witch = byRole(s, 'witch')[0];
        if (victim && witch) {
          events.push({
            kind: 'save',
            text: `你用解药救下了 ${victim.seat + 1} 号 ${victim.name}`,
            visibleTo: [witch.seat],
          });
        }
      }
      d.night = {};
    }

    if (phase.mode === 'vote') {
      const tally: Record<string, number> = {};
      for (const t of Object.values(d.votes)) tally[t] = (tally[t] ?? 0) + 1;
      const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]);
      const top = ranked[0];
      if (top && ranked.filter(([, v]) => v === top[1]).length === 1) {
        const out = s.players.find((x) => x.id === top[0]);
        if (out) {
          out.alive = false;
          d.deaths.push(out.id);
          d.graveyard.push(out.id);
          const detail = Object.entries(d.votes)
            .map(([a, t]) => {
              const pa = s.players.find((x) => x.id === a);
              const pt = s.players.find((x) => x.id === t);
              return `${pa?.seat! + 1}号→${pt?.seat! + 1}号`;
            }).join(' ');
          events.push({
            kind: 'vote_out',
            text: `${out.seat + 1} 号 ${out.name} 被投票出局（${top[1]} 票）｜票型：${detail}`,
            visibleTo: null,
            targetIds: [out.id],
          });
          if (/猎人|hunter/.test(out.roleKey)) {
            events.push({ kind: 'hunter', text: `${out.name} 亮出猎人身份，可以开枪带走一人`, visibleTo: null });
            out.private['猎人开枪'] = '你出局了，可以从今晚投你的人里带走一个';
          }
        }
      } else if (ranked.length) {
        events.push({ kind: 'vote_tie', text: '平票，本轮无人出局', visibleTo: null });
      }
      d.votes = {};
    }

    s.data = d as unknown as Record<string, unknown>;
    for (const e of events) {
      s.log.push({ round: s.round, phase: s.phase, text: e.text, visibleTo: e.visibleTo, kind: e.kind });
    }
    s.pending = [];
    return { state: s, events };
  }

  /* ---------------- 8. nextSpeaker ---------------- */
  nextSpeaker(state: GameState, config: GameConfig, alreadySpoke: string[]): PlayerState | null {
    const phase = config.phases[state.phaseIndex]!;
    const pool = alivePlayers(state).sort((a, b) => a.seat - b.seat);
    if (phase.mode === 'sequential') {
      const remain = pool.filter((p) => !alreadySpoke.includes(p.id));
      if (!remain.length) return null;
      const limit = phase.speaksPerActor ?? 1;
      const spoken = alreadySpoke.length;
      if (spoken >= pool.length * limit) return null;
      return remain[0]!;
    }
    if (phase.mode === 'parallel' || phase.mode === 'vote') {
      return pool.find((p) => !alreadySpoke.includes(p.id)) ?? null;
    }
    return null;
  }

  /* ---------------- 9. narration ---------------- */
  narration(state: GameState, config: GameConfig): string | null {
    const phase = config.phases[state.phaseIndex]!;
    if (phase.narration) return phase.narration.replace('{round}', String(state.round));
    if (phase.key === 'night') return `第 ${state.round} 夜，天黑请闭眼`;
    if (phase.key === 'day') return `第 ${state.round} 天天亮了，请大家睁眼`;
    if (phase.mode === 'vote') return '投票开始，请所有人投出你怀疑的人';
    return null;
  }

  /* ---------------- 10. earlyWin / checkWin ---------------- */
  earlyWin(state: GameState, config: GameConfig): WinResult | null {
    if (config.data?.wordPairs) {
      const alive = alivePlayers(state);
      const uc = alive.filter((p) => p.camp === 'undercover');
      if (!uc.length) return { winner: 'civilian', label: '平民胜利', reason: '卧底全部被投出' };
      if (uc.length && alive.length <= 3) return { winner: 'undercover', label: '卧底胜利', reason: '卧底存活到最后三人' };
      return null;
    }
    return null;
  }

  checkWin(state: GameState, config: GameConfig): WinResult | null {
    // 谁是卧底这类「词对」局只走自己的判定，绝不掉进狼人杀的分支
    if (config.data?.wordPairs) return this.earlyWin(state, config);
    const early = this.earlyWin(state, config);
    if (early) return early;
    const alive = alivePlayers(state);
    const wolves = alive.filter((p) => p.camp === 'wolf');
    const good = alive.filter((p) => p.camp !== 'wolf');
    if (!wolves.length) return { winner: 'good', label: '好人阵营胜利', reason: '狼人全部出局' };
    if (wolves.length >= good.length) return { winner: 'wolf', label: '狼人阵营胜利', reason: '狼人数量达到或超过好人' };
    return null;
  }

  private forceEnd(state: GameState, config: GameConfig): WinResult {
    if (config.data?.wordPairs) {
      const uc = alivePlayers(state).filter((p) => p.camp === 'undercover');
      return uc.length
        ? { winner: 'undercover', label: '卧底胜利（轮次用尽）', reason: '回合结束卧底仍存活' }
        : { winner: 'civilian', label: '平民胜利（轮次用尽）', reason: '回合结束时卧底已出局' };
    }
    const alive = alivePlayers(state);
    const wolves = alive.filter((p) => p.camp === 'wolf').length;
    const good = alive.length - wolves;
    return wolves >= good
      ? { winner: 'wolf', label: '狼人阵营胜利（轮次用尽）', reason: '回合结束狼人仍占优' }
      : { winner: 'good', label: '好人阵营胜利（轮次用尽）', reason: '回合结束狼人已被压制' };
  }

  /* ---------------- 11. summarize ---------------- */
  summarize(state: GameState, config: GameConfig): SummaryCard {
    const d = state.data as unknown as HiddenRoleData;
    const isUndercover = Boolean(d.words);
    const wolves = state.players.filter((p) => p.camp === 'wolf');
    const good = state.players.filter((p) => p.camp === 'good' || p.camp === 'civilian');

    const highlights: string[] = [];
    if (d.words) {
      highlights.push(`平民词「${d.words.civilian}」 / 卧底词「${d.words.undercover}」`);
    } else {
      highlights.push(`狼人是：${wolves.map((p) => `${p.seat + 1}号${p.name}`).join('、')}`);
    }
    const voteEvents = state.log.filter((l) => l.kind === 'vote_out');
    if (voteEvents.length) highlights.push(voteEvents[voteEvents.length - 1]!.text);
    const deathEvents = state.log.filter((l) => l.kind === 'death');
    if (deathEvents.length) highlights.push(`夜晚出局：${deathEvents.map((e) => e.text).join('；')}`);

    // MVP：活得最久 + 装得最像的
    const mvpPlayer = [...state.players].sort((a, b) => {
      const aliveBonus = (p: PlayerState) => (p.alive ? 100 : 0);
      return (aliveBonus(b) + b.score) - (aliveBonus(a) + a.score);
    })[0];

    return buildSummary({
      title: `${config.name} · 第 ${state.round} 轮结束`,
      winner: state.winner?.label ?? '平局',
      highlights,
      stats: [
        { label: '总轮次', value: String(state.round) },
        { label: '存活人数', value: String(alivePlayers(state).length) },
        { label: '出局人数', value: String(state.players.filter((p) => !p.alive).length) },
      ],
      mvp: mvpPlayer ? { name: mvpPlayer.name, reason: mvpPlayer.alive ? '活到最后，全程没被抓住' : '虽败犹荣，撑得最久' } : undefined,
      review: [
        state.winner?.reason ?? '局面僵持到轮次上限',
        isUndercover ? '关键是把描述往模糊的方向带，让别人互相怀疑' : '好人输在票型分散，狼人赢在跟票一致',
        '如果重来：前两轮别急着站边，先看谁在保谁',
      ],
      roomId: state.roomId,
    });
  }
}
