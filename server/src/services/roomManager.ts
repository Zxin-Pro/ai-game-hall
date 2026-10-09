import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { rooms, games } from '../db/schema.js';
import { RoomRuntime } from '../engine/scheduler.js';
import { roomStore } from './roomStore.js';
import { wsHub } from '../ws/hub.js';
import { logger } from '../logger.js';
import type { GameConfig, GameState } from '../engine/types.js';

/* ------------------------------------------------------------------ */
/* RoomManager —— 内存里的房间注册表                                     */
/*  一个进程管所有运行中的房间，重启后从 DB 恢复不了"半局"，但消息不丢    */
/* ------------------------------------------------------------------ */

export class RoomManager {
  private runtimes = new Map<string, RoomRuntime>();

  activeCount() { return this.runtimes.size; }
  get(roomId: string) { return this.runtimes.get(roomId) ?? null; }
  drop(roomId: string) { this.runtimes.delete(roomId); }

  async create(roomId: string): Promise<RoomRuntime> {
    const existing = this.runtimes.get(roomId);
    if (existing) return existing;

    const roomRows = await db.select().from(rooms).where(eq(rooms.id, roomId));
    const room = roomRows[0];
    if (!room) throw new Error('房间不存在');

    const gameRows = await db.select().from(games).where(eq(games.id, room.gameId));
    const config = (room.configJson as unknown as GameConfig)
      ?? (gameRows[0]?.configJson as unknown as GameConfig);
    if (!config) throw new Error('游戏配置缺失');

    const players = await roomStore.loadPlayers(roomId);

    const rt = new RoomRuntime(roomId, config, players, {
      onMessage: async (msg) => {
        return roomStore.appendMessage(roomId, {
          senderType: msg.senderType,
          senderId: msg.senderId,
          content: msg.content,
          round: msg.round,
          phase: msg.phase,
          visibleTo: msg.visibleTo,
          metaJson: {},
        });
      },
      onMessageUpdate: async (seq, patch) => {
        await roomStore.updateMessage(roomId, seq, patch);
      },
      broadcast: (event) => {
        wsHub.broadcast(roomId, event);
      },
      onStatePersist: async (state: GameState) => {
        await roomStore.saveSnapshot(roomId, state);
      },
      onFinished: async (card) => {
        await roomStore.saveSummary(roomId, card);
        logger.info({ roomId, winner: card.winner }, '对局结束');
      },
    }, roomStore);

    this.runtimes.set(roomId, rt);
    return rt;
  }

  /** 进程重启后清扫僵尸房间：还在 running 但没有 runtime 的，标成 archived */
  async sweepZombies() {
    const rows = await db.select({ id: rooms.id, status: rooms.status }).from(rooms);
    let n = 0;
    for (const r of rows) {
      if (r.status === 'running' && !this.runtimes.has(r.id)) {
        await db.update(rooms).set({ status: 'archived' }).where(eq(rooms.id, r.id));
        n++;
      }
    }
    if (n) logger.warn({ count: n }, '清扫了未完成的历史房间');
  }
}

let manager: RoomManager | null = null;
export function getRoomManager(): RoomManager {
  if (!manager) manager = new RoomManager();
  return manager;
}
