import { onMounted, onUnmounted } from 'vue'
import router from '@/router'
import { socket } from '@/services/socket'
import { useGameStore } from '@/stores/gameStore'
import { GamePhase } from '@/interfaces/game.interface'
import { useUiStore } from '@/stores/uiStore'
import { i18n } from '@/i18n'
import { GameMode } from '../interfaces/game.interface'

export function useGameSocket() {
  const gameStore = useGameStore()
  const uiStore = useUiStore()

  const tieVoteCallbacks: Array<() => void> = []
  const gameStartedCallbacks: Array<() => void> = []

  function onTieVote(cb: () => void) {
    tieVoteCallbacks.push(cb)
  }

  function translateBackendError(code: string) {
    const key = `errors.${code}`
    return i18n.global.te(key) ? i18n.global.t(key) : code
  }

  function onGameStarted(cb: () => void) {
    gameStartedCallbacks.push(cb)
  }

  function exitToHome() {
    // S3.1: notificar al servidor que el jugador abandona la sala
    if (gameStore.roomCode && socket.connected) {
      socket.emit('leaveRoom')
    }
    localStorage.removeItem('impostor-session')
    gameStore.setReconnecting(false)
    gameStore.$reset()
    router.push({ name: 'home' })
  }

  // ahora los callbacks reciben el payload
  const roomJoinedCallbacks: Array<(payload: any) => void> = []
  const errorCallbacks: Array<() => void> = []

  function onRoomJoinedCallback(cb: (payload: any) => void) {
    roomJoinedCallbacks.push(cb)
  }

  function onError(cb: () => void) {
    errorCallbacks.push(cb)
  }

  // S3.2: limitar intentos de reconexión automática para evitar bucles
  let rejoinAttempted = false

  // S3.2: listeners por referencia para retirar solo los propios
  function onConnect() {
    const saved = localStorage.getItem('impostor-session')
    if (!saved) return

    let session: { roomCode: string; playerToken: string } | null
    try {
      session = JSON.parse(saved)
    } catch {
      localStorage.removeItem('impostor-session')
      return
    }

    // Fix 5: JSON.parse puede devolver null para una sesión con JSON válido pero nulo
    if (!session) {
      localStorage.removeItem('impostor-session')
      return
    }

    const { roomCode, playerToken } = session
    if (!roomCode || !playerToken) {
      localStorage.removeItem('impostor-session')
      return
    }

    if (rejoinAttempted) return
    rejoinAttempted = true

    gameStore.setReconnecting(true)
    socket.emit('rejoinRoom', { roomCode, playerToken })
  }

  function onRoomJoined(payload: any) {
    gameStore.setReconnecting(false)
    gameStore.setRoomJoined(payload)
    gameStore.setPlayerId(payload.playerId)
    if (payload.playerToken) gameStore.setPlayerToken?.(payload.playerToken)
    roomJoinedCallbacks.forEach((cb) => cb(payload))
  }

  function onRoomState(state: any) {
    gameStore.applySnapshot({
      roomCode: state.roomCode,
      mode: state.mode,
      phase: state.phase,
      players: state.players ?? [],
      currentRound: state.currentRound ?? 0,
      words: state.words ?? [],
      tieCandidates: state.tieCandidates,
      voteEpoch: state.voteEpoch ?? 0,
      winner: state.winner,
      lastEliminatedId: state.lastEliminatedId ?? null,
      lastEliminatedName: state.lastEliminatedName ?? null,
      lastEliminatedWasImpostor: state.lastEliminatedWasImpostor ?? null,
      currentPlayerId: state.currentPlayerId,
      myVote: state.myVote ?? null,
      hasVoted: state.hasVoted ?? false,
    })

    if (state.phase === 'words' && !gameStore.roundStarterId && state.currentPlayerId) {
      gameStore.setRoundStarter(state.currentPlayerId)
    }

    if (state.phase && state.phase !== 'lobby') {
      router.push({ name: 'game', params: { code: state.roomCode } })
    }
  }

  function onPlayersUpdated({ players }: { players: any[] }) {
    gameStore.updatePlayers(players)
  }

  function onErrorMessage({ code, message }: { code: string; message: string }) {
    gameStore.setReconnecting(false)
    const errorCode = code ?? message ?? 'UNKNOWN'
    const translated = translateBackendError(errorCode)
    uiStore.showInfo(translated, i18n.global.t('common.errorTitle'))
    errorCallbacks.forEach((cb) => cb())

    if (errorCode === 'ROOM_NOT_FOUND' || errorCode === 'PLAYER_NOT_FOUND') {
      localStorage.removeItem('impostor-session')
      gameStore.$reset()
      router.push({ name: 'NotFound' })
    }
  }

  function onGameStartedEvent({
    phase,
    players,
    roomCode,
    currentRound,
    voteEpoch,
    mode,
  }: {
    phase: GamePhase
    players: any[]
    roomCode: string
    currentRound?: number
    voteEpoch?: number
    mode: GameMode
  }) {
    gameStore.roomCode = roomCode
    gameStore.updatePlayers(players)
    gameStore.setPhase(phase, currentRound)
    gameStore.voteEpoch = voteEpoch ?? 0
    if (mode) gameStore.mode = mode
    gameStore.resetWords()
    gameStore.resetVoting()
    gameStore.lastRoundResult = null
    gameStore.setRoundStarter(null)
    gameStore.setCurrentTurn(null)
    router.push({ name: 'game', params: { code: roomCode } })
    gameStartedCallbacks.forEach((cb) => cb())
  }

  function onPhaseChanged({ phase, currentRound, voteEpoch }: { phase: GamePhase; currentRound?: number; voteEpoch?: number }) {
    gameStore.setPhase(phase, currentRound)
    if (voteEpoch !== undefined) gameStore.voteEpoch = voteEpoch
    if (phase === 'words') gameStore.resetWords()
    if (phase === 'voting') gameStore.resetVoting()
  }

  function onYourRole({ isImpostor, character }: { isImpostor: boolean; character: string | null }) {
    gameStore.setMyRole(isImpostor, character)
  }

  function onTurnChanged({ currentPlayerId }: { currentPlayerId: string | null }) {
    if (gameStore.phase === 'words' && !gameStore.roundStarterId) {
      gameStore.setRoundStarter(currentPlayerId)
    }
    gameStore.setCurrentTurn(currentPlayerId)
  }

  function onWordAdded({ playerId, word, words }: { playerId: string; word: string; words: any[] }) {
    gameStore.addWord({ playerId, word }, words)
  }

  function onRoundResult(payload: any) {
    gameStore.setLastRoundResult(payload)
  }

  // S3.2: confirmar el voto en el store solo cuando el servidor lo acepta
  function onVoteConfirmed() {
    gameStore.markAsVoted()
  }

  function onTieVoteEvent({ tieCandidates, voteEpoch }: { tieCandidates: any[]; voteEpoch: number }) {
    gameStore.voteEpoch = voteEpoch ?? 0
    const mapped = tieCandidates.map((p: any) => ({
      id: p.id,
      name: p.name,
      alive: p.alive,
      isHost: p.isHost,
      connected: p.connected,
    }))
    gameStore.setTieCandidates(mapped)
    gameStore.resetVoting()
    uiStore.showInfo(i18n.global.t('game.tieVoteMessage'), i18n.global.t('game.tieVoteTitle'))
    tieVoteCallbacks.forEach((cb) => cb())
  }

  function onGameFinished({ winner }: { winner: 'players' | 'impostor' }) {
    gameStore.setPhase('finished')
    gameStore.setLastRoundResult({ winner })
  }

  function onRoomEnded() {
    // Fix 3: limpiar la sesión local para que una reconexión posterior
    // no intente recuperar una sala que ya terminó
    localStorage.removeItem('impostor-session')
    gameStore.$reset()
    router.push({ name: 'home' })
  }

  function onDisconnect() {
    rejoinAttempted = false
    gameStore.setReconnecting(true)
    errorCallbacks.forEach((cb) => cb())
  }

  function onConnectError() {
    gameStore.setReconnecting(true)
    errorCallbacks.forEach((cb) => cb())
  }

  onMounted(() => {
    socket.on('connect', onConnect)
    socket.on('roomJoined', onRoomJoined)
    socket.on('roomState', onRoomState)
    socket.on('playersUpdated', onPlayersUpdated)
    socket.on('errorMessage', onErrorMessage)
    socket.on('gameStarted', onGameStartedEvent)
    socket.on('phaseChanged', onPhaseChanged)
    socket.on('yourRole', onYourRole)
    socket.on('turnChanged', onTurnChanged)
    socket.on('wordAdded', onWordAdded)
    socket.on('roundResult', onRoundResult)
    socket.on('voteConfirmed', onVoteConfirmed)
    socket.on('tieVote', onTieVoteEvent)
    socket.on('gameFinished', onGameFinished)
    socket.on('roomEnded', onRoomEnded)
    socket.on('disconnect', onDisconnect)
    socket.on('connect_error', onConnectError)
  })

  onUnmounted(() => {
    socket.off('connect', onConnect)
    socket.off('roomJoined', onRoomJoined)
    socket.off('roomState', onRoomState)
    socket.off('playersUpdated', onPlayersUpdated)
    socket.off('errorMessage', onErrorMessage)
    socket.off('gameStarted', onGameStartedEvent)
    socket.off('phaseChanged', onPhaseChanged)
    socket.off('yourRole', onYourRole)
    socket.off('turnChanged', onTurnChanged)
    socket.off('wordAdded', onWordAdded)
    socket.off('roundResult', onRoundResult)
    socket.off('voteConfirmed', onVoteConfirmed)
    socket.off('tieVote', onTieVoteEvent)
    socket.off('gameFinished', onGameFinished)
    socket.off('roomEnded', onRoomEnded)
    socket.off('disconnect', onDisconnect)
    socket.off('connect_error', onConnectError)

    roomJoinedCallbacks.length = 0
    errorCallbacks.length = 0
    tieVoteCallbacks.length = 0
    gameStartedCallbacks.length = 0
  })

  return {
    socket,
    gameStore,
    onRoomJoined: onRoomJoinedCallback,
    onError,
    onTieVote,
    onGameStarted,
    exitToHome,
  }
}
