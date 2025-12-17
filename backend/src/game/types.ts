// src/game/types.ts

export type GamePhase =
  | "lobby"
  | "reveal"
  | "words"
  | "voting"
  | "revealRound"
  | "finished";

export interface Player {
  id: string; 
  token: string   
  socketId: string | null; 
  name: string;
  isHost: boolean;
  isImpostor: boolean;
  character: string | null;
  alive: boolean;
  connected: boolean       
  disconnectedAt: number | null 
  joinedAt: number           
}

export interface WordEntry {
  playerId: string;
  word: string;
}

export interface VoteEntry {
  voterId: string;
  targetId: string;
}

export interface Room {
  code: string;
  players: Player[];
  phase: GamePhase;
  character: string | null;
  impostorId: string | null;
  currentRound: number;
  baseOrder: string[];
  roundStartIndex: number;
  currentTurnIndex: number;
  words: WordEntry[];
  votes: VoteEntry[];
  winner: "players" | "impostor" | null;
  tieCandidates: string[] | null;
}
