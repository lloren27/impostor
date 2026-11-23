// src/game/types.ts

export type GamePhase =
  | "lobby"
  | "reveal"
  | "words"
  | "voting"
  | "revealRound"
  | "finished";

export type GameMode = "classic" | "manual";

export interface Player {
  id: string;
  token: string;
  socketId: string | null;
  name: string;
  isHost: boolean;
  isImpostor: boolean;
  character: string | null;
  alive: boolean;
  connected: boolean;
  disconnectedAt: number | null;
  joinedAt: number;
}

/** Versión pública de Player: sin token, socketId, isImpostor, character ni disconnectedAt */
export interface PublicPlayer {
  id: string;
  name: string;
  alive: boolean;
  isHost: boolean;
  connected: boolean;
}

export function toPublicPlayer(p: Player): PublicPlayer {
  return {
    id: p.id,
    name: p.name,
    alive: p.alive,
    isHost: p.isHost,
    connected: p.connected,
  };
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
  /** Ausentes en snapshots anteriores al sprint 2; se migran en la primera mutación. */
  version?: number;
  voteEpoch?: number;
  instanceId?: string;
  code: string;
  mode: GameMode;
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
  /** ID del jugador expulsado en la última ronda (para snapshot en fase finished). */
  lastEliminatedId: string | null;
  /** Nombre del jugador expulsado (persistido para snapshot si el jugador ya no está en la sala). */
  lastEliminatedName: string | null;
  /** Si el jugador expulsado era el impostor (para snapshot en revealRound/finished). */
  lastEliminatedWasImpostor: boolean | null;
}
