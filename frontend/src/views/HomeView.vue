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

function createRoom() {
  if (!nameCreate.value.trim()) return
  socket.emit('createRoom', { name: nameCreate.value.trim() })
  socket.once('roomJoined', (payload) => {
    gameStore.setRoomJoined(payload)
    router.push({ name: 'lobby', params: { code: payload.roomCode } })
  })
}

function joinRoom() {
  if (!nameJoin.value.trim() || !roomCodeJoin.value.trim()) return
  socket.emit('joinRoom', {
    name: nameJoin.value.trim(),
    roomCode: roomCodeJoin.value.trim(),
  })
  socket.once('roomJoined', (payload) => {
    gameStore.setRoomJoined(payload)
    router.push({ name: 'lobby', params: { code: payload.roomCode } })
  })
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
</style>
