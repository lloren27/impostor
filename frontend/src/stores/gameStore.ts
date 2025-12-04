// src/stores/gameStore.ts
import { GamePhase, GameState, RoundResult, WordEntry } from '@/interfaces/game.interface'
import { defineStore } from 'pinia'

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
    myVote: null,
    hasVoted: false,
    roundStarterId: null,
  }),
  // NO MODIFICAN SOLO COMPUTAN ESA INFORMACIÓN
  getters: {
    isHost(state): boolean {
      return !!state.me?.isHost
    },
    isMyTurn(state): boolean {
      return !!state.me && state.currentPlayerId === state.me.id
    },
    roundStarterName(state): string | null {
      if (!state.roundStarterId) return null
      const p = state.players.find((p) => p.id === state.roundStarterId)
      return p ? p.name : null
    },
  },
  // ACTIONS IMPLICAN ACTUALIZACIÓN
  actions: {
    setRoomJoined(payload: any) {
      this.roomCode = payload.roomCode
      this.me = payload.player
      this.players = payload.room.players.map((p: any) => ({
        id: p.id,
        name: p.name,
        alive: p.alive,
        isHost: p.isHost,
      }))
      this.phase = payload.room.phase
      this.currentRound = payload.room.currentRound ?? 0

      this.resetVoting()
    },
    updatePlayers(players: any[]) {
      this.players = players.map((p: any) => ({
        id: p.id,
        name: p.name,
        alive: p.alive,
        isHost: p.isHost,
      }))
    },
    setPhase(phase: GamePhase, currentRound?: number) {
      this.phase = phase
      if (typeof currentRound === 'number') {
        this.currentRound = currentRound
      }
    },
    setCurrentTurn(playerId: string | null) {
      this.currentPlayerId = playerId
    },
    addWord(entry: WordEntry, allWords?: WordEntry[]) {
      if (allWords) {
        this.words = allWords
      } else {
        this.words.push(entry)
      }
    },
    setMyRole(isImpostor: boolean, character: string | null) {
      this.myRole = { isImpostor, character }
    },
    setLastRoundResult(result: RoundResult) {
      this.lastRoundResult = result
    },
    setRoundStarter(playerId: string | null) {
      this.roundStarterId = playerId
    },
    resetWords() {
      this.words = []
    },
    setMyVote(playerId: string | null) {
      this.myVote = playerId
    },
    markAsVoted() {
      this.hasVoted = true
    },
    resetVoting() {
      this.myVote = null
      this.hasVoted = false
    },
  },
})
