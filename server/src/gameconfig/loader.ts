import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GameConfig } from '../engine/types.js';

/* ------------------------------------------------------------------ */
/* Config 加载器：configs/*.json → GameConfig                           */
/* ------------------------------------------------------------------ */

const here = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(here, '..', '..', 'configs');

export async function loadAllConfigs(): Promise<GameConfig[]> {
  const files = (await readdir(CONFIG_DIR)).filter((f) => f.endsWith('.json'));
  const out: GameConfig[] = [];
  for (const f of files) {
    try {
      const raw = await readFile(join(CONFIG_DIR, f), 'utf8');
      out.push(parseConfig(raw, f));
    } catch (e) {
      // 单份 config 坏掉不能拖垮整站
      // eslint-disable-next-line no-console
      console.error(`[config] ${f} 解析失败:`, String(e).slice(0, 200));
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function parseConfig(raw: string, source = 'inline'): GameConfig {
  const c = JSON.parse(raw) as GameConfig;
  const errs: string[] = [];
  if (!c.id) errs.push('缺少 id');
  if (!c.engineType) errs.push('缺少 engineType');
  if (!Array.isArray(c.phases) || !c.phases.length) errs.push('缺少 phases');
  if (!Array.isArray(c.roles) || !c.roles.length) errs.push('缺少 roles');
  if (!c.uiSchema) errs.push('缺少 uiSchema');
  if (typeof c.maxRounds !== 'number') errs.push('缺少 maxRounds');
  if (errs.length) throw new Error(`${source}: ${errs.join(' / ')}`);

  const validEngine = ['hidden_role', 'group_chat', 'debate', 'negotiation', 'simulation'];
  if (!validEngine.includes(c.engineType)) throw new Error(`${source}: engineType 不支持 ${c.engineType}`);

  return {
    ...c,
    // 默认兜底，避免 config 漏字段导致运行时崩
    userRole: c.userRole ?? 'spectator',
    topicPool: c.topicPool ?? [],
    rules: c.rules ?? [],
    winCondition: c.winCondition ?? {},
    data: c.data ?? {},
    costs: {
      maxOutputTokens: c.costs?.maxOutputTokens ?? 400,
      contextWindow: c.costs?.contextWindow ?? 20,
      summaryModel: c.costs?.summaryModel,
    },
  };
}

export async function findConfig(id: string): Promise<GameConfig | null> {
  const all = await loadAllConfigs();
  return all.find((c) => c.id === id) ?? null;
}
