<template>
  <main class="page page--game">
    <header class="page__header">
      <div>
        <h1 class="page__title">Sala {{ roomCode }}</h1>
        <p class="page__subtitle">
          <template v-if="isManual">Modo: Manual (solo roles)</template>
          <template v-else>Fase: {{ $t(`phases.${gameStore.phase}`) }}</template>
        </p>
        <div class="players-strip">
          <span
            v-for="p in players"
            :key="p.id"
            class="players-strip__item"
            :class="{ 'players-strip__item--me': me?.id === p.id }"
            :title="p.connected ? 'Conectado' : 'Desconectado'"
          >
            <span class="dot" :class="{ 'dot--on': p.connected, 'dot--off': !p.connected }"></span>
            <span class="name" :class="{ death: !p.alive, alive: p.alive }">{{ p.name }}</span>
          </span>
        </div>
      </div>
      <div v-if="roundStarterName && phase === 'words'" class="round-indicator">
        Empieza: <strong>{{ roundStarterName }}</strong>
      </div>
    </header>

    <section class="page__content">
      <section v-if="phase === 'reveal'" class="card card--with-avatar">
        <RoleAvatar
          :revealed="roleRevealed"
          :playReveal="playReveal"
          :isImpostor="!!myRole?.isImpostor"
          :character="myRole?.character ?? null"
        />
        <h2 class="card-title">Tu rol</h2>
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

        <template v-if="gameStore.isHost">
          <button v-if="!isManual" class="btn" @click="startWordsRound">
            Empezar ronda de palabras
          </button>
          <div v-else class="manual-actions">
            <p class="info-text">
              Modo manual: la app solo reparte roles. Podéis jugar fuera y repartir de nuevo cuando
              queráis.
            </p>

            <button class="btn" @click="restartGame">Repartir roles de nuevo</button>
            <button class="btn btn--secondary" @click="finishGame">Finalizar sala</button>
          </div>
        </template>

        <p v-else-if="isManual" class="info-text">
          Modo manual. Espera a que el anfitrión reparta roles de nuevo o finalice la sala.
        </p>
      </section>
      <section v-else-if="phase === 'words'" class="card card--with-avatar">
        <RoleAvatar
          :revealed="roleRevealed"
          :playReveal="playReveal"
          :isImpostor="!!myRole?.isImpostor"
          :character="myRole?.character ?? null"
        />
        <p class="page__subtitle">
          En esta ronda empieza hablando
          <strong>{{ roundStarterName }}</strong
          >.
        </p>
        <template v-if="myRole?.character">
          <h2>Personaje {{ myRole.character }}</h2>
        </template>
        <template v-else>
          <h2 style="text-align: center" class="impostor-style">IMPOSTOR</h2>
        </template>
        <h2>Ronda de palabras (ronda {{ gameStore.currentRound }})</h2>

        <h3>Listado de palabras:</h3>
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
      <section v-else-if="gameStore.phase === 'voting' && me?.alive" class="card card--with-avatar">
        <RoleAvatar
          :revealed="roleRevealed"
          :playReveal="playReveal"
          :isImpostor="!!myRole?.isImpostor"
          :character="myRole?.character ?? null"
        />
        <h2 class="voting-title">Votación</h2>

        <h3>Listado de palabras</h3>
        <ul class="list">
          <li v-for="w in words" :key="w.playerId + w.word" class="list__item">
            <span> {{ players.find((p) => p.id === w.playerId)?.name || '??' }}: </span>
            <span>{{ w.word }}</span>
          </li>
        </ul>

        <p>¿Quién crees que es el impostor?</p>

        <!-- 🔸 Mensaje de EMPATE -->
        <p v-if="isTieVoting" class="info-text info-text--warning">
          Ha habido un empate. Volved a votar entre estos jugadores.
        </p>

        <!-- 🔸 Mensaje de que ya has votado y a quién -->
        <p v-if="gameStore.hasVoted" class="info-text">
          Ya has votado
          <template v-if="selectedPlayerName">
            : has elegido a <strong>{{ selectedPlayerName }}</strong
            >.
          </template>
          Espera a que termine la votación.
        </p>

        <ul v-if="me?.alive" class="list-vote">
          <li v-for="p in voteTargets" :key="p.id" class="list__item">
            <label
              class="vote-option"
              :class="{
                'vote-option--selected': gameStore.myVote === p.id,
                'vote-option--disabled': gameStore.hasVoted,
              }"
            >
              <input
                class="vote-option__input"
                type="radio"
                name="vote"
                :value="p.id"
                v-model="gameStore.myVote"
                :disabled="gameStore.hasVoted"
              />

              <span class="vote-option__dot" aria-hidden="true"></span>
              <span class="vote-option__name">{{ p.name }}</span>
            </label>
          </li>
        </ul>

        <button
          v-if="me?.alive"
          class="btn"
          @click="submitVote"
          :disabled="gameStore.hasVoted || !gameStore.myVote"
        >
          Votar
        </button>
      </section>
      <section v-else-if="gameStore.phase === 'voting' && !me?.alive" class="card">
        <h2>Votación</h2>
        <p>Estás eliminado. Espera a que el resto vote…</p>
      </section>
      <section
        v-else-if="phase === 'revealRound' || phase === 'finished'"
        class="card card--with-avatar"
      >
        <RoleAvatar
          :revealed="roleRevealed"
          :playReveal="playReveal"
          :isImpostor="!!myRole?.isImpostor"
          :character="myRole?.character ?? null"
        />
        <h2 class="round-result">Resultado de la ronda</h2>

        <div v-if="gameStore.lastRoundResult">
          <p v-if="gameStore.lastRoundResult.eliminatedPlayer">
            Expulsado:
            <strong>{{ gameStore.lastRoundResult.eliminatedPlayer.name }}</strong>
            <span v-if="gameStore.lastRoundResult.wasImpostor"> (ERA el impostor) </span>
            <span v-else> (NO era el impostor) </span>
          </p>

          <div class="resolution" v-if="gameStore.lastRoundResult.winner">
            <strong>
              {{
                gameStore.lastRoundResult.winner === 'players'
                  ? 'Ganadores: Los jugadores'
                  : 'Ganador: El impostor'
              }}
            </strong>
          </div>
        </div>

        <div v-if="phase === 'finished'" class="buttons-finished">
          <p class="finished-phrase">La partida ha terminado.</p>

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
  <FullScreenLoader
    v-if="gameStore.isReconnecting || isPhaseChanging || isSubmittingVote"
    :text="
      gameStore.isReconnecting
        ? 'Reconectando con la sala...'
        : isSubmittingVote
          ? 'Enviando voto...'
          : 'Cargando siguiente fase...'
    "
  />
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useGameSocket } from '@/composables/useGameSocket'
import FullScreenLoader from '@/components/ui/FullScreenLoader.vue'
import RoleAvatar from '@/components/ui/RoleAvatar.vue'
import { useHead } from '@unhead/vue'

useHead({
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
})

const { socket, gameStore, onTieVote, onError, onGameStarted } = useGameSocket()
const roomCode = computed(() => gameStore.roomCode)
const phase = computed(() => gameStore.phase)
const myRole = computed(() => gameStore.myRole)
const players = computed(() => gameStore.players)
const words = computed(() => gameStore.words)
const isMyTurn = computed(() => gameStore.isMyTurn)
const currentPlayerId = computed(() => gameStore.currentPlayerId)
const roundStarterName = computed(() => gameStore.roundStarterName)
const me = computed(() => gameStore.mePlayer)
const isManual = computed(() => gameStore.mode === 'manual')

const isPhaseChanging = ref(false)
const isSubmittingVote = ref(false)
const roleRevealed = ref(false)
const playReveal = ref(false)

const myWord = ref('')

const voteTargets = computed(() => {
  const me = gameStore.mePlayer
  const base = gameStore.players.filter((p) => p.alive && (!me || p.id !== me.id))

  const tc: any[] | null = gameStore.tieCandidates as any
  if (tc && tc.length > 0) {
    const ids = tc.map((x) => (typeof x === 'string' ? x : x.id))
    return base.filter((p) => ids.includes(p.id))
  }

  return base
})

const selectedPlayerName = computed(() => {
  if (!gameStore.myVote) return null
  const p = gameStore.players.find((p) => p.id === gameStore.myVote)
  return p ? p.name : null
})

const isTieVoting = computed(() => !!gameStore.tieCandidates && gameStore.tieCandidates.length > 0)

function sendWord() {
  if (!myWord.value.trim()) return
  if (!gameStore.mePlayer || !gameStore.roomCode) return

  socket.emit('submitWord', {
    roomCode: gameStore.roomCode,
    playerId: gameStore.mePlayer.id,
    word: myWord.value.trim(),
  })
  myWord.value = ''
}

function submitVote() {
  if (gameStore.hasVoted) return
  if (!gameStore.myVote) return
  if (!gameStore.mePlayer || !gameStore.roomCode) return

  isSubmittingVote.value = true

  socket.emit('submitVote', {
    roomCode: gameStore.roomCode,
    voterId: gameStore.mePlayer.id,
    targetId: gameStore.myVote,
  })

  gameStore.markAsVoted()
}

function startWordsRound() {
  isPhaseChanging.value = true
  socket.emit('startWordsRound', { roomCode: roomCode.value })
}

function startNextRound() {
  isPhaseChanging.value = true
  socket.emit('startNextRound', { roomCode: roomCode.value })
}

function restartGame() {
  isPhaseChanging.value = true
  socket.emit('restartGame', { roomCode: roomCode.value })
}

function finishGame() {
  isPhaseChanging.value = true
  socket.emit('endGame', { roomCode: roomCode.value })
}

onMounted(() => {
  onGameStarted(() => {
    isSubmittingVote.value = false
    isPhaseChanging.value = false
  })

  onTieVote(() => {
    isSubmittingVote.value = false
    isPhaseChanging.value = false
  })

  onError(() => {
    isSubmittingVote.value = false
    isPhaseChanging.value = false
  })
})

watch(phase, (newPhase, oldPhase) => {
  if (oldPhase && newPhase !== oldPhase) {
    isPhaseChanging.value = false
    isSubmittingVote.value = false
  }
})

watch(
  () => gameStore.lastRoundResult,
  (val) => {
    if (val) {
      isSubmittingVote.value = false
      isPhaseChanging.value = false
    }
  },
)

watch(
  phase,
  (newPhase, oldPhase) => {
    if (newPhase === 'reveal' && oldPhase !== 'reveal') {
      roleRevealed.value = true
      playReveal.value = true
      window.setTimeout(() => (playReveal.value = false), 850)
    }

    if (oldPhase && newPhase !== oldPhase) {
      isPhaseChanging.value = false
      isSubmittingVote.value = false
    }
  },
  { immediate: true },
)
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
  background: rgba(26, 41, 77, 0.9);
  color: #b4dc51;
  padding: 10px 12px;
  min-height: 44px;
  font-size: 1rem;
  font-family:
    'Bitcount Prop Single',
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
}

input::placeholder {
  color: #b4dc51;
}

.vote-option {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #b4dc51;
}

.info-text {
  font-size: 0.85rem;
  color: #9ca3af;
  margin-bottom: 8px;
  &--warning {
    color: #b45200;
    background: #fff3e0;
    padding: 0.5rem 0.75rem;
    border-radius: 4px;
    margin-bottom: 0.75rem;
    font-size: 0.9rem;
  }
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
.card-title {
  text-align: center;
}
.round-result {
  text-align: center;
}
.finished-phrase {
  text-align: center;
}
.card--with-avatar {
  position: relative;
  padding-right: 110px;
}

.card--with-avatar :deep(.portrait) {
  position: absolute;
  top: 12px;
  right: 12px;
}

.players-strip {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}

.players-strip__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.35);
  font-size: 0.85rem;
}

.players-strip__item--me {
  outline: 1px solid rgba(255, 255, 255, 0.25);
}

.dot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  display: inline-block;
  background: #d9534f;
}

.dot--on {
  background: #2ecc71;
}

.dot--off {
  background: #d9534f;
}

.name {
  opacity: 0.95;
}

.resolution {
  background-color: #2ecc71;
  color: #f9fafb;
  text-align: center;
  font-size: 25px;
}
.list-vote {
  margin-bottom: 30px;
}

.voting-title {
  color: #6b7280;
}

.list__item {
  list-style: none;
  background: rgba(20, 33, 64, 0.55);
  color: #c9ff6b;
}

.vote-option {
  display: flex;
  align-items: center;
  gap: 16px;

  width: 100%;
  padding: 18px 22px;
  border-radius: 16px;

  background: rgba(20, 33, 64, 0.55);
  color: #c9ff6b; /* tu verde */
  cursor: pointer;
  user-select: none;

  transition:
    background 0.15s ease,
    color 0.15s ease,
    transform 0.05s ease;
}

.vote-option:active {
  transform: scale(0.995);
}

/* Oculta el radio nativo pero lo deja accesible */
.vote-option__input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.vote-option__dot {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.75);
  display: inline-block;
  position: relative;
}

.vote-option__input:checked + .vote-option__dot::after {
  content: '';
  position: absolute;
  inset: 4px;
  border-radius: 50%;
  background: #3b82f6; /* azul selección (ajústalo a tu theme) */
}

.vote-option--selected {
  background: #c9ff6b;
  color: #0b1220;
}

.vote-option--selected .vote-option__dot {
  border-color: rgba(11, 18, 32, 0.65);
}

.vote-option--disabled {
  cursor: not-allowed;
  opacity: 0.85;
}

.death {
  text-decoration: line-through;
  color: red;
}

.alive {
  color: #c9ff6b;
}

.manual-actions {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
</style>
