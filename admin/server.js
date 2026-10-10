// AI 游戏厅 · 管理后台后端
// 独立进程，只读为主：直接连 postgres 查数据，不碰主服务的引擎
import express from 'express';
import pg from 'pg';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.ADMIN_PORT || 35100);
// 反代前缀。挂在 /agh-admin/ 下面时必须设置，否则 Cookie Path 对不上
const BASE_PATH = process.env.ADMIN_BASE_PATH || '/';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.JWT_SECRET || 'dev-secret';
// 主服务地址，用于触发强制结束房间之类
const GAMEHALL_URL = process.env.GAMEHALL_URL || 'http://127.0.0.1:8787';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser(SESSION_SECRET));

/* ------------------------------ 登录 ------------------------------ */

const sessions = new Map(); // token -> { user, exp }

function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

function currentUser(req) {
  const t = req.cookies?.agh_admin;
  if (!t) return null;
  const s = sessions.get(t);
  if (!s) return null;
  if (Date.now() > s.exp) {
    sessions.delete(t);
    return null;
  }
  return s.user;
}

function requireLogin(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: '未登录' });
  next();
}

app.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: '服务端没配 ADMIN_PASSWORD' });
  }
  const a = Buffer.from(String(username ?? ''));
  const b = Buffer.from(ADMIN_USER);
  const c = Buffer.from(String(password ?? ''));
  const d = Buffer.from(ADMIN_PASSWORD);
  const userOk = a.length === b.length && crypto.timingSafeEqual(a, b);
  const passOk = c.length === d.length && crypto.timingSafeEqual(c, d);
  if (!userOk || !passOk) {
    return res.status(401).json({ error: '账号或密码不对' });
  }
  const t = makeToken();
  sessions.set(t, { user: ADMIN_USER, exp: Date.now() + 12 * 3600 * 1000 });
  res.cookie('agh_admin', t, {
    httpOnly: true,
    sameSite: 'lax',
    // ★ 页面挂在 /agh-admin/ 下面，Path 必须跟着走，
    //   否则浏览器不会把它带回来（表现为「登录成功但一刷新就掉」）
    path: BASE_PATH || '/',
    maxAge: 12 * 3600 * 1000,
  });
  res.json({ ok: true, user: ADMIN_USER });
});

app.post('/logout', (req, res) => {
  const t = req.cookies?.agh_admin;
  if (t) sessions.delete(t);
  res.clearCookie('agh_admin', { path: BASE_PATH || '/' });
  res.json({ ok: true });
});

app.get('/me', (req, res) => {
  const u = currentUser(req);
  res.json({ user: u });
});

/* ------------------------------ 概览 ------------------------------ */

app.get('/api/overview', requireLogin, async (req, res, next) => {
  try {
    const q = async (sql, params) => (await pool.query(sql, params)).rows;

    const [counts] = await q(`
      select
        (select count(*) from users)                              as users,
        (select count(*) from rooms)                              as rooms,
        (select count(*) from rooms where status = 'running')     as running,
        (select count(*) from messages)                           as messages,
        (select count(*) from reports)                            as reports
    `);

    const usage = await q(`
      select coalesce(sum(tokens_used),0)::bigint as tokens,
             count(distinct user_id)::int          as active_users,
             coalesce(sum(games_played),0)::int    as games
      from daily_usage
      where date >= current_date - interval '7 days'
    `);

    const today = await q(`
      select coalesce(sum(tokens_used),0)::bigint as tokens
      from daily_usage where date = current_date
    `);

    const global = await q(`
      select coalesce(sum(tokens_used),0)::bigint as tokens,
             coalesce(sum(calls),0)::int          as entries
      from global_usage
    `).catch(() => [{ tokens: 0, entries: 0 }]);

    // 按模型统计：消息的 meta_json 里记了 model 和 tokens
    const byModel = await q(`
      select coalesce(meta_json->>'model','(未记)') as model,
             count(*)::int                                        as calls,
             coalesce(sum(coalesce((meta_json->>'tokens')::int,0)),0)::bigint as tokens,
             coalesce(round(avg(coalesce((meta_json->>'ms')::int,0)))::int,0) as avg_ms
      from messages
      where sender_type = 'ai' and meta_json ? 'model'
      group by 1 order by tokens desc limit 20
    `).catch(() => []);

    const recentRooms = await q(`
      select r.id, r.game_id, r.status, r.round, r.created_at,
             g.name as game_name,
             (select count(*) from room_players p where p.room_id = r.id) as players,
             (select count(*) from messages m where m.room_id = r.id)     as msgs,
             r.tokens_used
      from rooms r left join games g on g.id = r.game_id
      order by r.created_at desc limit 12
    `);

    const trend = await q(`
      select date as day,
             coalesce(sum(tokens_used),0)::bigint as tokens
      from daily_usage
      where date >= current_date - interval '14 days'
      group by date order by date
    `).catch(() => []);

    res.json({
      counts,
      usage: usage[0] ?? {},
      todayTokens: Number(today[0]?.tokens ?? 0),
      globalTokens: Number(global[0]?.tokens ?? 0),
      globalCalls: Number(global[0]?.entries ?? 0),
      byModel,
      recentRooms,
      trend,
    });
  } catch (e) {
    next(e);
  }
});

/* ------------------------------ 房间 ------------------------------ */

app.get('/api/rooms', requireLogin, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const status = req.query.status ? String(req.query.status) : null;
    const params = [];
    let where = '';
    if (status) {
      params.push(status);
      where = `where r.status = $${params.length}`;
    }
    params.push(limit);

    const rows = (await pool.query(`
      select r.id, r.game_id, r.status, r.round, r.phase, r.topic,
             r.created_at, r.updated_at,
             g.name as game_name, g.engine_type,
             u.nickname as owner,
             (select count(*) from room_players p where p.room_id = r.id) as players,
             (select count(*) from messages m where m.room_id = r.id)     as msgs,
             (select coalesce(sum(coalesce((m.meta_json->>'tokens')::int,0)),0)::int from messages m where m.room_id = r.id) as tokens
      from rooms r
      left join games g on g.id = r.game_id
      left join users u on u.id = r.host_id
      ${where}
      order by r.created_at desc
      limit $${params.length}
    `, params)).rows;
    res.json({ rooms: rows });
  } catch (e) {
    next(e);
  }
});

app.get('/api/rooms/:id', requireLogin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const room = (await pool.query(`
      select r.*, g.name as game_name, g.engine_type, u.nickname as owner
      from rooms r
      left join games g on g.id = r.game_id
      left join users u on u.id = r.host_id
      where r.id = $1
    `, [id])).rows[0];
    if (!room) return res.status(404).json({ error: '房间不存在' });

    const players = (await pool.query(`
      select p.*, u.nickname as user_nickname
      from room_players p left join users u on u.id = p.user_id
      where p.room_id = $1 order by p.seat
    `, [id])).rows;

    const messages = (await pool.query(`
      select m.id, m.seq, m.sender_type, m.sender_id, m.content, m.round, m.phase,
             m.meta_json, m.created_at,
             coalesce(p.name, case when m.sender_type = 'system' then '系统'
                                  when m.sender_type = 'user' then u.nickname end) as sender_name
      from messages m
      left join room_players p on p.id::text = m.sender_id
      left join users u on u.id::text = m.sender_id
      where m.room_id = $1
      order by m.seq limit 500
    `, [id])).rows;

    const state = (await pool.query(
      'select state_json from game_states where room_id = $1', [id],
    )).rows[0];

    res.json({ room, players, messages, state: state?.state_json ?? null });
  } catch (e) {
    next(e);
  }
});

// 强制结束：直接打主服务的接口，用管理员身份走不通就只改库
app.post('/api/rooms/:id/force-end', requireLogin, async (req, res, next) => {
  try {
    const { id } = req.params;
    await pool.query(
      `update rooms set status = 'finished', finished_at = now(), updated_at = now() where id = $1`, [id],
    );
    res.json({ ok: true, note: '已改库；若进程里还在跑，需重启对应房间' });
  } catch (e) {
    next(e);
  }
});

app.delete('/api/rooms/:id', requireLogin, async (req, res, next) => {
  try {
    const { id } = req.params;
    await pool.query('delete from messages where room_id = $1', [id]);
    await pool.query('delete from room_players where room_id = $1', [id]);
    await pool.query('delete from game_states where room_id = $1', [id]);
    await pool.query('delete from summaries where room_id = $1', [id]);
    await pool.query('delete from rooms where id = $1', [id]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* ------------------------------ 用户 ------------------------------ */

app.get('/api/users', requireLogin, async (req, res, next) => {
  try {
    const rows = (await pool.query(`
      select u.id, u.nickname, u.avatar, u.created_at,
             (select count(*) from rooms r where r.owner_id = u.id)::int as rooms,
             (select coalesce(sum(tokens_used),0)::bigint from daily_usage d where d.user_id = u.id) as tokens
      from users u
      order by u.created_at desc limit 200
    `)).rows;
    res.json({ users: rows });
  } catch (e) {
    next(e);
  }
});

app.delete('/api/users/:id', requireLogin, async (req, res, next) => {
  try {
    const { id } = req.params;
    await pool.query('delete from refresh_tokens where user_id = $1', [id]).catch(() => {});
    await pool.query('delete from user_memories where user_id = $1', [id]).catch(() => {});
    await pool.query('delete from users where id = $1', [id]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* ------------------------------ 游戏配置 ------------------------------ */

const CONFIG_DIR = process.env.CONFIG_DIR || '/app/configs';

app.get('/api/games', requireLogin, async (req, res, next) => {
  try {
    const rows = (await pool.query(
      'select id, name, description, engine_type, min_players, max_players, updated_at from games order by name',
    )).rows;
    res.json({ games: rows });
  } catch (e) {
    next(e);
  }
});

app.get('/api/games/:id/config', requireLogin, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!/^[a-z0-9_-]+$/.test(id)) return res.status(400).json({ error: '非法 id' });
    const file = path.join(CONFIG_DIR, `${id}.json`);
    if (!fs.existsSync(file)) return res.status(404).json({ error: '配置文件不存在' });
    res.json({ id, config: JSON.parse(fs.readFileSync(file, 'utf8')) });
  } catch (e) {
    next(e);
  }
});

app.put('/api/games/:id/config', requireLogin, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!/^[a-z0-9_-]+$/.test(id)) return res.status(400).json({ error: '非法 id' });
    const cfg = req.body?.config;
    if (!cfg || typeof cfg !== 'object') return res.status(400).json({ error: '缺少 config' });

    const file = path.join(CONFIG_DIR, `${id}.json`);
    if (fs.existsSync(file)) {
      fs.copyFileSync(file, `${file}.bak_${Date.now()}`);
    }
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');

    // 顺手同步进库，让主服务下次 seed 前就能用
    await pool.query(
      `update games set name = $2, description = $3, config_json = $4::jsonb, updated_at = now()
       where id = $1`,
      [id, cfg.name ?? id, cfg.description ?? '', JSON.stringify(cfg)],
    ).catch(() => {});

    res.json({ ok: true, note: '已写文件并同步数据库；主服务重启后完全生效' });
  } catch (e) {
    next(e);
  }
});

/* ------------------------------ 用量 ------------------------------ */

app.get('/api/usage', requireLogin, async (req, res, next) => {
  try {
    const days = Math.min(Number(req.query.days) || 14, 90);
    const byDay = (await pool.query(`
      select day,
             coalesce(sum(tokens),0)::bigint as tokens,
             count(*)::int as calls,
             count(distinct user_id)::int as users
      from daily_usage
      where day >= current_date - ($1 || ' days')::interval
      group by day order by day desc
    `, [days])).rows;

    const byPurpose = (await pool.query(`
      select purpose, count(*)::int as calls,
             coalesce(sum(tokens),0)::bigint as tokens
      from daily_usage
      where day >= current_date - ($1 || ' days')::interval
      group by purpose order by tokens desc
    `, [days])).rows;

    const topUsers = (await pool.query(`
      select d.user_id, u.nickname,
             coalesce(sum(d.tokens),0)::bigint as tokens,
             count(*)::int as calls
      from daily_usage d left join users u on u.id = d.user_id
      where d.day >= current_date - ($1 || ' days')::interval
      group by d.user_id, u.nickname
      order by tokens desc limit 20
    `, [days])).rows;

    res.json({ byDay, byPurpose, topUsers, days });
  } catch (e) {
    next(e);
  }
});

/* ------------------------------ 举报 ------------------------------ */

app.get('/api/reports', requireLogin, async (req, res, next) => {
  try {
    const rows = (await pool.query(`
      select r.*, m.content as message_content, m.sender_name,
             u.nickname as reporter
      from reports r
      left join messages m on m.id = r.message_id
      left join users u on u.id = r.reporter_id
      order by r.created_at desc limit 200
    `)).rows;
    res.json({ reports: rows });
  } catch (e) {
    next(e);
  }
});

app.delete('/api/reports/:id', requireLogin, async (req, res, next) => {
  try {
    await pool.query('delete from reports where id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* ------------------------------ 系统 ------------------------------ */

app.get('/api/system', requireLogin, async (req, res, next) => {
  try {
    const db = (await pool.query(
      'select pg_size_pretty(pg_database_size(current_database())) as size, version() as ver',
    )).rows[0];

    let backend = null;
    try {
      const r = await fetch(GAMEHALL_URL + '/health', { signal: AbortSignal.timeout(5000) });
      backend = await r.json();
    } catch (e) {
      backend = { ok: false, error: String(e).slice(0, 120) };
    }

    res.json({ db, backend, configDir: CONFIG_DIR });
  } catch (e) {
    next(e);
  }
});

/* -------------------- 模型 API 配置（代理给主服务） -------------------- */
// 主服务才是真正用配置的一方，配置存在它那边，改完立刻热生效。
const ADMIN_KEY = process.env.ADMIN_KEY || process.env.ADMIN_PASSWORD || '';

async function callBackend(path, init = {}) {
  const res = await fetch(GAMEHALL_URL + '/api/admin' + path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-admin-key': ADMIN_KEY,
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: text.slice(0, 300) };
  }
  return { status: res.status, body };
}

/** 读当前生效的 API 配置 */
app.get('/api/apiconf', requireLogin, async (req, res, next) => {
  try {
    const [settings, effective] = await Promise.all([
      callBackend('/settings'),
      callBackend('/effective'),
    ]);
    res.json({
      ok: settings.body?.settings ? true : false,
      settings: settings.body?.settings ?? [],
      hotKeys: settings.body?.hotKeys ?? [],
      effective: effective.body ?? {},
      error: settings.body?.error,
    });
  } catch (e) {
    next(e);
  }
});

/** 改 API 配置 —— 立刻热生效 */
app.put('/api/apiconf', requireLogin, async (req, res, next) => {
  try {
    const r = await callBackend('/settings', {
      method: 'PUT',
      body: JSON.stringify(req.body || {}),
    });
    res.status(r.status).json(r.body);
  } catch (e) {
    next(e);
  }
});

/** 把某一项回退成 .env 默认值 */
app.delete('/api/apiconf/:key', requireLogin, async (req, res, next) => {
  try {
    const r = await callBackend('/settings/' + encodeURIComponent(req.params.key), { method: 'DELETE' });
    res.status(r.status).json(r.body);
  } catch (e) {
    next(e);
  }
});

/** 拿当前配置试打一次模型 */
app.post('/api/apiconf/test', requireLogin, async (req, res, next) => {
  try {
    const r = await callBackend('/test-model', {
      method: 'POST',
      body: JSON.stringify(req.body || {}),
    });
    res.status(r.status).json(r.body);
  } catch (e) {
    next(e);
  }
});

/** 拉上游模型列表 */
app.get('/api/apiconf/upstream', requireLogin, async (req, res, next) => {
  try {
    const r = await callBackend('/upstream-models');
    res.status(r.status).json(r.body);
  } catch (e) {
    next(e);
  }
});

/* ------------------------------ 静态页 ------------------------------ */

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, _next) => {
  console.error('[admin]', err);
  res.status(500).json({ error: String(err?.message ?? err).slice(0, 300) });
});

// 容器里必须绑 0.0.0.0，否则只有容器内能访问，nginx 反代不过来
const HOST = process.env.ADMIN_HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`[admin] 管理后台已启动 http://${HOST}:${PORT}`);
});
