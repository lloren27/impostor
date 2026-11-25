import { GamePhase, GameState, Player, RoundResult, WordEntry } from '@/interfaces/game.interface'
import { defineStore } from 'pinia'

export const useGameStore = defineStore('game', {
  state: (): GameState => ({
    roomCode: null,
    mode: 'classic', 
    playerId: null as string | null,
    playerToken: null as string | null,
    me: null,
    phase: 'lobby',
    currentRound: 0,
    voteEpoch: 0,
    players: [],
    currentPlayerId: null,
    words: [],
    myRole: null,
    lastRoundResult: null,
    myVote: null,
    hasVoted: false,
    roundStarterId: null,
    tieCandidates: null,
    isReconnecting: false,
  }),
  // NO MODIFICAN SOLO COMPUTAN ESA INFORMACIÓN
  getters: {
    mePlayer(): Player | null {
      if (!this.playerId) return null
      return this.players.find((p) => p.id === this.playerId) ?? null
    },
    isHost(): boolean {
      const me = this.mePlayer
      return !!me?.isHost
    },
    isMyTurn(): boolean {
      const me = this.mePlayer
      return !!me && this.currentPlayerId === me.id
    },
    roundStarterName(state): string | null {
      if (!state.roundStarterId) return null
      const p = state.players.find((p) => p.id === state.roundStarterId)
      return p ? p.name : null
    },
  },
  // ACTIONS IMPLICAN ACTUALIZACIÓN
  actions: {
    setReconnecting(value: boolean) {
      this.isReconnecting = value
    },
    setPlayerId(id: string) {
      this.playerId = id
    },
    setPlayerToken(token: string) {
      this.playerToken = token
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setRoomJoined(payload: any) {
      this.roomCode = payload.roomCode
      this.mode = payload.room?.mode ?? payload.mode ?? 'classic'
      this.playerId = payload.playerId ?? payload.player.id
      // S1.1: el token viene en playerToken; player ya no incluye token
      this.playerToken = payload.playerToken

      this.players = (payload.room?.players ?? []).map((p: { id: string; name: string; alive: boolean; isHost?: boolean; connected?: boolean }) => ({
        id: p.id,
        name: p.name,
        alive: p.alive,
        isHost: p.isHost,
        connected: p.connected,
      }))

      this.me = this.players.find((p) => p.id === this.playerId) ?? null

      this.phase = payload.room.phase
      this.currentRound = payload.room.currentRound ?? 0
      this.voteEpoch = payload.room.voteEpoch ?? 0

      localStorage.setItem(
        'impostor-session',
        JSON.stringify({
          roomCode: payload.roomCode,
          playerId: payload.playerId ?? payload.player.id,
          playerToken: payload.playerToken,
        }),
      )

      this.clearTieCandidates()
      this.resetVoting()
    },

    updatePlayers(players: { id: string; name: string; alive: boolean; isHost?: boolean; connected?: boolean }[]) {
      this.players = players.map((p) => ({
        id: p.id,
        name: p.name,
        alive: p.alive,
        isHost: p.isHost,
        connected: p.connected,
      }))

      if (this.me) {
        const updatedMe = players.find((p) => p.id === this.me?.id)
        if (updatedMe) {
          this.me = {
            ...this.me,
            name: updatedMe.name,
            alive: updatedMe.alive,
            connected: updatedMe.connected,
            isHost: updatedMe.isHost,
          }
        }
      }
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
    setTieCandidates(players: Player[] | null) {
      // S1.1: tieCandidates ya vienen como PublicPlayer[]
      this.tieCandidates = players
    },
    clearTieCandidates() {
      this.tieCandidates = null
    },
    /**
     * S3.2 — applySnapshot: restaura el estado completo desde el servidor
     * sin triggers destructivos (no llama a resetVoting ni resetWords).
     */
    applySnapshot(snapshot: {
      roomCode: string
      mode: string
      phase: GamePhase
      players: { id: string; name: string; alive: boolean; isHost?: boolean; connected?: boolean }[]
      currentRound: number
      words: WordEntry[]
      tieCandidates: { id: string; name: string; alive: boolean; isHost?: boolean; connected?: boolean }[] | null
      voteEpoch: number
      winner: string | null
      lastEliminatedId: string | null
      lastEliminatedName: string | null
      lastEliminatedWasImpostor: boolean | null
      currentPlayerId: string | null
      myVote: string | null
      hasVoted: boolean
    }) {
      this.roomCode = snapshot.roomCode
      this.mode = snapshot.mode as 'classic' | 'manual'
      this.phase = snapshot.phase
      this.currentRound = snapshot.currentRound
      this.voteEpoch = snapshot.voteEpoch

      this.players = snapshot.players.map((p) => ({
        id: p.id,
        name: p.name,
        alive: p.alive,
        isHost: p.isHost,
        connected: p.connected,
      }))

      // Actualizar me si existe
      if (this.me) {
        const updatedMe = snapshot.players.find((p) => p.id === this.me?.id)
        if (updatedMe) {
          this.me = {
            ...this.me,
            name: updatedMe.name,
            alive: updatedMe.alive,
            connected: updatedMe.connected,
            isHost: updatedMe.isHost,
          }
        }
      }

      // Restaurar palabras
      this.words = snapshot.words ?? []

      // Restaurar turno actual
      if (snapshot.phase === 'words') {
        this.currentPlayerId = snapshot.currentPlayerId
      }

      // Restaurar estado del voto propio sin resetear
      if (snapshot.phase === 'voting') {
        this.hasVoted = snapshot.hasVoted ?? false
        this.myVote = snapshot.myVote ?? null
      }

      // Restaurar candidatos de empate
      this.tieCandidates = snapshot.tieCandidates
        ? snapshot.tieCandidates.map((p) => ({
            id: typeof p === 'string' ? p : p.id,
            name: typeof p === 'string' ? '' : p.name,
            alive: typeof p === 'string' ? true : p.alive,
            isHost: typeof p === 'string' ? false : p.isHost,
            connected: typeof p === 'string' ? true : p.connected,
          }))
        : null

      // Fix 4 completo: reconstruir lastRoundResult desde el snapshot
      // en finished (con winner) y en revealRound (resultado de ronda intermedia).
      if ((snapshot.phase === 'finished' && snapshot.winner) || snapshot.phase === 'revealRound') {
        // Usar lastEliminatedName del snapshot si está disponible;
        // si no, intentar recuperar de la lista de players (el expulsado aún está en la sala).
        let eliminatedPlayer = null
        if (snapshot.lastEliminatedId && snapshot.lastEliminatedName) {
          eliminatedPlayer = {
            id: snapshot.lastEliminatedId,
            name: snapshot.lastEliminatedName,
            alive: false,
            isHost: false,
            connected: false,
          }
        } else if (snapshot.lastEliminatedId) {
          const elim = snapshot.players.find((p) => p.id === snapshot.lastEliminatedId)
          if (elim) {
            eliminatedPlayer = {
              id: elim.id,
              name: elim.name,
              alive: elim.alive,
              isHost: elim.isHost,
              connected: elim.connected,
            }
          }
        }
        this.lastRoundResult = {
          eliminatedPlayer,
          wasImpostor: snapshot.lastEliminatedWasImpostor ?? null,
          winner: snapshot.winner as 'players' | 'impostor' | null,
        }
      }
    },
  },
})
