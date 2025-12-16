<template>
  <main class="page page--lobby">
    <header class="page__header">
      <div>
        <div class="roomCode-container">
          <h1 class="page__title">Sala {{ roomCode }}</h1>
          <button class="btn-copy" @click="copyRoomCode">
            <font-awesome-icon :icon="['far', 'clipboard']" />
          </button>
        </div>

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
      <button v-if="isHost" class="btn btn--secondary" @click="startGame">Empezar partida</button>
      <button v-if="isHost" class="btn" @click="copyInviteLink">Copiar enlace</button>
      <button v-if="isHost" class="btn" @click="shareByWhatsApp">Compartir por WhatsApp</button>
    </footer>
  </main>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useGameSocket } from '@/composables/useGameSocket'

import { useUiStore } from '@/stores/uiStore'

const route = useRoute()
const { socket, gameStore } = useGameSocket()
const uiStore = useUiStore()

const roomCode = computed(() => route.params.code as string)

const players = computed(() => gameStore.players)
const isHost = computed(() => gameStore.isHost)

function startGame() {
  if (!roomCode.value) return
  socket.emit('startGame', { roomCode: roomCode.value })
}

const inviteLink = computed(() => {
  if (!gameStore.roomCode) return ''
  return `${window.location.origin}/?join=${gameStore.roomCode}`
})

const copyInviteLink = async () => {
  if (!inviteLink.value) return
  try {
    await navigator.clipboard.writeText(inviteLink.value)
    uiStore.showInfo('Enlace copiado al portapapeles', 'Invitación')
  } catch (err) {
    console.error(err)
    // Fallback si el navegador no soporta clipboard
    prompt('Copia este enlace:', inviteLink.value)
  }
}

function copyRoomCode() {
  if (navigator.clipboard && gameStore.roomCode) {
    navigator.clipboard.writeText(gameStore.roomCode)
    uiStore.showInfo('Código copiado al portapapeles', 'Código de sala')
  }
}

const shareByWhatsApp = () => {
  if (!inviteLink.value) return

  const message = `Únete a mi partida de Impostor con este enlace: ${inviteLink.value}`
  const encoded = encodeURIComponent(message)

  const url = `https://wa.me/?text=${encoded}`

  window.open(url, '_blank')
}
</script>

<style scoped>
.share-box {
  margin-bottom: 1rem;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  background: #f5f5f5;
  font-size: 0.9rem;

  .share-link {
    margin: 0.5rem 0;
    padding: 0.5rem;
    background: white;
    border-radius: 4px;
    font-family: monospace;
    word-break: break-all;
  }

  .share-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
}

.roomCode-container {
  display: flex;
  justify-content: center;
}

.btn-copy {
  background: transparent;
  border: none;
  font-size: 1.2rem;
  cursor: pointer;
  color: white;

  &:hover {
    color: cadetblue;
  }
}
</style>
