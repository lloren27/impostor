<template>
  <main class="page page--home">
    <header class="page__header">
      <div>
        <h1 class="page__title">Juego del Impostor</h1>
        <p class="page__subtitle">Crea una sala nueva o únete a una existente.</p>
      </div>
    </header>

    <section class="page__content">
      <!-- Crear sala -->
      <section class="card">
        <h2>Crear sala</h2>

        <div class="field">
          <label for="name-create">Tu nombre</label>
          <input id="name-create" v-model="nameCreate" placeholder="Tu nombre" />
        </div>

        <button class="btn" @click="createRoom">Crear</button>
      </section>

      <!-- Unirse a sala -->
      <section class="card">
        <h2>Unirse a sala</h2>

        <div class="field">
          <label for="name-join">Tu nombre</label>
          <input id="name-join" v-model="nameJoin" placeholder="Tu nombre" />
        </div>

        <div class="field">
          <label for="room-code-join">Código de sala</label>
          <input id="room-code-join" v-model="roomCodeJoin" placeholder="Código de sala" />
        </div>

        <button class="btn btn--secondary" @click="joinRoom">Unirse</button>

        <div v-if="errorMessage" class="error-box">
          {{ errorMessage }}
        </div>
      </section>
    </section>
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { socket } from '@/services/socket'
import { useGameStore } from '@/stores/gameStore'

const router = useRouter()
const gameStore = useGameStore()

const nameCreate = ref('')
const nameJoin = ref('')
const roomCodeJoin = ref('')
const errorMessage = ref<string | null>(null)

function createRoom() {
  if (!nameCreate.value.trim()) return
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

    // 1. Comprobamos si la sala existe
    const res = await fetch(`${baseUrl}/rooms/${code}`)

    // Si el backend responde 404, lo tratamos aquí
    if (!res.ok) {
      if (res.status === 404) {
        errorMessage.value = 'La sala no existe. Revisa el código.'
        return
      }
      throw new Error(`HTTP ${res.status}`)
    }

    const data = await res.json()

    if (!data.exists) {
      errorMessage.value = 'La sala no existe. Revisa el código.'
      return
    }

    // 2. Conectarse por socket.io
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
  }
}
</script>
<style scoped>
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
</style>
