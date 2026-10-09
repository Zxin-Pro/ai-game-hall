/**
 * 引擎冒烟测试：不连数据库、不调 LLM，纯跑规则。
 *   node --experimental-strip-types src/engine/__smoke__.ts   (Node 22 可直接跑 ts)
 * 或 npm run build 后用 node dist/engine/__smoke__.js
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConfig } from '../gameconfig/loader.js';
import { getEngine } from './registry.js';
import type { PlayerState } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));
const cfg = parseConfig(readFileSync(join(here, '..', '..', 'configs', 'werewolf.json'), 'utf8'));

const players: PlayerState[] = Array.from({ length: 7 }, (_, i) => ({
  id: `p${i}`,
  seat: i,
  name: ['阿离', '小满', '辰辰', '糖不甩', '阿七', '木头', '白菜'][i]!,
  isAi: true,
  userId: null,
  roleKey: 'villager',
  camp: 'good',
  alive: true,
  private: {},
  score: 0,
}));

const engine = getEngine(cfg.engineType);
let state = engine.initState(cfg, players, 'test-room');

console.log('== 开局 ==');
console.log('座位/身份：', state.players.map((p) => `${p.seat + 1}号${p.name}=${p.roleKey}`).join('  '));
console.log('狼人私有信息：', state.players.filter((p) => p.camp === 'wolf').map((p) => JSON.stringify(p.private)).join(' '));

let guard = 0;
while (!state.finished && guard++ < 30) {
  const phase = cfg.phases[state.phaseIndex]!;
  const narr = engine.narration?.(state, cfg);
  if (narr) console.log(`\n-- [R${state.round}] ${phase.name} :: ${narr}`);

  const spoken: string[] = [];
  let g2 = 0;
  while (g2++ < 20) {
    const speaker = engine.nextSpeaker?.(state, cfg, spoken) ?? null;
    if (!speaker) break;
    spoken.push(speaker.id);

    const prompt = engine.buildPrompt(state, speaker, cfg, [], []);
    if (!prompt.system.includes('你的身份')) throw new Error('prompt 缺少身份信息');

    // 极简假 AI：按角色产出一个合法 action
    const act = fakeAct(speaker, state, cfg, phase.mode);
    const parsed = engine.parseAction(JSON.stringify(act), speaker, cfg);
    state = engine.applyAction(state, parsed, cfg);

    if (parsed.kind === 'speak' && parsed.text) console.log(`   ${speaker.name}：${parsed.text}`);
  }

  if (phase.mode === 'parallel' || phase.mode === 'vote') {
    const r = engine.resolvePending!(state, cfg);
    state = r.state;
    for (const e of r.events) console.log(`   〔系统〕${e.text}`);
  }

  const win = engine.checkWin(state, cfg);
  if (win) {
    state.finished = true;
    state.status = 'finished';
    state.winner = win;
    break;
  }
  state = engine.nextPhase(state, cfg);
}

console.log('\n== 结果 ==', state.winner?.label, '|', state.winner?.reason);
const card = engine.summarize(state, cfg);
console.log('结算卡：', JSON.stringify(card, null, 2).slice(0, 700));

/* ------------------------------ 假 AI ------------------------------ */
function fakeAct(p: PlayerState, s: typeof state, c: typeof cfg, mode: string) {
  const others = s.players.filter((x) => x.alive && x.id !== p.id);
  const pick = others[Math.floor(Math.random() * others.length)]!;
  if (mode === 'vote') return { kind: 'vote', target: pick.name, text: `我投 ${pick.name}` };
  if (mode === 'parallel') {
    if (p.camp === 'wolf') return { kind: 'kill', target: pick.name, text: '今晚就他了' };
    if (p.roleKey === 'seer') return { kind: 'investigate', target: pick.name, text: '查一个' };
    if (p.roleKey === 'witch') return { kind: 'pass', text: '先留着药' };
    return { kind: 'pass', text: '闭眼' };
  }
  return { kind: 'speak', text: `我觉得 ${pick.name} 有点问题，先听着` };
}
