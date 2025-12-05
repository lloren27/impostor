export type GamePhase = 'lobby' | 'reveal' | 'words' | 'voting' | 'revealRound' | 'finished'

export interface Player {
  id: string
  name: string
  alive: boolean
  isHost?: boolean
}

export interface WordEntry {
  playerId: string
  word: string
}

export interface RoundResult {
  eliminatedPlayer?: Player | null
  wasImpostor?: boolean | null
  winner?: 'players' | 'impostor' | null
}

export interface GameState {
  roomCode: string | null
  me: Player | null
  phase: GamePhase
  currentRound: number
  players: Player[]
  currentPlayerId: string | null // al que le toca hablar
  words: WordEntry[]
  myRole: {
    isImpostor: boolean
    character: string | null
  } | null
  lastRoundResult: RoundResult | null
  myVote: string | null // id del jugador al que voto
  hasVoted: boolean
  roundStarterId: string | null 
  tieCandidates: Player[] | null
}
