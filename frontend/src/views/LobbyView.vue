<template>
  <main class="lobby">
    <h1>Sala {{ roomCode }}</h1>

    <h2>Jugadores</h2>
    <ul>
      <li v-for="p in players" :key="p.id">{{ p.name }} <span v-if="p.isHost">👑</span></li>
    </ul>

    <div class="actions">
      <button v-if="isHost" @click="startGame">Empezar partida</button>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGameSocket } from '@/composables/useGameSocket'
import { socket } from '@/services/socket'

const route = useRoute()
const router = useRouter()
const { gameStore } = useGameSocket()

const roomCode = computed(() => route.params.code as string)

const players = computed(() => gameStore.players)
const isHost = computed(() => gameStore.isHost)

function startGame() {
  if (!roomCode.value) return
  socket.emit('startGame', { roomCode: roomCode.value })
}
</script>

<style scoped>
.lobby {
  max-width: 600px;
  margin: 2rem auto;
}
.actions {
  margin-top: 1.5rem;
  display: flex;
  gap: 1rem;
}
</style>
