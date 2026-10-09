import raw from './demoGames.json';
import type { GameCard, GameDetail } from '../types';

/* ------------------------------------------------------------------ */
/* 离线演示数据：直接来自 server/configs/*.json                          */
/* 后端连不上时 App 用这份数据，保证装上去就能看                          */
/* ------------------------------------------------------------------ */

export interface DemoGame extends GameDetail {
  maxRounds: number;
  userRole: 'player' | 'spectator' | 'host';
  phases: { key: string; name: string; mode: string; actors?: string; narration?: string; allowActions?: string[] }[];
}

const ORDER = ['werewolf', 'undercover', 'dating', 'turtle-soup', 'court', 'negotiation', 'startup'];

export const DEMO_GAMES = (raw as DemoGame[]).sort(
  (a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id),
);

export const demoCards = (): GameCard[] =>
  DEMO_GAMES.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    cover: g.cover,
    minPlayers: g.minPlayers,
    maxPlayers: g.maxPlayers,
    engineType: g.engineType,
    roles: g.roles,
    roundLimit: g.maxRounds,
  }));

export const demoGame = (id: string): DemoGame | null =>
  DEMO_GAMES.find((g) => g.id === id) ?? null;
