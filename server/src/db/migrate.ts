import { sql } from './index.js';

/**
 * 极简迁移器：直接把 sql/001_init.sql 整段丢给 Postgres。
 * 生产想上 drizzle-kit 也行，但这里保证「Clone 完就能跑」。
 */
const DDL = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname text NOT NULL,
  avatar text,
  password_hash text NOT NULL,
  push_token text,
  device_fingerprint text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_nickname_uq ON users (nickname);
CREATE INDEX IF NOT EXISTS users_fp_idx ON users (device_fingerprint);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS refresh_token_hash_uq ON refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS refresh_user_idx ON refresh_tokens (user_id);

CREATE TABLE IF NOT EXISTS games (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  cover text,
  min_players int NOT NULL DEFAULT 3,
  max_players int NOT NULL DEFAULT 9,
  engine_type text NOT NULL,
  rules_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  roles_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ui_schema_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort int NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id text NOT NULL REFERENCES games(id),
  host_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'waiting',
  topic text NOT NULL DEFAULT '',
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  round int NOT NULL DEFAULT 0,
  phase text NOT NULL DEFAULT 'init',
  turn_seat int,
  seq int NOT NULL DEFAULT 0,
  tokens_used int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS rooms_status_idx ON rooms (status);
CREATE INDEX IF NOT EXISTS rooms_host_idx ON rooms (host_id);

CREATE TABLE IF NOT EXISTS room_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ai_role_id text,
  is_ai boolean NOT NULL DEFAULT true,
  seat int NOT NULL,
  alive boolean NOT NULL DEFAULT true,
  name text NOT NULL,
  avatar text,
  model text,
  private_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  score real NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS room_players_seat_uq ON room_players (room_id, seat);
CREATE INDEX IF NOT EXISTS room_players_room_idx ON room_players (room_id);

CREATE TABLE IF NOT EXISTS ai_roles (
  id text PRIMARY KEY,
  game_id text NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  role_key text NOT NULL,
  name text NOT NULL,
  identity text NOT NULL DEFAULT '',
  goal text NOT NULL DEFAULT '',
  personality text NOT NULL DEFAULT '',
  knowledge text NOT NULL DEFAULT '',
  taboo text NOT NULL DEFAULT '',
  speaking_style text NOT NULL DEFAULT '',
  model text,
  avatar text
);
CREATE INDEX IF NOT EXISTS ai_roles_game_idx ON ai_roles (game_id);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  seq int NOT NULL,
  sender_type text NOT NULL,
  sender_id text,
  content text NOT NULL DEFAULT '',
  round int NOT NULL DEFAULT 0,
  phase text NOT NULL DEFAULT '',
  visible_to_json jsonb,
  meta_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS messages_room_seq_uq ON messages (room_id, seq);
CREATE INDEX IF NOT EXISTS messages_room_created_idx ON messages (room_id, created_at);

CREATE TABLE IF NOT EXISTS game_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  round int NOT NULL,
  phase text NOT NULL,
  state_json jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS game_states_room_round_uq ON game_states (room_id, round, phase);

CREATE TABLE IF NOT EXISTS summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  result_json jsonb NOT NULL,
  share_image_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS summaries_room_uq ON summaries (room_id);

CREATE TABLE IF NOT EXISTS memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key text NOT NULL,
  value text NOT NULL,
  embedding jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS memories_user_key_uq ON memories (user_id, key);

CREATE TABLE IF NOT EXISTS daily_usage (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date date NOT NULL,
  games_played int NOT NULL DEFAULT 0,
  tokens_used int NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason text NOT NULL DEFAULT 'other',
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS global_usage (
  date date PRIMARY KEY,
  tokens_used int NOT NULL DEFAULT 0,
  calls int NOT NULL DEFAULT 0,
  alerted boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS user_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id text,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_memories_user_idx ON user_memories (user_id, game_id);
`;

export async function migrate() {
  await sql.unsafe(DDL);
  // eslint-disable-next-line no-console
  console.log('[migrate] 数据表就绪');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().then(() => process.exit(0)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
