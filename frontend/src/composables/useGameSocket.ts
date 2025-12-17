import { onMounted, onUnmounted } from 'vue'
import router from '@/router'
import { socket } from '@/services/socket'
import { useGameStore } from '@/stores/gameStore'
import { GamePhase } from '@/interfaces/game.interface'
import { useUiStore } from '@/stores/uiStore'
import { i18n } from '@/i18n'

export function useGameSocket() {
  const gameStore = useGameStore()
  const uiStore = useUiStore()

  const tieVoteCallbacks: Array<() => void> = []

  function onTieVote(cb: () => void) {
    tieVoteCallbacks.push(cb)
  }

  function translateBackendError(code: string) {
    const key = `errors.${code}`
    return i18n.global.te(key) ? i18n.global.t(key) : code
  }

  // ahora los callbacks reciben el payload
  const roomJoinedCallbacks: Array<(payload: any) => void> = []
  const errorCallbacks: Array<() => void> = []

  function onRoomJoined(cb: (payload: any) => void) {
    roomJoinedCallbacks.push(cb)
  }

  function onError(cb: () => void) {
    errorCallbacks.push(cb)
  }

  function handleConnect() {
    const saved = localStorage.getItem('impostor-session')
    if (!saved) return

    const { roomCode, playerToken } = JSON.parse(saved)

    if (!roomCode || !playerToken) return
    gameStore.setReconnecting(true)

    socket.emit('rejoinRoom', { roomCode, playerToken })
  }

  onMounted(() => {
    socket.on('connect', handleConnect)
    socket.on('roomJoined', (payload) => {
      gameStore.setReconnecting(false)
      gameStore.setRoomJoined(payload)
      gameStore.setPlayerId(payload.playerId)
      if (payload.playerToken) gameStore.setPlayerToken?.(payload.playerToken)

      roomJoinedCallbacks.forEach((cb) => cb(payload))
    })

    socket.on('playersUpdated', ({ players }) => {
      gameStore.updatePlayers(players)
    })

    socket.on('errorMessage', ({ code, message }) => {
      gameStore.setReconnecting(false)

      const errorCode = code ?? message ?? 'UNKNOWN'

      const translated = translateBackendError(errorCode)

      uiStore.showInfo(translated, i18n.global.t('common.errorTitle'))

      errorCallbacks.forEach((cb) => cb())

      if (errorCode === 'ROOM_NOT_FOUND') {
        router.push({ name: 'NotFound' })
      }

      // (opcional) para debug:
      // if (!code && message) console.warn('[backend error message]', message)
    })

    socket.on(
      'gameStarted',
      ({
        phase,
        players,
        roomCode,
        currentRound,
      }: {
        phase: GamePhase
        players: any[]
        roomCode: string
        currentRound?: number
      }) => {
        gameStore.roomCode = roomCode
        gameStore.updatePlayers(players)
        gameStore.setPhase(phase, currentRound)

        gameStore.resetWords()
        gameStore.resetVoting()
        gameStore.lastRoundResult = null
        gameStore.setRoundStarter(null)
        gameStore.setCurrentTurn(null)

        router.push({ name: 'game', params: { code: roomCode } })
      },
    )

    socket.on('phaseChanged', ({ phase, currentRound }) => {
      gameStore.setPhase(phase, currentRound)

      if (phase === 'words') {
        gameStore.resetWords()
      }

      if (phase === 'voting') {
        gameStore.resetVoting()
      }
    })

    socket.on('yourRole', ({ isImpostor, character }) => {
      gameStore.setMyRole(isImpostor, character)
      gameStore.setPhase('reveal')
    })

    socket.on('turnChanged', ({ currentPlayerId }) => {
      if (gameStore.phase === 'words' && !gameStore.roundStarterId) {
        gameStore.setRoundStarter(currentPlayerId)
      }
      gameStore.setCurrentTurn(currentPlayerId)
    })

    socket.on('wordAdded', ({ playerId, word, words }) => {
      gameStore.addWord({ playerId, word }, words)
    })

    socket.on('roundResult', (payload) => {
      gameStore.setLastRoundResult(payload)
    })

    socket.on('tieVote', ({ tieCandidates }) => {
      gameStore.setTieCandidates(tieCandidates)
      gameStore.resetVoting()

      uiStore.showInfo(i18n.global.t('game.tieVoteMessage'), i18n.global.t('game.tieVoteTitle'))

      tieVoteCallbacks.forEach((cb) => cb()) // 👈 IMPORTANTE
    })

    socket.on('gameFinished', ({ winner }) => {
      gameStore.setPhase('finished')
      gameStore.setLastRoundResult({ winner })
    })

    socket.on('roomEnded', () => {
      gameStore.$reset()
      router.push({ name: 'home' })
    })

    socket.on('disconnect', () => {
      gameStore.setReconnecting(true)
      errorCallbacks.forEach((cb) => cb())
    })

    socket.on('connect_error', () => {
      gameStore.setReconnecting(true)
      errorCallbacks.forEach((cb) => cb())
    })
  })

  onUnmounted(() => {
    socket.off('connect', handleConnect)
    socket.off('roomJoined')
    socket.off('playersUpdated')
    socket.off('errorMessage')
    socket.off('yourRole')
    socket.off('gameStarted')
    socket.off('phaseChanged')
    socket.off('turnChanged')
    socket.off('wordAdded')
    socket.off('roundResult')
    socket.off('gameFinished')
    socket.off('roomEnded')
    socket.off('tieVote')
    socket.off('disconnect')
    socket.off('connect_error')

    roomJoinedCallbacks.length = 0
    errorCallbacks.length = 0
    tieVoteCallbacks.length = 0
  })

  return {
    socket,
    gameStore,
    onRoomJoined,
    onError,
    onTieVote,
  }
}
