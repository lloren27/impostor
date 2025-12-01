// src/composables/useGameSocket.ts
import { onMounted, onUnmounted } from 'vue'
import { socket } from '@/services/socket'
import { useGameStore } from '@/stores/gameStore'
import router from '@/router'

export function useGameSocket() {
  const gameStore = useGameStore()

  onMounted(() => {
    // Respuesta al crear / unirse a una sala
    socket.on('roomJoined', (payload) => {
      gameStore.setRoomJoined(payload)
    })

    socket.on('playersUpdated', ({ players }) => {
      gameStore.updatePlayers(players)
    })

    socket.on('errorMessage', ({ message }) => {
      // Por ahora un alert simple, luego lo cambiamos por UI bonita
      alert(message)
    })

    socket.on('yourRole', ({ isImpostor, character }) => {
      gameStore.setMyRole(isImpostor, character)
      // pasamos a fase reveal en el cliente si queremos
      gameStore.setPhase('reveal')
    })

    socket.on('gameStarted', ({ phase, players, roomCode }) => {
      gameStore.roomCode = roomCode
      gameStore.updatePlayers(players)
      gameStore.setPhase(phase)
      router.push({ name: 'game', params: { code: roomCode } })
    })

    socket.on('phaseChanged', ({ phase, currentRound }) => {
      gameStore.setPhase(phase, currentRound)

      if (phase === 'words') {
        gameStore.resetWords()
      }

      if (phase === 'voting') {
        gameStore.resetVoting() // 👈 limpia myVote y hasVoted
      }
    })

    socket.on('turnChanged', ({ currentPlayerId }) => {
      gameStore.setCurrentTurn(currentPlayerId)
    })

    socket.on('wordAdded', ({ playerId, word, words }) => {
      gameStore.addWord({ playerId, word }, words)
    })

    socket.on('roundResult', (payload) => {
      gameStore.setLastRoundResult(payload)
      // aquí normalmente phase será 'finished' o 'revealRound'
    })

    socket.on('gameFinished', ({ winner }) => {
      gameStore.setPhase('finished')
      gameStore.setLastRoundResult({
        winner,
      })
    })
  })

  onUnmounted(() => {
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
  })

  return {
    socket,
    gameStore,
  }
}
