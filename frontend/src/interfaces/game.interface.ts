export type GamePhase = 'lobby' | 'reveal' | 'words' | 'voting' | 'revealRound' | 'finished'
export type GameMode = 'classic' | 'manual'
export type CharacterAmbit = 'random' | 'sports' | 'cinema' | 'music' | 'streamers' | 'politics' | 'internet'


export interface Player {
  id: string
  name: string
  alive: boolean
  isHost?: boolean
  connected?:boolean
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
  roomCode: string | null,
  mode: GameMode,
  me: Player | null
  playerId: string | null
  playerToken: string | null
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
  isReconnecting: boolean
}
