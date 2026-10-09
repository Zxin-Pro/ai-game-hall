import {
  pgTable, uuid, text, integer, boolean, timestamp, jsonb, date,
  index, uniqueIndex, real, primaryKey,
} from 'drizzle-orm/pg-core';

/* ------------------------------------------------------------------ */
/* users                                                               */
/* ------------------------------------------------------------------ */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  nickname: text('nickname').notNull(),
  avatar: text('avatar'),
  passwordHash: text('password_hash').notNull(),
  pushToken: text('push_token'),
  deviceFingerprint: text('device_fingerprint'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  nickIdx: uniqueIndex('users_nickname_uq').on(t.nickname),
  fpIdx: index('users_fp_idx').on(t.deviceFingerprint),
}));

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revoked: boolean('revoked').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  hashIdx: uniqueIndex('refresh_token_hash_uq').on(t.tokenHash),
  userIdx: index('refresh_user_idx').on(t.userId),
}));

/* ------------------------------------------------------------------ */
/* games —— 7 个游戏，全部由 config JSON 驱动                          */
/* ------------------------------------------------------------------ */
export const games = pgTable('games', {
  id: text('id').primaryKey(),                    // 'werewolf'
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  cover: text('cover'),
  minPlayers: integer('min_players').notNull().default(3),
  maxPlayers: integer('max_players').notNull().default(9),
  engineType: text('engine_type').notNull(),      // hidden_role | group_chat | debate | negotiation | simulation
  rulesJson: jsonb('rules_json').notNull().default({}),
  rolesJson: jsonb('roles_json').notNull().default([]),
  uiSchemaJson: jsonb('ui_schema_json').notNull().default({}),
  configJson: jsonb('config_json').notNull().default({}), // 完整原始 config，引擎读它
  sort: integer('sort').notNull().default(0),
  enabled: boolean('enabled').notNull().default(true),
});

/* ------------------------------------------------------------------ */
/* rooms / room_players                                                */
/* ------------------------------------------------------------------ */
export const rooms = pgTable('rooms', {
  id: uuid('id').primaryKey().defaultRandom(),
  gameId: text('game_id').notNull().references(() => games.id),
  hostId: uuid('host_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('waiting'), // waiting|running|voting|finished|archived
  topic: text('topic').notNull().default(''),
  configJson: jsonb('config_json').notNull().default({}), // 本局快照：选中的 AI 角色 + 模型 + 轮次上限
  round: integer('round').notNull().default(0),
  phase: text('phase').notNull().default('init'),
  turnSeat: integer('turn_seat'),
  seq: integer('seq').notNull().default(0),               // 已落库消息序号，用于断线重连补发
  tokensUsed: integer('tokens_used').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (t) => ({
  statusIdx: index('rooms_status_idx').on(t.status),
  hostIdx: index('rooms_host_idx').on(t.hostId),
}));

export const roomPlayers = pgTable('room_players', {
  id: uuid('id').primaryKey().defaultRandom(),
  roomId: uuid('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  aiRoleId: text('ai_role_id'),                    // 指向 games.roles_json 里的 role key
  isAi: boolean('is_ai').notNull().default(true),
  seat: integer('seat').notNull(),
  alive: boolean('alive').notNull().default(true),
  name: text('name').notNull(),                    // 展示名（AI 角色名 或 用户昵称）
  avatar: text('avatar'),
  model: text('model'),                            // 每个角色可指定不同模型
  privateJson: jsonb('private_json').notNull().default({}), // 私有信息：狼队友、查验结果…
  score: real('score').notNull().default(0),       // 好感度 / 战况分
}, (t) => ({
  roomSeatUq: uniqueIndex('room_players_seat_uq').on(t.roomId, t.seat),
  roomIdx: index('room_players_room_idx').on(t.roomId),
}));

/* ------------------------------------------------------------------ */
/* ai_roles —— config 里的角色定义在启动时种子到这里，方便后台改         */
/* ------------------------------------------------------------------ */
export const aiRoles = pgTable('ai_roles', {
  id: text('id').primaryKey(),                     // `${gameId}:${roleKey}`
  gameId: text('game_id').notNull().references(() => games.id, { onDelete: 'cascade' }),
  roleKey: text('role_key').notNull(),
  name: text('name').notNull(),
  identity: text('identity').notNull().default(''),
  goal: text('goal').notNull().default(''),
  personality: text('personality').notNull().default(''),
  knowledge: text('knowledge').notNull().default(''),
  taboo: text('taboo').notNull().default(''),
  speakingStyle: text('speaking_style').notNull().default(''),
  model: text('model'),
  avatar: text('avatar'),
}, (t) => ({ gameIdx: index('ai_roles_game_idx').on(t.gameId) }));

/* ------------------------------------------------------------------ */
/* messages —— 群聊流，一条不丢                                        */
/* ------------------------------------------------------------------ */
export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  roomId: uuid('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  senderType: text('sender_type').notNull(),       // user|ai|system|judge
  senderId: text('sender_id'),                     // room_players.id / 'system'
  content: text('content').notNull().default(''),
  round: integer('round').notNull().default(0),
  phase: text('phase').notNull().default(''),
  visibleToJson: jsonb('visible_to_json'),         // null = 所有人可见；数组 = 仅这些 seat 可见
  metaJson: jsonb('meta_json').notNull().default({}),  // { action, tokens, ms, ttft, kind }
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  roomSeqUq: uniqueIndex('messages_room_seq_uq').on(t.roomId, t.seq),
  roomCreatedIdx: index('messages_room_created_idx').on(t.roomId, t.createdAt),
}));

/* ------------------------------------------------------------------ */
/* game_states —— 每轮快照，回放和恢复都靠它                            */
/* ------------------------------------------------------------------ */
export const gameStates = pgTable('game_states', {
  id: uuid('id').primaryKey().defaultRandom(),
  roomId: uuid('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  round: integer('round').notNull(),
  phase: text('phase').notNull(),
  stateJson: jsonb('state_json').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  roomRoundUq: uniqueIndex('game_states_room_round_uq').on(t.roomId, t.round, t.phase),
}));

/* ------------------------------------------------------------------ */
/* summaries / memories / daily_usage                                  */
/* ------------------------------------------------------------------ */
export const summaries = pgTable('summaries', {
  id: uuid('id').primaryKey().defaultRandom(),
  roomId: uuid('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  resultJson: jsonb('result_json').notNull(),      // SummaryCard
  shareImageUrl: text('share_image_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ roomIdx: uniqueIndex('summaries_room_uq').on(t.roomId) }));

export const memories = pgTable('memories', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  value: text('value').notNull(),
  embedding: jsonb('embedding'),                   // 先用 jsonb 存，pgvector 上线后改 vector(1536)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ userKeyUq: uniqueIndex('memories_user_key_uq').on(t.userId, t.key) }));

export const dailyUsage = pgTable('daily_usage', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  gamesPlayed: integer('games_played').notNull().default(0),
  tokensUsed: integer('tokens_used').notNull().default(0),
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.date] }) }));

/* ------------------------------------------------------------------ */
/* 举报 + 敏感词命中                                                   */
/* ------------------------------------------------------------------ */
export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  messageId: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  reporterId: uuid('reporter_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  reason: text('reason').notNull().default('other'),
  detail: text('detail'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const globalUsage = pgTable('global_usage', {
  date: date('date').primaryKey(),
  tokensUsed: integer('tokens_used').notNull().default(0),
  calls: integer('calls').notNull().default(0),
  alerted: boolean('alerted').notNull().default(false),
});
