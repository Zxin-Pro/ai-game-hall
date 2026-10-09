import { env } from '../env.js';
import { logger } from '../logger.js';
import { setUsageSink } from '../llm/client.js';
import { roomStore } from '../services/roomStore.js';

/* ------------------------------------------------------------------ */
/* 用量汇总：LLM 每次调用都会回调到这里                                  */
/* ------------------------------------------------------------------ */

export function installUsageSink() {
  let pending = 0;
  let timer: NodeJS.Timeout | null = null;

  setUsageSink({
    onUsage(info) {
      if (!info.ok || !info.tokens) return;
      pending += info.tokens;
      // 攒 50 次或 20 秒再落库，避免打爆数据库
      if (pending > 0 && !timer) {
        timer = setTimeout(async () => {
          const n = pending;
          pending = 0;
          timer = null;
          try {
            await roomStore.addTokens('', null, n);
            const { over, used } = await roomStore.checkBudget();
            if (over) logger.warn({ used, budgetK: env.DAILY_TOKEN_BUDGET_K }, '今日预算已超');
          } catch (e) {
            logger.warn({ err: String(e).slice(0, 160) }, '用量落库失败');
          }
        }, 20000);
      }
      logger.debug({ model: info.model, tokens: info.tokens, purpose: info.purpose }, '用量记账');
    },
  });
}
