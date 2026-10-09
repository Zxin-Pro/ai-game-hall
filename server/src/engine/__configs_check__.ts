/**
 * 配置全量校验：读 configs/*.json → 用对应引擎把每一局真跑一遍。
 * 不连数据库、不调 LLM。任何一份 config 有问题这里就会红。
 */
import { loadAllConfigs } from '../gameconfig/loader.js';
import { getEngine } from './registry.js';
import type { GameConfig, GameState, PlayerState } from './types.js';

const PALETTE = ['阿离', '小满', '辰辰', '糖不甩', '阿七', '木头', '白菜', '橘子', '冬瓜'];

function makePlayers(n: number): PlayerState[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, seat: i, name: PALETTE[i] ?? `玩家${i + 1}`,
    isAi: true, userId: null, roleKey: '', camp: '', alive: true, private: {}, score: 0,
  }));
}

/** 假 AI：只输出合法 action，不产生真实文本 */
function fakeAction(p: PlayerState, s: GameState, cfg: GameConfig) {
  const phase = cfg.phases[s.phaseIndex]!;
  const others = s.players.filter((x) => x.alive && x.id !== p.id);
  const pick = others[Math.floor(Math.random() * others.length)];
  const allow = (phase.allowActions ?? ['speak']).filter((a) => a !== 'pass');
  const kind = allow[Math.floor(Math.random() * allow.length)] ?? 'speak';

  switch (kind) {
    case 'vote': return { kind, target: pick?.name ?? '', text: `我投 ${pick?.name ?? ''}` };
    case 'kill': return { kind, target: pick?.name ?? '', text: '今晚就他了' };
    case 'investigate': return { kind, target: pick?.name ?? '', text: '查一下' };
    case 'describe': return { kind, text: '就是那个，夏天离不开的东西' };
    case 'ask': return { kind, text: '他是不是一个人住？' };
    case 'answer': return { kind, text: '是' };
    case 'guess': return { kind, text: '我觉得真相和他一个人住有关' };
    case 'present_evidence': return { kind, text: (cfg.data?.cases as { evidence: string[] }[] | undefined)?.[0]?.evidence[0] ?? '监控录像' };
    case 'objection': return { kind, text: '对方引用的证据与本案无关', target: pick?.name };
    case 'question': return { kind, text: '你当时看到的是几点？', target: pick?.name };
    case 'offer': return { kind, amount: 700 + Math.floor(Math.random() * 200), text: '这个价格' };
    case 'counter': return { kind, amount: 800 + Math.floor(Math.random() * 200), text: '再加一点' };
    case 'accept': return { kind, text: '成交' };
    case 'invest': return { kind, amount: 80, text: '砸市场' };
    case 'build': return { kind, amount: 60, text: '打磨产品' };
    case 'hire': return { kind, amount: 50, text: '招人' };
    case 'pitch': return { kind, text: '去见投资人' };
    case 'cut': return { kind, text: '砍掉这块预算' };
    case 'flirt': return { kind, text: '今天这身很好看' };
    default: return { kind: 'speak', text: '我先听着，看看谁有问题' };
  }
}

const configs = await loadAllConfigs();
console.log(`读到 ${configs.length} 份 config\n`);

let failed = 0;
const seenEngines = new Set<string>();

for (const cfg of configs) {
  const t0 = Date.now();
  try {
    const engine = getEngine(cfg.engineType);
    seenEngines.add(cfg.engineType);

    // 座位数取 min/max 中间，保证角色牌堆够用
    const seats = Math.min(cfg.maxPlayers, Math.max(cfg.minPlayers, cfg.roles.reduce((a, r) => a + r.count, 0)));
    let s = engine.initState(cfg, makePlayers(seats), `chk-${cfg.id}`);

    if (s.players.some((p) => !p.roleKey)) throw new Error('有玩家没分到角色');

    let guard = 0;
    const phasesSeen: string[] = [];
    let aiTurns = 0;

    while (!s.finished && guard++ < 40) {
      const phase = cfg.phases[s.phaseIndex]!;
      phasesSeen.push(phase.key);

      const spoke: string[] = [];
      let g2 = 0;
      while (g2++ < 15) {
        const sp = engine.nextSpeaker?.(s, cfg, spoke) ?? null;
        if (!sp) break;
        spoke.push(sp.id);
        aiTurns++;

        const vis = engine.getVisibleMessages(s, sp.id, []);
        const prompt = engine.buildPrompt(s, sp, cfg, vis, ['用户喜欢安静的角色']);
        if (!prompt.system) throw new Error('prompt.system 为空');
        if (prompt.expect.length === 0) throw new Error(`${phase.key} 阶段没给出任何可用的 action`);
        if (!prompt.system.includes(sp.name)) throw new Error('prompt 里没有角色名字');

        const act = fakeAction(sp, s, cfg);
        s = engine.applyAction(s, engine.parseAction(JSON.stringify(act), sp, cfg), cfg);
      }

      if (phase.mode === 'parallel' || phase.mode === 'vote') {
        const r = engine.resolvePending?.(s, cfg);
        if (r) {
          s = r.state;
          for (const e of r.events) {
            if (e.visibleTo !== null && e.visibleTo !== undefined && !Array.isArray(e.visibleTo)) {
              throw new Error('事件 visibleTo 不是数组也不是 null');
            }
          }
        }
      }

      const win = engine.checkWin(s, cfg);
      if (win) { s.finished = true; s.status = 'finished'; s.winner = win; break; }
      s = engine.nextPhase(s, cfg);
    }

    if (!s.finished) {
      s.finished = true;
      s.status = 'finished';
      s.winner = engine.checkWin(s, cfg) ?? { winner: 'draw', label: '轮次用尽', reason: '校验用' };
    }

    const card = engine.summarize(s, cfg);
    if (!card.title || !card.winner || !card.review?.length || !card.shareText) {
      throw new Error('结算卡字段缺失');
    }

    const ms = Date.now() - t0;
    console.log(
      `✓ ${cfg.id.padEnd(14)} ${cfg.engineType.padEnd(12)} ` +
      `${seats}人 ${s.round}轮 ${aiTurns}次AI行动 ${ms}ms → ${card.winner}`,
    );
  } catch (e) {
    failed++;
    console.log(`✗ ${cfg.id.padEnd(14)} ${cfg.engineType.padEnd(12)} 崩了：${String(e).slice(0, 200)}`);
  }
}

/* 五个 engine_type 必须都被覆盖到 */
const need: string[] = ['hidden_role', 'group_chat', 'debate', 'negotiation', 'simulation'];
const missing = need.filter((e) => !seenEngines.has(e));
if (missing.length) {
  failed++;
  console.log(`\n✗ 没有 config 覆盖这几种 engine_type：${missing.join(', ')}`);
}

console.log(failed ? `\n${failed} 项失败` : `\n全部 ${configs.length} 份 config 通过，5 种引擎全覆盖`);
process.exit(failed ? 1 : 0);
