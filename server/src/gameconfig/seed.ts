import { db } from '../db/index.js';
import { games, aiRoles } from '../db/schema.js';
import { loadAllConfigs } from './loader.js';
import { logger } from '../logger.js';

/* ------------------------------------------------------------------ */
/* 种子：把 configs/*.json 灌进 games / ai_roles 表                      */
/*  幂等：按 id upsert，改 JSON 后重启即生效                             */
/* ------------------------------------------------------------------ */

export async function seedGames() {
  const configs = await loadAllConfigs();
  if (!configs.length) {
    logger.warn('[seed] configs 目录为空，跳过');
    return;
  }

  let sort = 0;
  for (const c of configs) {
    await db.insert(games).values({
      id: c.id,
      name: c.name,
      description: c.description,
      cover: c.cover ?? null,
      minPlayers: c.minPlayers,
      maxPlayers: c.maxPlayers,
      engineType: c.engineType,
      rulesJson: { list: c.rules },
      rolesJson: c.roles,
      uiSchemaJson: c.uiSchema,
      configJson: c as unknown as Record<string, unknown>,
      sort: sort++,
      enabled: true,
    }).onConflictDoUpdate({
      target: games.id,
      set: {
        name: c.name,
        description: c.description,
        cover: c.cover ?? null,
        minPlayers: c.minPlayers,
        maxPlayers: c.maxPlayers,
        engineType: c.engineType,
        rulesJson: { list: c.rules },
        rolesJson: c.roles,
        uiSchemaJson: c.uiSchema,
        configJson: c as unknown as Record<string, unknown>,
      },
    });

    for (const r of c.roles) {
      await db.insert(aiRoles).values({
        id: `${c.id}:${r.key}`,
        gameId: c.id,
        roleKey: r.key,
        name: r.name,
        identity: r.identity,
        goal: r.goal,
        personality: r.personality,
        knowledge: r.knowledge,
        taboo: r.taboo,
        speakingStyle: r.speakingStyle,
        model: r.model ?? null,
        avatar: r.avatar ?? null,
      }).onConflictDoUpdate({
        target: aiRoles.id,
        set: {
          name: r.name, identity: r.identity, goal: r.goal, personality: r.personality,
          knowledge: r.knowledge, taboo: r.taboo, speakingStyle: r.speakingStyle,
          model: r.model ?? null, avatar: r.avatar ?? null,
        },
      });
    }
  }
  logger.info({ count: configs.length, ids: configs.map((c) => c.id) }, '[seed] 游戏配置已同步');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedGames().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
