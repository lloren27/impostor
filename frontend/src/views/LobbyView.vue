<template>
  <main class="page page--lobby">
    <header class="page__header">
      <div>
        <h1 class="page__title">Sala {{ roomCode }}</h1>
        <p class="page__subtitle">Comparte el código con tus amigos para que se unan.</p>
      </div>
    </header>

    <section class="page__content">
      <section class="card">
        <h2>Jugadores</h2>

        <ul class="list">
          <li v-for="p in players" :key="p.id" class="list__item">
            <span>{{ p.name }}</span>
            <span v-if="p.isHost" class="badge">Anfitrión</span>
          </li>
        </ul>
      </section>
    </section>

    <footer class="page__footer">
      <button v-if="isHost" class="btn" @click="startGame">Empezar partida</button>
    </footer>
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

<style scoped></style>
