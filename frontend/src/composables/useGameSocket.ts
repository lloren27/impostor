// src/composables/useGameSocket.ts
import { onMounted, onUnmounted } from 'vue'
import router from '@/router'
import { socket } from '@/services/socket'
import { useGameStore } from '@/stores/gameStore'
import { GamePhase } from '@/interfaces/game.interface'
import { useUiStore } from '@/stores/uiStore'

export function useGameSocket() {
  const gameStore = useGameStore()
  const uiStore = useUiStore()

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

    const { roomCode, playerId } = JSON.parse(saved)

    if (!roomCode || !playerId) return
    gameStore.setReconnecting(true)

    socket.emit('rejoinRoom', { roomCode, playerId })
  }

  onMounted(() => {
    socket.on('connect', handleConnect)

    socket.on('roomJoined', (payload) => {
      gameStore.setReconnecting(false)
      gameStore.setRoomJoined(payload)
      roomJoinedCallbacks.forEach((cb) => cb(payload))
    })

    socket.on('playersUpdated', ({ players }) => {
      gameStore.updatePlayers(players)
    })

    socket.on('errorMessage', ({ message }) => {
      gameStore.setReconnecting(false)
      uiStore.showInfo(message, 'Error')
      errorCallbacks.forEach((cb) => cb())
      if (message.includes('no existe') || message.includes('not found')) {
        router.push({ name: 'NotFound' })
        return
      }
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
      // pasamos a fase reveal en el cliente si queremos
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
      // Guardamos los candidatos de desempate
      gameStore.setTieCandidates(tieCandidates)
      // Reseteamos el voto del jugador para que pueda volver a votar
      gameStore.resetVoting()
      // Aquí puedes mostrar un mensaje UI tipo:
      // "Empate, volved a votar entre los jugadores empatados"
    })

    socket.on('gameFinished', ({ winner }) => {
      gameStore.setPhase('finished')
      gameStore.setLastRoundResult({ winner })
    })

    socket.on('roomEnded', () => {
      gameStore.$reset()
      router.push({ name: 'home' })
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

    roomJoinedCallbacks.length = 0
    errorCallbacks.length = 0
  })

  return {
    socket,
    gameStore,
    onRoomJoined,
    onError,
  }
}
