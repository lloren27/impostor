<template>
  <main class="home">
    <h1>Juego del Impostor</h1>

    <section class="card">
      <h2>Crear sala</h2>
      <input v-model="nameCreate" placeholder="Tu nombre" />
      <button @click="createRoom">Crear</button>
    </section>

    <section class="card">
      <h2>Unirse a sala</h2>
      <input v-model="nameJoin" placeholder="Tu nombre" />
      <input v-model="roomCodeJoin" placeholder="Código de sala" />
      <button @click="joinRoom">Unirse</button>
      <div v-if="errorMessage" class="error-box">
        {{ errorMessage }}
      </div>
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
.home {
  max-width: 600px;
  margin: 2rem auto;
  display: flex;
  flex-direction: column;
  gap: 2rem;
}
.card {
  padding: 1.5rem;
  border-radius: 8px;
  border: 1px solid #ccc;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
input {
  padding: 0.5rem;
}
button {
  padding: 0.5rem;
  cursor: pointer;
}
.error-box {
  margin-top: 10px;
  padding: 10px;
  background: #ffdddd;
  border: 1px solid #cc0000;
  color: #660000;
  border-radius: 4px;
}
</style>
