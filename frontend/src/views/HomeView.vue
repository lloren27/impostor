<template>
  <main class="page page--home">
    <header class="page__header">
      <div>
        <img class="img-header" src="/og-image.jpg" />
        <p class="page__subtitle">Crea una sala nueva o únete a una existente.</p>
      </div>
    </header>

    <section class="page__content">
      <section v-if="!isInvite" class="card">
        <h2 class="title">Crear sala</h2>

        <div class="field">
          <input id="name-create" v-model="nameCreate" placeholder="Introduce tu nombre" />
        </div>

        <button class="btn" @click="createRoom">Crear</button>
      </section>
      <section class="card">
        <p v-if="isInvite" class="invite-hint">Te han invitado a una sala 🎉</p>
        <h2 class="title">Unirse a sala</h2>

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

      <section class="seo-content">
        <h2>Juego online para descubrir quién miente</h2>
        <p>
          El Juego del Impostor es un juego social online para jugar con amigos desde el navegador.
          Crea una sala, comparte el código y empieza una partida en segundos, sin registro ni
          descargas.
        </p>
      </section>
    </section>
  </main>
  <FullScreenLoader v-if="loading" text="Entrando en la sala..." />
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { useHead } from '@unhead/vue'
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

useHead({
  title: 'El Juego del Impostor – Juego online para descubrir quién miente',
  meta: [
    {
      name: 'description',
      content:
        'Juego social online para jugar con amigos. Crea una sala o únete con un código. Descubre quién es el impostor.',
    },
    { property: 'og:title', content: 'El Juego del Impostor' },
    {
      property: 'og:description',
      content: 'Crea una sala y descubre quién miente en este juego online con amigos.',
    },
    { property: 'og:type', content: 'website' },
    { property: 'og:url', content: 'https://eljuegodelimpostor.es/' },
    { property: 'og:image', content: 'https://eljuegodelimpostor.es/og-image.jpg' },
  ],
})

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

    const saved = localStorage.getItem('impostor-session')
    let playerToken: string | undefined

    if (saved) {
      try {
        const s = JSON.parse(saved)
        if (s?.roomCode?.toUpperCase() === code && s?.playerToken) {
          playerToken = s.playerToken
        }
      } catch {}
    }

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
      playerToken,
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
.title {
  color: #9ca3af;
}

.seo-content {
  margin-top: 2.5rem;
  padding: 1.25rem 1.5rem;
  border-radius: 12px;

  background: rgba(17, 24, 39, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.12);

  max-width: 720px;
  margin-left: auto;
  margin-right: auto;

  text-align: center;
}

.seo-content h2 {
  margin: 0 0 0.75rem 0;
  font-size: 1.05rem;
  font-weight: 600;
  color: #e5e7eb;
}

.seo-content p {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.5;
  color: #9ca3af;
}
</style>
