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
    <section v-else-if="phase === 'voting'">
      <h2>Votación</h2>
      <p>¿Quién crees que es el impostor?</p>
      <ul>
        <li v-for="p in players.filter((p) => p.alive)" :key="p.id">
          <label>
            <input type="radio" name="vote" :value="p.id" v-model="myVote" />
            {{ p.name }}
          </label>
        </li>
      </ul>
      <button @click="submitVote">Votar</button>
    </section>

    <!-- FASE REVEALROUND / FIN: resultado ronda o final -->
    <section v-else-if="phase === 'revealRound' || phase === 'finished'">
      <h2>Resultado de la ronda</h2>
      <div v-if="gameStore.lastRoundResult">
        <p v-if="gameStore.lastRoundResult.eliminatedPlayer">
          Expulsado:
          <strong>{{ gameStore.lastRoundResult.eliminatedPlayer.name }}</strong>
          <span v-if="gameStore.lastRoundResult.wasImpostor"> (ERA el impostor)</span>
          <span v-else> (NO era el impostor)</span>
        </p>

        <p v-if="gameStore.lastRoundResult.winner">
          <strong>
            Ganador:
            {{ gameStore.lastRoundResult.winner === 'players' ? 'Los jugadores' : 'El impostor' }}
          </strong>
        </p>
      </div>

      <div v-if="phase === 'finished'">
        <p>La partida ha terminado.</p>
      </div>
      <div v-else>
        <button @click="startNextRound">Siguiente ronda</button>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useGameSocket } from '@/composables/useGameSocket'
import { useGameStore } from '@/stores/gameStore'
import { socket } from '@/services/socket'

const route = useRoute()
const { gameStore } = useGameSocket()

const phase = computed(() => gameStore.phase)
const myRole = computed(() => gameStore.myRole)
const players = computed(() => gameStore.players)
const words = computed(() => gameStore.words)
const isMyTurn = computed(() => gameStore.isMyTurn)
const currentPlayerId = computed(() => gameStore.currentPlayerId)
const roomCode = computed(() => route.params.code as string)

const myWord = ref('')
const myVote = ref<string | null>(null)

function sendWord() {
  if (!myWord.value.trim()) return
  socket.emit('submitWord', {
    roomCode: roomCode.value,
    word: myWord.value.trim(),
  })
  myWord.value = ''
}

function submitVote() {
  if (!myVote.value) return
  socket.emit('submitVote', {
    roomCode: roomCode.value,
    targetId: myVote.value,
  })
}

function startWordsRound() {
  socket.emit('startWordsRound', { roomCode: roomCode.value })
}

function startNextRound() {
  socket.emit('startNextRound', { roomCode: roomCode.value })
}
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
</style>
