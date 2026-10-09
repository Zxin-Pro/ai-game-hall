/**
 * 跨引擎冒烟：给另外 4 种 engine_type 各造一份最小 config，
 * 用假 AI 跑完整局，验证「引擎 + 调度钩子 + 结算」这条链路不炸。
 * 不连数据库、不调 LLM。
 */
import { getEngine } from './registry.js';
import type { GameConfig, GameState, PlayerState } from './types.js';

function players(n: number): PlayerState[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, seat: i, name: `玩家${i + 1}`, isAi: true, userId: null,
    roleKey: 'x', camp: 'x', alive: true, private: {}, score: 0,
  }));
}

/* ------------------------------ 4 份最小 config ------------------------------ */

const base = {
  description: 'smoke', maxRounds: 3, minPlayers: 3, maxPlayers: 6,
  topicPool: [], rules: ['测试规则'], winCondition: {},
  uiSchema: { theme: 'dark', accent: '#9b8cff', bubbleStyle: 'chat' as const, showSeats: true, actions: [], systemMessageStyle: 'center' as const },
  costs: { maxOutputTokens: 200, contextWindow: 10 },
};

const configs: GameConfig[] = [
  {
    ...base, id: 'smoke-group', name: '群聊冒烟', engineType: 'group_chat', userRole: 'spectator',
    data: { riddles: [{ title: '深夜的电梯', truth: '他其实是盲人', hints: ['声音'] }] },
    phases: [
      { key: 'riddle', name: '出题', mode: 'narration', narration: '汤面：深夜的电梯' },
      { key: 'ask', name: '提问', mode: 'sequential', actors: 'alive', allowActions: ['ask'] },
      { key: 'reveal', name: '揭晓', mode: 'narration' },
    ],
    roles: [
      { key: 'host', name: '主持人', camp: 'host', count: 1, isAi: true, identity: '只答是/不是/无关', goal: '守住真相', personality: '冷静', knowledge: '真相', taboo: '不能多说', speakingStyle: '短' },
      { key: 'troll', name: '搅局者', camp: 'troll', count: 1, isAi: true, identity: '搅局', goal: '带偏', personality: '跳', knowledge: '一点线索', taboo: '无', speakingStyle: '夸张' },
      { key: 'scribe', name: '记录员', camp: 'scribe', count: 1, isAi: true, identity: '记录', goal: '整理', personality: '细', knowledge: '无', taboo: '无', speakingStyle: '条理' },
    ],
  } as unknown as GameConfig,
  {
    ...base, id: 'smoke-debate', name: '法庭冒烟', engineType: 'debate', userRole: 'spectator',
    data: { cases: [{ title: '快递丢失案', facts: '包裹在驿站不见了', charge: '要求赔偿', evidence: ['监控录像'] }] },
    phases: [
      { key: 'opening', name: '开庭', mode: 'narration' },
      { key: 'plaintiff', name: '原告陈述', mode: 'sequential', actors: 'alive', allowActions: ['speak', 'present_evidence'] },
      { key: 'defendant', name: '被告答辩', mode: 'sequential', actors: 'alive', allowActions: ['speak', 'objection'] },
      { key: 'verdict', name: '判决', mode: 'vote', actors: 'alive', allowActions: ['vote'] },
    ],
    roles: [
      { key: 'judge', name: '法官', camp: 'judge', count: 1, isAi: true, identity: '法官', goal: '公正', personality: '稳', knowledge: '案情', taboo: '无', speakingStyle: '严肃' },
      { key: 'plaintiff', name: '原告律师', camp: 'plaintiff', count: 1, isAi: true, identity: '原告', goal: '胜诉', personality: '锐', knowledge: '主张', taboo: '无', speakingStyle: '有力' },
      { key: 'defendant', name: '被告律师', camp: 'defendant', count: 1, isAi: true, identity: '被告', goal: '免责', personality: '巧', knowledge: '指控', taboo: '无', speakingStyle: '反问' },
      { key: 'jury', name: '陪审员', camp: 'jury', count: 2, isAi: true, identity: '陪审', goal: '判断', personality: '公道', knowledge: '无', taboo: '无', speakingStyle: '朴素' },
    ],
  } as unknown as GameConfig,
  {
    ...base, id: 'smoke-nego', name: '谈判冒烟', engineType: 'negotiation', userRole: 'spectator',
    phases: [
      { key: 'opening', name: '开局', mode: 'narration' },
      { key: 'offer', name: '报价', mode: 'sequential', actors: 'alive', allowActions: ['offer', 'counter'] },
      { key: 'ultimatum', name: '最后通牒', mode: 'sequential', actors: 'alive', allowActions: ['accept', 'walk_away', 'offer'] },
    ],
    roles: [
      { key: 'buyer', name: '买方', camp: 'buyer', count: 1, isAi: true, identity: '买方', goal: '低价拿下', personality: '稳', knowledge: '预算', taboo: '别露底', speakingStyle: '慢' },
      { key: 'seller', name: '卖方', camp: 'seller', count: 1, isAi: true, identity: '卖方', goal: '高价出手', personality: '硬', knowledge: '成本', taboo: '别露底', speakingStyle: '快' },
      { key: 'broker', name: '中介', camp: 'broker', count: 1, isAi: true, identity: '中介', goal: '促成', personality: '圆', knowledge: '两边', taboo: '无', speakingStyle: '热络' },
    ],
  } as unknown as GameConfig,
  {
    ...base, id: 'smoke-sim', name: '创业冒烟', engineType: 'simulation', userRole: 'spectator',
    phases: [
      { key: 'meeting', name: '会议', mode: 'sequential', actors: 'alive', allowActions: ['invest', 'build', 'hire', 'cut', 'pitch'] },
      { key: 'review', name: '复盘', mode: 'narration' },
    ],
    roles: [
      { key: 'ceo', name: 'CEO', camp: 'ceo', count: 1, isAi: true, identity: 'CEO', goal: '做高估值', personality: '敢', knowledge: '全局', taboo: '无', speakingStyle: '果断' },
      { key: 'cto', name: 'CTO', camp: 'cto', count: 1, isAi: true, identity: 'CTO', goal: '产品力', personality: '轴', knowledge: '技术', taboo: '无', speakingStyle: '专业' },
      { key: 'cfo', name: 'CFO', camp: 'cfo', count: 1, isAi: true, identity: 'CFO', goal: '现金流', personality: '抠', knowledge: '账', taboo: '无', speakingStyle: '冷' },
      { key: 'investor', name: '投资人', camp: 'investor', count: 1, isAi: true, identity: '投资人', goal: '回报', personality: '挑', knowledge: '市场', taboo: '无', speakingStyle: '直接' },
    ],
  } as unknown as GameConfig,
];

/* ------------------------------ 假 AI ------------------------------ */

function fakeAction(p: PlayerState, s: GameState, cfg: GameConfig, mode: string) {
  const others = s.players.filter((x) => x.alive && x.id !== p.id);
  const pick = others[Math.floor(Math.random() * others.length)];
  const phase = cfg.phases[s.phaseIndex]!;
  const allow = (phase.allowActions ?? ['speak']).filter((a) => a !== 'pass');
  const kind = allow[Math.floor(Math.random() * allow.length)] ?? 'speak';
  if (kind === 'vote') return { kind, target: pick?.name ?? '', text: `投 ${pick?.name ?? ''}` };
  if (kind === 'offer' || kind === 'counter') return { kind, amount: 600 + Math.floor(Math.random() * 300), text: '这个价' };
  if (kind === 'accept') return { kind, text: '成交' };
  if (mode === 'vote') return { kind: 'vote', target: pick?.name ?? '', text: '就这样' };
  return { kind, text: `${p.name} 的想法是：${kind}`, target: pick?.name };
}

/* ------------------------------ 跑 ------------------------------ */

let failed = 0;

for (const cfg of configs) {
  try {
    const engine = getEngine(cfg.engineType);
    let s = engine.initState(cfg, players(cfg.minPlayers), `smoke-${cfg.id}`);
    let guard = 0;
    const seen: string[] = [];

    while (!s.finished && guard++ < 20) {
      const phase = cfg.phases[s.phaseIndex]!;
      seen.push(phase.key);

      const spoke: string[] = [];
      let g2 = 0;
      while (g2++ < 12) {
        const sp = engine.nextSpeaker?.(s, cfg, spoke) ?? null;
        if (!sp) break;
        spoke.push(sp.id);

        const prompt = engine.buildPrompt(s, sp, cfg, engine.getVisibleMessages(s, sp.id, []), []);
        if (!prompt.system) throw new Error('prompt.system 为空');

        const act = fakeAction(sp, s, cfg, phase.mode);
        s = engine.applyAction(s, engine.parseAction(JSON.stringify(act), sp, cfg), cfg);
      }

      if (phase.mode === 'parallel' || phase.mode === 'vote') {
        const r = engine.resolvePending?.(s, cfg);
        if (r) s = r.state;
      }

      const win = engine.checkWin(s, cfg);
      if (win) { s.finished = true; s.winner = win; break; }
      s = engine.nextPhase(s, cfg);
    }

    if (!s.finished) {
      // 轮次用尽也算正常结束路径
      s.finished = true;
      s.status = 'finished';
      s.winner = engine.checkWin(s, cfg) ?? { winner: 'draw', label: '轮次用尽', reason: 'smoke' };
    }

    const card = engine.summarize(s, cfg);
    const ok = card.title && card.winner && Array.isArray(card.review);
    console.log(`${ok ? '✓' : '✗'} ${cfg.engineType.padEnd(12)} 跑完 ${s.round} 轮 [${seen.join('→')}] 结果：${card.winner}`);
    if (!ok) failed++;
  } catch (e) {
    failed++;
    console.log(`✗ ${cfg.engineType.padEnd(12)} 崩了：${String(e).slice(0, 160)}`);
  }
}

console.log(failed ? `\n${failed} 个引擎失败` : '\n全部引擎跑通');
process.exit(failed ? 1 : 0);
