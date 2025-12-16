<template>
  <main class="page page--home">
    <header class="page__header">
      <div>
        <img class="img-header" src="/og-image.jpg" />
        <p class="page__subtitle">Crea una sala nueva o únete a una existente.</p>
      </div>
    </header>

    <section class="page__content">
      <!-- Crear sala -->
      <section v-if="!isInvite" class="card">
        <h2>Crear sala</h2>

        <div class="field">
          <input id="name-create" v-model="nameCreate" placeholder="Introduce tu nombre" />
        </div>

        <button class="btn" @click="createRoom">Crear</button>
      </section>

      <!-- Unirse a sala -->
      <section class="card">
        <p v-if="isInvite" class="invite-hint">Te han invitado a una sala 🎉</p>
        <h2>Unirse a sala</h2>

        <div class="field">
          <input
            id="name-join"
            ref="nameJoinInput"
            v-model="nameJoin"
            placeholder="Introduce tu nombre"
          />
        </div>

        <div class="field">
          <input
            id="room-code-join"
            v-model="roomCodeJoin"
            placeholder="Código de sala"
            :readonly="isInvite"
            :class="{ 'input--readonly': isInvite }"
          />
        </div>

        <button class="btn btn--secondary" @click="joinRoom">Unirse</button>

        <div v-if="errorMessage" class="error-box">
          {{ errorMessage }}
        </div>
      </section>
    </section>
  </main>
  <FullScreenLoader v-if="loading" text="Entrando en la sala..." />
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { socket } from '@/services/socket'
import { useGameStore } from '@/stores/gameStore'
import FullScreenLoader from '@/components/ui/FullScreenLoader.vue'

const router = useRouter()
const gameStore = useGameStore()
const route = useRoute()

const nameCreate = ref('')
const nameJoin = ref('')
const roomCodeJoin = ref('')
const errorMessage = ref<string | null>(null)
const loading = ref(false)

const nameJoinInput = ref<HTMLInputElement | null>(null)
const isInvite = ref(false)

function createRoom() {
  if (!nameCreate.value.trim()) return

  errorMessage.value = null
  loading.value = true

  socket.emit('createRoom', { name: nameCreate.value.trim() })
  socket.once('roomJoined', (payload) => {
    gameStore.setRoomJoined(payload)
    router.push({ name: 'lobby', params: { code: payload.roomCode } })
  })
}

async function joinRoom() {
  errorMessage.value = null

  if (!nameJoin.value || !roomCodeJoin.value) {
    errorMessage.value = 'Debes introducir tu nombre y un código de sala.'
    return
  }

  try {
    const code = roomCodeJoin.value.toUpperCase()
    const baseUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000'

    const res = await fetch(`${baseUrl}/rooms/${code}`)

    if (!res.ok) {
      if (res.status === 404) {
        errorMessage.value = 'La sala no existe. Revisa el código.'
      } else {
        errorMessage.value = 'Error conectando con el servidor.'
      }
      loading.value = false
      return
    }

    const data = await res.json()

    if (!data.exists) {
      errorMessage.value = 'La sala no existe. Revisa el código.'
      loading.value = false
      return
    }

    socket.emit('joinRoom', {
      roomCode: code,
      name: nameJoin.value.trim(),
    })

    socket.once('roomJoined', (payload) => {
      gameStore.setRoomJoined(payload)
      router.push({ name: 'lobby', params: { code: payload.roomCode } })
    })
  } catch (err) {
    console.error(err)
    errorMessage.value = 'Error conectando con el servidor.'
    loading.value = false
  }
}

onMounted(async () => {
  const joinCode = route.query.join as string | undefined
  if (joinCode) {
    isInvite.value = true

    roomCodeJoin.value = joinCode.toUpperCase()

    router.replace({ name: 'home', query: {} })

    await nextTick()
    nameJoinInput.value?.focus()
  }
})
</script>
<style scoped lang="scss">
@use '@/assets/styles/fonts';

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
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
  font-family:
    'Bitcount Prop Single',
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
}

input::placeholder {
  color: #6b7280;
}

.error-box {
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.1);
  color: #fecaca;
  font-size: 0.85rem;
}
.img-header {
  width: 75%;
}
.invite-hint {
  margin-bottom: 0.5rem;
  font-size: 0.85rem;
  color: #9ca3af;
  text-align: center;
}

.input--readonly {
  opacity: 0.7;
  cursor: not-allowed;
}
</style>
