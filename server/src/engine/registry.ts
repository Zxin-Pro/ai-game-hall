import type { EngineType } from './types.js';
import type { GameEngine } from './engine.js';
import { HiddenRoleEngine } from './hiddenRole.js';
import { GroupChatEngine } from './groupChat.js';
import { DebateEngine } from './debate.js';
import { NegotiationEngine } from './negotiation.js';
import { SimulationEngine } from './simulation.js';

/**
 * 引擎注册表：engine_type → GameEngine
 * 7 个游戏共用这 5 个引擎实例，引擎全部是无状态的，可以安全复用。
 */
const engines: Record<EngineType, GameEngine> = {
  hidden_role: new HiddenRoleEngine(),
  group_chat: new GroupChatEngine(),
  debate: new DebateEngine(),
  negotiation: new NegotiationEngine(),
  simulation: new SimulationEngine(),
};

export function getEngine(type: EngineType): GameEngine {
  const e = engines[type];
  if (!e) throw new Error(`未知 engine_type: ${type}`);
  return e;
}

export { engines };
export type { GameEngine, EngineType };
