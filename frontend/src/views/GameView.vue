<template>
  <main class="game">
    <h1>Partida – Sala {{ roomCode }}</h1>
    <p>Fase: {{ phase }}</p>

    <!-- FASE REVEAL: cada uno ve su personaje / rol -->
    <section v-if="phase === 'reveal'">
      <h2>Tu rol</h2>
      <p v-if="myRole">
        <span v-if="myRole.isImpostor">
          Eres el <strong>IMPOSTOR</strong>. No sabes el personaje, intenta camuflarte.
        </span>
        <span v-else>
          Tu personaje es: <strong>{{ myRole.character }}</strong>
        </span>
      </p>
      <button @click="startWordsRound">Empezar ronda de palabras</button>
    </section>

    <!-- FASE WORDS: ronda de palabras -->
    <section v-else-if="phase === 'words'">
      <h2>Ronda de palabras (ronda {{ gameStore.currentRound }})</h2>

      <h3>Palabras dichas</h3>
      <ul>
        <li v-for="w in words" :key="w.playerId + w.word">
          {{ players.find((p) => p.id === w.playerId)?.name || '??' }}:
          {{ w.word }}
        </li>
      </ul>

      <div v-if="isMyTurn">
        <p>Es tu turno. Escribe una palabra relacionada con el personaje.</p>
        <input v-model="myWord" placeholder="Tu palabra" />
        <button @click="sendWord">Enviar</button>
      </div>
      <div v-else>
        <p>
          Es el turno de
          <strong>
            {{ players.find((p) => p.id === currentPlayerId)?.name || '...' }}
          </strong>
        </p>
      </div>
    </section>

    <!-- FASE VOTING: votación -->

    <section v-else-if="gameStore.phase === 'voting'">
      <h2>Votación</h2>
      <p>¿Quién crees que es el impostor?</p>

      <!-- Feedback de que ya ha votado -->
      <p v-if="gameStore.hasVoted" class="info-text">
        Ya has votado. Espera a que termine la votación.
      </p>

      <ul>
        <li v-for="p in gameStore.players.filter((p) => p.alive)" :key="p.id">
          <label>
            <input
              type="radio"
              name="vote"
              :value="p.id"
              v-model="gameStore.myVote"
              :disabled="gameStore.hasVoted"
            />
            {{ p.name }}
          </label>
        </li>
      </ul>

      <button @click="submitVote" :disabled="gameStore.hasVoted || !gameStore.myVote">Votar</button>
    </section>

    <!-- FASE REVEALROUND / FIN: resultado ronda o final -->
    <section v-else-if="phase === 'revealRound' || phase === 'finished'">
      <h2>Resultado de la ronda</h2>

      <div v-if="gameStore.lastRoundResult">
        <p v-if="gameStore.lastRoundResult.eliminatedPlayer">
          Expulsado:
          <strong>{{ gameStore.lastRoundResult.eliminatedPlayer.name }}</strong>
          <span v-if="gameStore.lastRoundResult.wasImpostor"> (ERA el impostor) </span>
          <span v-else> (NO era el impostor) </span>
        </p>

        <p v-if="gameStore.lastRoundResult.winner">
          Ganador:
          <strong>
            {{ gameStore.lastRoundResult.winner === 'players' ? 'Los jugadores' : 'El impostor' }}
          </strong>
        </p>
      </div>

      <div v-if="phase === 'finished'">
        <p>La partida ha terminado.</p>

        <div class="buttons-finished">
          <!-- Solo el host puede reiniciar o cerrar la sala -->
          <button v-if="gameStore.isHost" @click="restartGame">Reiniciar partida</button>
          <button v-if="gameStore.isHost" @click="finishGame">Finalizar partida</button>

          <!-- Para el resto de jugadores, solo mostramos que esperen al host -->
          <p v-else>Esperando a que el anfitrión decida reiniciar o finalizar la partida...</p>
        </div>
      </div>

      <div v-else>
        <button @click="startNextRound">Siguiente ronda</button>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGameSocket } from '@/composables/useGameSocket'
import { useGameStore } from '@/stores/gameStore'
import { socket } from '@/services/socket'

const route = useRoute()
const router = useRouter()
const { gameStore } = useGameSocket()

const phase = computed(() => gameStore.phase)
const myRole = computed(() => gameStore.myRole)
const players = computed(() => gameStore.players)
const words = computed(() => gameStore.words)
const isMyTurn = computed(() => gameStore.isMyTurn)
const currentPlayerId = computed(() => gameStore.currentPlayerId)
const roomCode = computed(() => route.params.code as string)

const myWord = ref('')

function sendWord() {
  if (!myWord.value.trim()) return
  socket.emit('submitWord', {
    roomCode: roomCode.value,
    word: myWord.value.trim(),
  })
  myWord.value = ''
}

function submitVote() {
  if (gameStore.hasVoted) return
  if (!gameStore.myVote) return
  if (!gameStore.me || !gameStore.roomCode) return

  socket.emit('castVote', {
    roomCode: gameStore.roomCode,
    voterId: gameStore.me.id,
    voteFor: gameStore.myVote,
  })

  gameStore.markAsVoted()
}

function startWordsRound() {
  socket.emit('startWordsRound', { roomCode: roomCode.value })
}

function startNextRound() {
  socket.emit('startNextRound', { roomCode: roomCode.value })
}

function restartGame() {
  socket.emit('restartGame', { roomCode: roomCode.value })
}

function finishGame() {
  socket.emit('endGame', { roomCode: roomCode.value })
}

function handleRoomEnded() {
  // resetear estado local y volver a Home
  gameStore.$reset()
  router.push({ name: 'home' })
}

onMounted(() => {
  socket.on('roomEnded', handleRoomEnded)
})

onUnmounted(() => {
  socket.off('roomEnded', handleRoomEnded)
})
</script>

<style scoped>
.game {
  max-width: 700px;
  margin: 2rem auto;
}
input {
  padding: 0.5rem;
}
button {
  margin-top: 0.5rem;
  padding: 0.5rem;
}

.buttons-finished {
  margin-top: 1rem;
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}
</style>
