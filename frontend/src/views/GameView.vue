<template>
  <main class="page page--game">
    <header class="page__header">
      <div>
        <h1 class="page__title">Sala {{ roomCode }}</h1>
        <p class="page__subtitle">Fase: {{ $t(`phases.${gameStore.phase}`) }}</p>
      </div>
      <div v-if="roundStarterName && phase === 'words'" class="round-indicator">
        Empieza: <strong>{{ roundStarterName }}</strong>
      </div>
    </header>

    <section class="page__content">
      <section v-if="phase === 'reveal'" class="card">
        <h2>Tu rol</h2>
        <p v-if="myRole">
          <template v-if="myRole.isImpostor">
            <span>Eres el</span>
            <span class="impostor-style">IMPOSTOR</span>
            <span>. No sabes el personaje, intenta camuflarte.</span>
          </template>
          <template v-else>
            Tu personaje es: <strong>{{ myRole.character }}</strong>
          </template>
        </p>

        <button v-if="gameStore.isHost" class="btn" @click="startWordsRound">
          Empezar ronda de palabras
        </button>
      </section>
      <section v-else-if="phase === 'words'" class="card">
        <p class="page__subtitle">
          En esta ronda empieza hablando
          <strong>{{ roundStarterName }}</strong
          >.
        </p>
        <h2 v-if="myRole?.character">Personaje {{ myRole.character }}</h2>
        <h2>Ronda de palabras (ronda {{ gameStore.currentRound }})</h2>

        <h3>Palabras dichas</h3>
        <ul class="list">
          <li v-for="w in words" :key="w.playerId + w.word" class="list__item">
            <span> {{ players.find((p) => p.id === w.playerId)?.name || '??' }}: </span>
            <span>{{ w.word }}</span>
          </li>
        </ul>

        <div v-if="isMyTurn" class="word-input">
          <p>Es tu turno. Escribe una palabra relacionada con el personaje.</p>
          <input v-model="myWord" placeholder="Tu palabra" />
          <button class="btn" @click="sendWord">Enviar</button>
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
      <section v-else-if="gameStore.phase === 'voting'" class="card">
        <h2>Votación</h2>
        <p>¿Quién crees que es el impostor?</p>

        <p v-if="gameStore.hasVoted" class="info-text">
          Ya has votado. Espera a que termine la votación.
        </p>

        <ul class="list">
          <li
            v-for="p in gameStore.players.filter((p) => p.alive && p.id !== gameStore.me?.id)"
            :key="p.id"
            class="list__item"
          >
            <label class="vote-option">
              <input
                type="radio"
                name="vote"
                :value="p.id"
                v-model="gameStore.myVote"
                :disabled="gameStore.hasVoted"
              />
              <span>{{ p.name }}</span>
            </label>
          </li>
        </ul>

        <button class="btn" @click="submitVote" :disabled="gameStore.hasVoted || !gameStore.myVote">
          Votar
        </button>
      </section>

      <!-- FASE REVEALROUND / FIN: resultado ronda o final -->
      <section v-else-if="phase === 'revealRound' || phase === 'finished'" class="card">
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

        <div v-if="phase === 'finished'" class="buttons-finished">
          <p>La partida ha terminado.</p>

          <div class="buttons-finished__actions">
            <button v-if="gameStore.isHost" class="btn" @click="restartGame">
              Reiniciar partida
            </button>
            <button v-if="gameStore.isHost" class="btn btn--secondary" @click="finishGame">
              Finalizar partida
            </button>
            <p v-else>Esperando a que el anfitrión decida reiniciar o finalizar la partida...</p>
          </div>
        </div>

        <div v-else class="buttons-finished">
          <button class="btn" @click="startNextRound">Siguiente ronda</button>
        </div>
      </section>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGameSocket } from '@/composables/useGameSocket'

const { socket, gameStore } = useGameSocket()
const roomCode = computed(() => gameStore.roomCode)
const phase = computed(() => gameStore.phase)
const myRole = computed(() => gameStore.myRole)
const players = computed(() => gameStore.players)
const words = computed(() => gameStore.words)
const isMyTurn = computed(() => gameStore.isMyTurn)
const currentPlayerId = computed(() => gameStore.currentPlayerId)
const roundStarterName = computed(() => gameStore.roundStarterName)

const myWord = ref('')

function sendWord() {
  if (!myWord.value.trim()) return
  socket.emit('submitWord', {
    roomCode: gameStore.roomCode,
    word: myWord.value.trim(),
  })
  myWord.value = ''
}

function submitVote() {
  if (gameStore.hasVoted) return
  if (!gameStore.myVote) return
  if (!gameStore.me || !gameStore.roomCode) return

  socket.emit('submitVote', {
    roomCode: gameStore.roomCode,
    targetId: gameStore.myVote,
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
</script>

<style scoped>
.word-input {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

input {
  padding: 10px;
  border-radius: 8px;
  border: 1px solid #1f2937;
  background: rgba(15, 23, 42, 0.9);
  color: #f9fafb;
  padding: 10px 12px;
  min-height: 44px;
  font-size: 1rem;
}

input::placeholder {
  color: #6b7280;
}

.vote-option {
  display: flex;
  align-items: center;
  gap: 8px;
}

.info-text {
  font-size: 0.85rem;
  color: #9ca3af;
  margin-bottom: 8px;
}

.buttons-finished {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.buttons-finished__actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.impostor-style {
  display: inline-block;
  padding: 4px 8px;
  border-radius: 999px;
  background: #000;
  color: #f97373;
  font-weight: 700;
  margin: 0 4px;
}
</style>
