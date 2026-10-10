import { eq, and, desc, sql as raw } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  messages, rooms, roomPlayers, summaries, memories, dailyUsage, globalUsage, users,
} from '../db/schema.js';
import type { GameState, PlayerState } from '../engine/types.js';
import type { Message } from '../engine/engine.js';
import { env } from '../env.js';
import { logger } from '../logger.js';

/* ------------------------------------------------------------------ */
/* RoomStore —— Runtime 与实际数据库之间的唯一通道                       */
/* ------------------------------------------------------------------ */

export class RoomStore {
  /** 消息自增 seq，落库并返回 */
  async appendMessage(roomId: string, msg: {
    senderType: string; senderId: string | null; content: string;
    round: number; phase: string; visibleTo: number[] | null; metaJson?: Record<string, unknown>;
  }): Promise<number> {
    const res = await db.execute(raw`
      UPDATE rooms SET seq = seq + 1, updated_at = now()
      WHERE id = ${roomId} RETURNING seq
    `);
    const seq = Number((res as unknown as { seq: number }[])[0]?.seq ?? 1);
    await db.insert(messages).values({
      roomId,
      seq,
      senderType: msg.senderType,
      senderId: msg.senderId,
      content: msg.content,
      round: msg.round,
      phase: msg.phase,
      visibleToJson: msg.visibleTo,
      metaJson: msg.metaJson ?? {},
    });
    return seq;
  }

  async updateMessage(roomId: string, seq: number, patch: { content?: string; metaJson?: Record<string, unknown> }) {
    await db.update(messages)
      .set({
        ...(patch.content !== undefined ? { content: patch.content } : {}),
        ...(patch.metaJson ? { metaJson: patch.metaJson } : {}),
      })
      .where(and(eq(messages.roomId, roomId), eq(messages.seq, seq)));
  }

  async loadMessages(roomId: string, afterSeq = 0): Promise<Message[]> {
    const rows = await db.select().from(messages)
      .where(eq(messages.roomId, roomId))
      .orderBy(messages.seq);
    return rows.filter((r) => r.seq > afterSeq).map((r) => ({
      id: r.id,
      seq: r.seq,
      senderType: r.senderType as Message['senderType'],
      senderId: r.senderId,
      senderName:
        r.senderType === 'system' || r.senderType === 'judge' ? '系统'
          : r.senderType === 'user' ? '房主' : '',
      content: r.content,
      round: r.round,
      phase: r.phase,
      visibleTo: (r.visibleToJson as number[] | null) ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async bumpSeq(roomId: string) {
    await db.execute(raw`UPDATE rooms SET seq = seq + 1 WHERE id = ${roomId}`);
  }

  async saveRoomProgress(roomId: string, state: GameState) {
    await db.update(rooms).set({
      round: state.round,
      phase: state.phase,
      status: state.status,
      updatedAt: new Date(),
      ...(state.finished ? { finishedAt: new Date() } : {}),
    }).where(eq(rooms.id, roomId));
  }

  async saveSnapshot(roomId: string, state: GameState) {
    await db.execute(raw`
      INSERT INTO game_states (room_id, round, phase, state_json)
      VALUES (${roomId}, ${state.round}, ${state.phase}, ${JSON.stringify(state)}::jsonb)
      ON CONFLICT (room_id, round, phase) DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = now()
    `);
  }

  async saveSummary(roomId: string, card: Record<string, unknown>, shareImageUrl?: string) {
    await db.insert(summaries).values({ roomId, resultJson: card, shareImageUrl })
      .onConflictDoUpdate({ target: summaries.roomId, set: { resultJson: card } });
    await db.update(rooms).set({ status: 'finished', finishedAt: new Date() }).where(eq(rooms.id, roomId));
  }

  async addTokens(roomId: string, userId: string | null, tokens: number) {
    if (!tokens) return;
    // ★ AI 座位没有 user_id，可能是 null 也可能是空串 —— 空串会被 Postgres
    //   当成非法 uuid 直接抛错，进而把整次 AI 行动判成失败（表现为重复消息）
    const uid = userId && userId.trim() ? userId.trim() : null;
    await db.update(rooms)
      .set({ tokensUsed: raw`${rooms.tokensUsed} + ${tokens}` })
      .where(eq(rooms.id, roomId));
    if (uid) {
      await db.execute(raw`
        INSERT INTO daily_usage (user_id, date, games_played, tokens_used)
        VALUES (${uid}, CURRENT_DATE, 0, ${tokens})
        ON CONFLICT (user_id, date) DO UPDATE SET tokens_used = daily_usage.tokens_used + ${tokens}
      `);
    }
    await db.execute(raw`
      INSERT INTO global_usage (date, tokens_used, calls)
      VALUES (CURRENT_DATE, ${tokens}, 1)
      ON CONFLICT (date) DO UPDATE SET tokens_used = global_usage.tokens_used + ${tokens}, calls = global_usage.calls + 1
    `);
  }

  async markGamePlayed(userId: string) {
    await db.execute(raw`
      INSERT INTO daily_usage (user_id, date, games_played, tokens_used)
      VALUES (${userId}, CURRENT_DATE, 1, 0)
      ON CONFLICT (user_id, date) DO UPDATE SET games_played = daily_usage.games_played + 1
    `);
  }

  async memoriesFor(userId: string, gameId: string): Promise<string[]> {
    if (!userId) return [];
    const rows = await db.select().from(memories).where(eq(memories.userId, userId)).limit(12);
    void gameId;
    return rows.map((r) => `${r.key}：${r.value}`);
  }

  async upsertMemory(userId: string, key: string, value: string, gameId: string) {
    await db.execute(raw`
      INSERT INTO memories (user_id, key, value)
      VALUES (${userId}, ${key}, ${value})
      ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value
    `);
    void gameId;
  }

  async loadPlayers(roomId: string): Promise<PlayerState[]> {
    const rows = await db.select().from(roomPlayers).where(eq(roomPlayers.roomId, roomId)).orderBy(roomPlayers.seat);
    return rows.map((r) => ({
      id: r.id,
      seat: r.seat,
      name: r.name,
      avatar: r.avatar ?? undefined,
      isAi: r.isAi,
      userId: r.userId,
      roleKey: r.aiRoleId ?? 'ai',
      camp: r.aiRoleId ?? 'ai',
      alive: r.alive,
      model: r.model ?? undefined,
      private: (r.privateJson as Record<string, unknown>) ?? {},
      score: r.score,
    }));
  }

  /** 每日预算告警检查：只告警，不自动停服 */
  async checkBudget(): Promise<{ over: boolean; used: number }> {
    const rows = await db.select().from(globalUsage)
      .where(eq(globalUsage.date, new Date().toISOString().slice(0, 10)));
    const used = rows[0]?.tokensUsed ?? 0;
    const limit = env.DAILY_TOKEN_BUDGET_K * 1000;
    if (used > limit && !rows[0]?.alerted) {
      logger.warn({ used, limit }, '【成本告警】今日 token 用量已超预算');
      if (env.BUDGET_ALERT_WEBHOOK) {
        fetch(env.BUDGET_ALERT_WEBHOOK, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: `AI 游戏厅今日 token 用量 ${used}，已超过预算 ${limit}` }),
        }).catch(() => void 0);
      }
      await db.update(globalUsage).set({ alerted: true })
        .where(eq(globalUsage.date, new Date().toISOString().slice(0, 10)));
      return { over: true, used };
    }
    return { over: used > limit, used };
  }

  async recentRooms(userId: string, limit = 20) {
    return db.select().from(rooms).where(eq(rooms.hostId, userId)).orderBy(desc(rooms.createdAt)).limit(limit);
  }

  async publicProfile(userId: string) {
    const rows = await db.select({
      id: users.id, nickname: users.nickname, avatar: users.avatar, createdAt: users.createdAt,
    }).from(users).where(eq(users.id, userId));
    return rows[0] ?? null;
  }
}

export const roomStore = new RoomStore();
