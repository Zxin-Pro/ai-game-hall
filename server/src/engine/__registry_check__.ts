/* 快速检查 5 种引擎是否都能拿到、接口方法齐不齐 */
import { engines, getEngine } from './registry.js';
import type { EngineType } from './types.js';

const REQUIRED = [
  'initState', 'nextPhase', 'getVisibleMessages', 'buildPrompt',
  'parseAction', 'applyAction', 'checkWin', 'summarize',
];

let bad = 0;
for (const [k, v] of Object.entries(engines)) {
  const missing = REQUIRED.filter((m) => typeof (v as unknown as Record<string, unknown>)[m] !== 'function');
  const ok = missing.length === 0 && v.type === k;
  if (!ok) bad++;
  console.log(`${ok ? '✓' : '✗'} ${k.padEnd(12)} ${v.constructor.name.padEnd(20)} type=${v.type}${missing.length ? ' 缺: ' + missing.join(',') : ''}`);
}

// 错误的 engine_type 必须抛错
try {
  getEngine('nope' as EngineType);
  console.log('✗ 未知 engine_type 没有抛错');
  bad++;
} catch {
  console.log('✓ 未知 engine_type 正确抛错');
}

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`);
process.exit(bad === 0 ? 0 : 1);
