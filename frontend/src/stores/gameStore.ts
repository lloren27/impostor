// src/stores/gameStore.ts
import { defineStore } from 'pinia';

export type GamePhase = 'lobby' | 'reveal' | 'words' | 'voting' | 'revealRound' | 'finished';

export interface Player {
  id: string;
  name: string;
  alive: boolean;
  isHost?: boolean;
}

export interface WordEntry {
  playerId: string;
  word: string;
}

export interface RoundResult {
  eliminatedPlayer?: Player | null;
  wasImpostor?: boolean | null;
  winner?: 'players' | 'impostor' | null;
}

interface GameState {
  roomCode: string | null;
  me: Player | null;

  phase: GamePhase;
  currentRound: number;

  players: Player[];
  currentPlayerId: string | null; // al que le toca hablar
  words: WordEntry[];

  myRole: {
    isImpostor: boolean;
    character: string | null;
  } | null;

  lastRoundResult: RoundResult | null;
}

export const useGameStore = defineStore('game', {
  state: (): GameState => ({
    roomCode: null,
    me: null,

    phase: 'lobby',
    currentRound: 0,

    players: [],
    currentPlayerId: null,
    words: [],

    myRole: null,
    lastRoundResult: null,
  }),
  getters: {
    isHost(state): boolean {
      return !!state.me && !!state.players.find(p => p.id === state.me!.id && p.isHost);
    },
    isMyTurn(state): boolean {
      return !!state.me && state.currentPlayerId === state.me.id;
    },
  },
  actions: {
    setRoomJoined(payload: any) {
      this.roomCode = payload.roomCode;
      this.me = payload.player;
      this.players = payload.room.players.map((p: any) => ({
        id: p.id,
        name: p.name,
        alive: p.alive,
        isHost: p.isHost,
      }));
      this.phase = payload.room.phase;
      this.currentRound = payload.room.currentRound ?? 0;
    },
    updatePlayers(players: any[]) {
      this.players = players.map((p: any) => ({
        id: p.id,
        name: p.name,
        alive: p.alive,
        isHost: p.isHost,
      }));
    },
    setPhase(phase: GamePhase, currentRound?: number) {
      this.phase = phase;
      if (typeof currentRound === 'number') {
        this.currentRound = currentRound;
      }
    },
    setCurrentTurn(playerId: string | null) {
      this.currentPlayerId = playerId;
    },
    addWord(entry: WordEntry, allWords?: WordEntry[]) {
      if (allWords) {
        this.words = allWords;
      } else {
        this.words.push(entry);
      }
    },
    setMyRole(isImpostor: boolean, character: string | null) {
      this.myRole = { isImpostor, character };
    },
    setLastRoundResult(result: RoundResult) {
      this.lastRoundResult = result;
    },
    resetWords() {
      this.words = [];
    },
  },
});
