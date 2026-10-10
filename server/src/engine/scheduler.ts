/**
 * =====================================================================
 *  RoomRuntime —— 一局游戏的状态机 + 回合调度器
 * ---------------------------------------------------------------------
 *  · 引擎只负责「规则」，Runtime 负责「跑起来」：调用 LLM、存库、广播
 *  · 单房间串行：一个 await 循环，天生不会并发写状态
 *  · 用户插话挂在队列上，随时能被下一轮 context 读到
 *  · 断线重连靠 rooms.seq 自增 + messages 表，不靠内存
 * =====================================================================
 */
import type { GameConfig, GameState, PlayerState } from '../engine/types.js';
import type { Action, Message, WinResult, GameEngine } from '../engine/engine.js';
import { getEngine } from '../engine/registry.js';
import { callLLM } from '../llm/client.js';
import { polishSummary, extractMemories } from '../llm/prompts.js';
import { logger } from '../logger.js';
import type { RoomStore } from '../services/roomStore.js';

export interface RuntimeHooks {
  /** 落一条消息（含流式增量） */
  onMessage(msg: Omit<Message, 'id' | 'seq' | 'createdAt'> & { streaming?: boolean; done?: boolean }): Promise<number>;
  /** 把已落库的 seq 对应的内容覆盖更新（流式收尾） */
  onMessageUpdate(seq: number, patch: { content?: string; metaJson?: Record<string, unknown> }): Promise<void>;
  /** 广播给房间内所有人 */
  broadcast(event: Record<string, unknown>): void;
  onStatePersist(state: GameState): Promise<void>;
  onFinished(summary: Record<string, unknown>): Promise<void>;
}

export interface RuntimeSnapshot {
  roomId: string;
  gameId: string;
  status: string;
  round: number;
  phase: string;
  phaseName: string;
  turnSeat: number | null;
  players: PlayerState[];
  waitingForUser: boolean;
  paused: boolean;
}

export class RoomRuntime {
  state: GameState;
  private engine: GameEngine;
  private seq = 0;
  private paused = false;
  private stopped = false;
  private running = false;
  private waitUser: (() => void) | null = null;
  private loopPromise: Promise<void> | null = null;

  constructor(
    public readonly roomId: string,
    public config: GameConfig,
    players: PlayerState[],
    private hooks: RuntimeHooks,
    private store: RoomStore,
  ) {
    this.engine = getEngine(config.engineType);
    this.state = this.engine.initState(config, players, roomId);
  }

  /* ------------------------ 对外控制 ------------------------ */

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.loop().catch(async (e) => {
      logger.error({ roomId: this.roomId, err: String(e).slice(0, 400) }, '房间循环异常退出');
      await this.pushSystem(`本局因意外中断：${String(e).slice(0, 60)}`);
      this.stop();
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.waitUser) { this.waitUser(); this.waitUser = null; }
  }

  pause(): void { this.paused = true; this.hooks.broadcast({ type: 'room.paused', roomId: this.roomId }); }
  resume(): void { this.paused = false; this.hooks.broadcast({ type: 'room.resumed', roomId: this.roomId }); }
  get isPaused() { return this.paused; }

  snapshot(): RuntimeSnapshot {
    const phase = this.config.phases[this.state.phaseIndex]!;
    return {
      roomId: this.roomId,
      gameId: this.config.id,
      status: this.state.status,
      round: this.state.round,
      phase: this.state.phase,
      phaseName: phase.name,
      turnSeat: this.state.players.find((p) => this.state.pending.some((a) => a.actorId === p.id))?.seat ?? null,
      players: this.state.players,
      waitingForUser: Boolean(this.waitUser),
      paused: this.paused,
    };
  }

  /* ------------------------ 用户输入 ------------------------ */

  /** 用户随时插话：直接进公共流，下一轮 context 就能读到 */
  async userSpeak(userId: string, text: string): Promise<void> {
    const me = this.state.players.find((p) => p.userId === userId);
    const name = me?.name ?? '房主';
    const seq = await this.push({
      senderType: 'user', senderId: me?.id ?? null, senderName: name,
      content: text, round: this.state.round, phase: this.state.phase, visibleTo: null,
      metaJson: { kind: 'user' },
    });
    // 恋爱模拟等引擎有额外结算
    const eng = this.engine as unknown as { applyUserMessage?: (s: GameState, t: string, c: GameConfig) => GameState };
    if (typeof eng.applyUserMessage === 'function') {
      this.state = eng.applyUserMessage(this.state, text, this.config);
    }
    this.hooks.broadcast({ type: 'message.created', roomId: this.roomId, seq });
    void this.store.bumpSeq(this.roomId);
  }

  /** 用户提交一个正式动作（投票 / 出价 / 举证） */
  async userAction(userId: string, action: Partial<Action>): Promise<void> {
    const me = this.state.players.find((p) => p.userId === userId);
    if (!me) return;
    const full: Action = {
      kind: (action.kind ?? 'speak') as Action['kind'],
      actorId: me.id,
      targetId: action.targetId,
      text: action.text,
      amount: action.amount,
      option: action.option,
    };
    this.state = this.engine.applyAction(this.state, full, this.config);
    await this.flushPendingIfReady();
    if (full.text) await this.userSpeak(userId, full.text);
    this.hooks.broadcast({ type: 'action.accepted', roomId: this.roomId, kind: full.kind });
    // 如果是等用户的阶段，放行
    if (this.waitUser) { const r = this.waitUser; this.waitUser = null; r(); }
  }

  async userPause(userId: string) { this.pause(); }
  async userResume(userId: string) { this.resume(); }

  /* ------------------------ 主循环 ------------------------ */

  private async loop(): Promise<void> {
    await this.pushSystem(this.openingLine());
    while (!this.stopped && !this.state.finished) {
      await this.waitWhilePaused();
      if (this.stopped) break;

      const phase = this.config.phases[this.state.phaseIndex]!;

      // 阶段旁白
      const narr = this.engine.narration?.(this.state, this.config) ?? null;
      if (narr) await this.pushSystem(narr);

      if (phase.mode === 'narration') {
        await this.advance();
        continue;
      }

      if (phase.mode === 'user_turn') {
        await this.pushSystem('轮到你了，说点什么吧');
        await this.waitForUser();
        await this.advance();
        continue;
      }

      // 收集动作
      const spoken: string[] = [];
      const parallel: Action[] = [];
      let guard = 0;

      while (guard++ < 40) {
        await this.waitWhilePaused();
        if (this.stopped) break;

        const speaker = this.engine.nextSpeaker?.(this.state, this.config, spoken) ?? null;
        if (!speaker) break;

        spoken.push(speaker.id);
        const action = await this.runAI(speaker);
        if (!action) continue;

        if (phase.mode === 'parallel' || phase.mode === 'vote') {
          parallel.push(action);
          this.state = this.engine.applyAction(this.state, action, this.config);
          await this.maybeEmitIntermediate(action, speaker);
        } else {
          this.state = this.engine.applyAction(this.state, action, this.config);
          // ★ 不要再 push 一条：runAI 里已经先落了流式占位，
          //   收尾时用 onMessageUpdate 把正文覆盖进去，这里重复 push 会让每句话存两条
        }
        // 每说完一句检查一次胜负，能提前结束就提前结束
        const win = this.engine.checkWin(this.state, this.config);
        if (win) { await this.finish(win); return; }
      }

      // 统一结算
      if (parallel.length) await this.resolvePhase();

      const win2 = this.engine.checkWin(this.state, this.config);
      if (win2) { await this.finish(win2); return; }

      if (this.state.finished) break;
      await this.advance();
    }

    if (this.state.finished && !this.state.winner) {
      const w = this.engine.checkWin(this.state, this.config);
      if (w) await this.finish(w);
    }
  }

  private async advance(): Promise<void> {
    this.state = this.engine.nextPhase(this.state, this.config);
    await this.hooks.onStatePersist(this.state);
    await this.store.saveRoomProgress(this.roomId, this.state);
    this.hooks.broadcast({
      type: 'room.phase',
      roomId: this.roomId,
      round: this.state.round,
      phase: this.state.phase,
      phaseName: this.config.phases[this.state.phaseIndex]!.name,
      status: this.state.status,
    });
  }

  private async resolvePhase(): Promise<void> {
    if (!this.engine.resolvePending) return;
    const { state, events } = this.engine.resolvePending(this.state, this.config);
    this.state = state;
    for (const e of events) {
      await this.pushSystem(e.text, e.visibleTo ?? null);
    }
  }

  private async flushPendingIfReady(): Promise<void> {
    const phase = this.config.phases[this.state.phaseIndex]!;
    if (phase.mode !== 'vote' && phase.mode !== 'parallel') return;
    const expectCount = this.state.players.filter((p) => p.isAi).length;
    if (this.state.pending.length >= expectCount) await this.resolvePhase();
  }

  private async maybeEmitIntermediate(action: Action, speaker: PlayerState): Promise<void> {
    const phase = this.config.phases[this.state.phaseIndex]!;
    if (phase.key === 'night' || phase.secret) {
      // 夜晚/秘密行动：只把「谁做了动作」以小字提示，不暴露内容
      await this.push({
        senderType: 'system', senderId: 'system', senderName: '系统',
        content: `${speaker.name} 已行动`, round: this.state.round, phase: this.state.phase,
        visibleTo: null, metaJson: { kind: 'silent_action' },
      });
    }
    // ★ 不再重复 push AI 发言：
    //   runAI 里已经先落了一条流式占位消息，收尾时用 onMessageUpdate 覆盖成正文。
    //   这里再 push 一次就会让同一句话在库里存两条。
  }

  /* ------------------------ AI 单次行动 ------------------------ */

  private async runAI(player: PlayerState): Promise<Action | null> {
    const visible = this.engine.getVisibleMessages(this.state, player.id, this.messages);
    const memories = await this.store.memoriesFor(player.userId ?? '', this.config.id);
    const prompt = this.engine.buildPrompt(this.state, player, this.config, visible, memories);

    // 流式占位
    const placeholderSeq = await this.push({
      senderType: 'ai', senderId: player.id, senderName: player.name,
      content: '', round: this.state.round, phase: this.state.phase,
      visibleTo: null, metaJson: { kind: 'streaming', model: prompt.model },
    });
    this.hooks.broadcast({
      type: 'message.stream.start', roomId: this.roomId, seq: placeholderSeq,
      senderId: player.id, name: player.name,
    });

    let acc = '';
    let lastFlush = 0;
    try {
      const res = await callLLM({
        model: prompt.model,
        messages: prompt.messages.length ? [{ role: 'system', content: prompt.system }, ...prompt.messages] : [{ role: 'system', content: prompt.system }],
        maxTokens: prompt.maxTokens,
        temperature: prompt.temperature,
        stream: true,
        purpose: 'speak' as const,
        onDelta: (chunk) => {
          acc += chunk;
          const now = Date.now();
          if (now - lastFlush > 120) {
            lastFlush = now;
            this.hooks.broadcast({ type: 'message.stream.delta', roomId: this.roomId, seq: placeholderSeq, delta: chunk });
          }
        },
      });

      const action = this.engine.parseAction(res.text || acc, player, this.config);
      const shown = action.text?.trim() ? action.text.trim() : res.text.trim();

      // 秘密动作不进公共流，改写成系统提示
      const secret = this.config.phases[this.state.phaseIndex]!.secret
        || this.config.phases[this.state.phaseIndex]!.key === 'night';

      await this.hooks.onMessageUpdate(placeholderSeq, {
        content: secret ? '' : shown,
        metaJson: {
          kind: action.kind,
          model: res.model,
          ttftMs: res.ttftMs,
          genMs: res.genMs,
          tokens: res.completionTokens,
          totalTokens: res.totalTokens,
          rate: Number(res.rate.toFixed(1)),
          estimated: res.estimated,
          action: action.raw ?? { kind: action.kind, target: action.targetId ?? null },
        },
      });
      this.hooks.broadcast({
        type: 'message.stream.end', roomId: this.roomId, seq: placeholderSeq,
        content: secret ? '' : shown, kind: action.kind, secret,
        meta: { ttftMs: res.ttftMs, genMs: res.genMs, tokens: res.completionTokens, rate: Number(res.rate.toFixed(1)), model: res.model },
      });

      // ★ 记账失败不能把这次发言判为失败 —— 它只是旁路统计，
      //   一旦抛出去会被外层 catch 当成「AI 走神」，消息就白说了
      try {
        await this.store.addTokens(this.roomId, player.userId ?? null, res.totalTokens);
      } catch (e) {
        logger.warn({ roomId: this.roomId, err: String(e).slice(0, 160) }, '用量落库失败（忽略）');
      }
      return action;
    } catch (e) {
      logger.warn({ roomId: this.roomId, player: player.name, err: String(e).slice(0, 200) }, 'AI 行动失败，跳过');
      await this.hooks.onMessageUpdate(placeholderSeq, {
        content: '（这个角色走神了）',
        metaJson: { kind: 'error' },
      });
      this.hooks.broadcast({ type: 'message.stream.end', roomId: this.roomId, seq: placeholderSeq, content: '（这个角色走神了）', kind: 'error' });
      return null;
    }
  }

  /* ------------------------ 用户等待 ------------------------ */

  private waitForUser(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.waitUser = resolve;
      this.hooks.broadcast({ type: 'room.wait_user', roomId: this.roomId });
    });
  }

  private async waitWhilePaused(): Promise<void> {
    while (this.paused && !this.stopped) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  /* ------------------------ 落库 & 广播 ------------------------ */

  private messages: Message[] = [];

  private async push(msg: {
    senderType: Message['senderType']; senderId: string | null; senderName: string;
    content: string; round: number; phase: string; visibleTo: number[] | null;
    metaJson?: Record<string, unknown>;
  }): Promise<number> {
    const seq = await this.hooks.onMessage({
      senderType: msg.senderType,
      senderId: msg.senderId,
      senderName: msg.senderName,
      content: msg.content,
      round: msg.round,
      phase: msg.phase,
      visibleTo: msg.visibleTo,
      metaJson: msg.metaJson ?? {},
    });
    const full: Message = {
      id: `${this.roomId}:${seq}`,
      seq,
      senderType: msg.senderType,
      senderId: msg.senderId,
      senderName: msg.senderName,
      content: msg.content,
      round: msg.round,
      phase: msg.phase,
      visibleTo: msg.visibleTo,
      metaJson: msg.metaJson ?? {},
      createdAt: new Date().toISOString(),
    };
    this.messages.push(full);
    return seq;
  }

  private async pushSystem(text: string, visibleTo: number[] | null = null): Promise<number> {
    const seq = await this.push({
      senderType: 'system', senderId: 'system', senderName: '系统',
      content: text, round: this.state.round, phase: this.state.phase,
      visibleTo, metaJson: { kind: 'system' },
    });
    this.hooks.broadcast({ type: 'message.created', roomId: this.roomId, seq, system: true, content: text });
    return seq;
  }

  private openingLine(): string {
    const seats = this.state.players.map((p) => `${p.seat + 1}号${p.name}`).join('、');
    return `《${this.config.name}》开局，参与者：${seats}`;
  }

  /* ------------------------ 结束 ------------------------ */

  private async finish(win: WinResult): Promise<void> {
    this.state.winner = win;
    this.state.finished = true;
    this.state.status = 'finished';
    await this.pushSystem(`本局结束：${win.label}（${win.reason}）`);

    const card = this.engine.summarize(this.state, this.config) as unknown as Record<string, unknown>;
    const transcript = this.messages
      .filter((m) => m.visibleTo === null)
      .map((m) => `${m.senderName}：${m.content}`)
      .join('\n');

    const polished = await polishSummary({
      gameName: this.config.name,
      winner: win.label,
      highlights: (card.highlights as string[]) ?? [],
      stats: (card.stats as { label: string; value: string }[]) ?? [],
      transcript,
      model: this.config.costs?.summaryModel,
    });
    if (polished) {
      if (polished.review?.length) card.review = polished.review;
      if (polished.mvpReason && card.mvp) (card.mvp as { reason: string }).reason = polished.mvpReason;
    }
    card.winner = win.label;
    card.shareText = `${this.config.name}｜${win.label}`;

    // 抽取用户长期记忆
    const me = this.state.players.find((p) => p.userId);
    if (me?.userId) {
      const mems = await extractMemories({ gameName: this.config.name, transcript });
      for (const m of mems) await this.store.upsertMemory(me.userId, m.key, m.value, this.config.id);
    }

    await this.hooks.onFinished(card);
    this.hooks.broadcast({ type: 'room.finished', roomId: this.roomId, summary: card });
    this.stop();
  }
}
