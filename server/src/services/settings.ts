import { sql } from '../db/index.js';
import { setOverrides, currentOverrides, HOT_KEYS } from '../env.js';
import { logger } from '../logger.js';

/**
 * 运行期配置：存在 app_settings 表里，启动时加载进内存覆盖层。
 * 管理后台改完，主服务这边调 reloadSettings() 就能立刻生效，不用重启。
 */

export interface SettingRow {
  key: string;
  value: string;
  updatedAt: string;
  /** 值是否来自数据库（false = 用的 .env 默认值） */
  fromDb: boolean;
}

export async function loadSettingsIntoMemory(): Promise<void> {
  const rows = await sql<{ key: string; value: string }[]>`
    SELECT key, value FROM app_settings
  `;
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  setOverrides(map);
  logger.info({ count: rows.length, keys: Object.keys(map) }, '[settings] 已从数据库加载运行期配置');
}

/** 重新读一遍（管理后台改完之后调） */
export async function reloadSettings(): Promise<void> {
  await loadSettingsIntoMemory();
}

/** 列出所有可配置项：数据库值优先，没配过就回退 .env 现值 */
export async function listSettings(): Promise<SettingRow[]> {
  const rows = await sql<{ key: string; value: string; updated_at: Date }[]>`
    SELECT key, value, updated_at FROM app_settings
  `;
  const dbMap = new Map(rows.map((r) => [r.key, r]));
  const over = currentOverrides();

  return HOT_KEYS.map((key) => {
    const row = dbMap.get(key);
    if (row) {
      return { key, value: row.value, updatedAt: new Date(row.updated_at).toISOString(), fromDb: true };
    }
    return { key, value: over[key] ?? '', updatedAt: '', fromDb: false };
  });
}

/** 写一批配置（只认白名单里的键） */
export async function saveSettings(patch: Record<string, unknown>): Promise<string[]> {
  const keys = Object.keys(patch).filter((k) => (HOT_KEYS as readonly string[]).includes(k));
  if (!keys.length) return [];

  for (const k of keys) {
    const v = patch[k];
    const val = v === null || v === undefined ? '' : String(v);
    await sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${k}, ${val}, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `;
  }
  await reloadSettings();
  return keys;
}

/** 删除某项覆盖，回退到 .env 的值 */
export async function resetSetting(key: string): Promise<void> {
  if (!(HOT_KEYS as readonly string[]).includes(key)) return;
  await sql`DELETE FROM app_settings WHERE key = ${key}`;
  await reloadSettings();
}
