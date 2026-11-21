<template>
  <main class="page page--home">
    <header class="page__header">
      <div class="hero">
        <img
          class="img-header"
          src="/og-image.jpg"
          alt="Juego del Impostor Online para jugar con amigos"
        />

        <h1 class="page__title">Juego del Impostor Online</h1>

        <p class="page__subtitle">
          Crea una sala nueva o únete a una existente para descubrir quién miente.
        </p>

        <div class="hero-links">
          <RouterLink to="/como-jugar">Cómo jugar</RouterLink>
          <RouterLink to="/reglas">Reglas</RouterLink>
          <RouterLink to="/faq">FAQ</RouterLink>
        </div>
      </div>
    </header>

    <section class="page__content">
      <section v-if="!isInvite" class="card">
        <h2 class="title">Crear sala</h2>

        <div class="field">
          <input id="name-create" v-model="nameCreate" placeholder="Introduce tu nombre" />
        </div>

        <div class="field mode-picker">
          <label class="mode-option" :class="{ 'mode-option--active': createMode === 'classic' }">
            <input type="radio" value="classic" v-model="createMode" />
            <span>Partida completa</span>
          </label>

          <label class="mode-option" :class="{ 'mode-option--active': createMode === 'manual' }">
            <input type="radio" value="manual" v-model="createMode" />
            <span>Solo reparto de roles</span>
          </label>
        </div>

        <button class="btn" @click="createRoom">Crear</button>

        <p class="only-roles-info">
          * Si marcas la opción "Solo reparto de roles" no podrás introducir las palabras ni
          realizar votaciones.
        </p>
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

      <section class="home-links-card">
        <h2>Empieza rápido</h2>

        <div class="home-links-grid">
          <RouterLink to="/jugar-impostor-online" class="home-link-card">
            Jugar al impostor online
          </RouterLink>

          <RouterLink to="/como-jugar" class="home-link-card"> Cómo jugar </RouterLink>

          <RouterLink to="/reglas" class="home-link-card"> Reglas del juego </RouterLink>

          <RouterLink to="/faq" class="home-link-card"> Preguntas frecuentes </RouterLink>
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

      <section class="seo-content seo-content--steps">
        <h2>Cómo funciona</h2>

        <div class="steps-grid">
          <article>
            <h3>1. Crea o únete a una sala</h3>
            <p>Entra con tu nombre y comparte el código con el resto de jugadores.</p>
          </article>

          <article>
            <h3>2. Recibe tu rol</h3>
            <p>Cada jugador recibe un rol secreto y comienza la ronda.</p>
          </article>

          <article>
            <h3>3. Descubre al impostor</h3>
            <p>Hablad, escribid palabras y votad para descubrir quién está mintiendo.</p>
          </article>
        </div>
      </section>
    </section>
  </main>

  <FullScreenLoader v-if="loading" text="Entrando en la sala..." />
</template>

<script setup lang="ts">
import { BACKEND_URL } from '@/services/backendUrl'
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
const createMode = ref<'classic' | 'manual'>('classic')
const nameJoin = ref('')
const roomCodeJoin = ref('')
const errorMessage = ref<string | null>(null)
const loading = ref(false)

const nameJoinInput = ref<HTMLInputElement | null>(null)
const isInvite = ref(false)

useHead({
  title: 'Juego del Impostor Online | Crea una sala y juega con amigos',
  meta: [
    {
      name: 'description',
      content:
        'Juega al Juego del Impostor online gratis con amigos desde móvil o PC. Crea una sala, comparte el código y descubre quién miente.',
    },
    { property: 'og:title', content: 'Juego del Impostor Online' },
    {
      property: 'og:description',
      content:
        'Crea una sala, comparte el código y juega al impostor online con amigos desde el navegador.',
    },
    { property: 'og:type', content: 'website' },
    { property: 'og:url', content: 'https://eljuegodelimpostor.es/' },
    { property: 'og:image', content: 'https://eljuegodelimpostor.es/og-image.jpg' },
  ],
  link: [{ rel: 'canonical', href: 'https://eljuegodelimpostor.es/' }],
})

function createRoom() {
  if (!nameCreate.value.trim()) return

  errorMessage.value = null
  loading.value = true

  socket.emit('createRoom', { name: nameCreate.value.trim(), mode: createMode.value })

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
    const baseUrl = BACKEND_URL

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

.page {
  width: 100%;
  min-height: 100%;
  box-sizing: border-box;
}

.page--home {
  width: 100%;
  max-width: 920px;
  margin: 0 auto;
  padding: 1.5rem 1rem 3rem;
  box-sizing: border-box;
}

.page__header {
  width: 100%;
  margin-bottom: 1.5rem;
}

.page__content {
  width: 100%;
  display: grid;
  gap: 1.25rem;
}

.hero {
  text-align: center;
  width: 100%;
}

.img-header {
  display: block;
  width: 100%;
  max-width: 420px;
  margin: 0 auto;
  height: auto;
}

.page__title {
  margin: 1rem 0 0.5rem;
  font-size: clamp(2rem, 5vw, 3rem);
  line-height: 1.1;
  color: #e5e7eb;
  text-align: center;
}

.page__subtitle {
  max-width: 680px;
  margin: 0 auto;
  color: #9ca3af;
  text-align: center;
  font-size: 1rem;
  line-height: 1.5;
}

.hero-links {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 12px 18px;
  margin-top: 1rem;
}

.hero-links a {
  color: #b4dc51;
  text-decoration: none;
  font-weight: 600;
}

.hero-links a:hover {
  text-decoration: underline;
}

.card,
.home-links-card,
.seo-content {
  width: 100%;
  box-sizing: border-box;
}

.card {
  padding: 1.25rem;
  border-radius: 18px;
  background: rgba(17, 24, 39, 0.72);
  border: 1px solid rgba(148, 163, 184, 0.14);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.14);
}

.title {
  margin: 0 0 1rem;
  color: #d1d5db;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
}

input {
  width: 100%;
  box-sizing: border-box;
  border-radius: 12px;
  border: 1px solid #1f2937;
  background: rgba(26, 41, 77, 0.9);
  color: #b4dc51;
  padding: 12px 14px;
  min-height: 48px;
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
  opacity: 0.9;
}

.btn {
  width: 100%;
  min-height: 48px;
  margin-top: 0.25rem;
  padding: 0.85rem 1rem;
  border: 0;
  border-radius: 12px;
  cursor: pointer;
  font-weight: 700;
  font-size: 1rem;
  background: #22c55e;
  color: white;
}

.btn--secondary {
  background: #1d4ed8;
}

.error-box {
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.1);
  color: #fecaca;
  font-size: 0.85rem;
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

.mode-picker {
  display: grid;
  gap: 10px;
  margin-bottom: 12px;
}

.mode-option {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  box-sizing: border-box;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(17, 24, 39, 0.35);
  color: #9ca3af;
  cursor: pointer;
  user-select: none;

  input {
    min-height: auto;
    width: 16px;
    height: 16px;
    margin: 0;
    padding: 0;
  }
}

.mode-option--active {
  border-color: rgba(180, 220, 81, 0.55);
  background: rgba(180, 220, 81, 0.08);
  color: #b4dc51;
}

.only-roles-info {
  margin-top: 1rem;
  color: #b4dc51;
  line-height: 1.45;
}

.home-links-card {
  padding: 1.25rem;
  border-radius: 16px;
  background: rgba(17, 24, 39, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.12);
  text-align: center;
}

.home-links-card h2 {
  margin-top: 0;
  margin-bottom: 1rem;
  color: #e5e7eb;
}

.home-links-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.home-link-card {
  display: block;
  padding: 12px;
  border-radius: 10px;
  text-decoration: none;
  color: #b4dc51;
  background: rgba(180, 220, 81, 0.08);
  border: 1px solid rgba(180, 220, 81, 0.18);
  font-weight: 600;
}

.seo-content {
  padding: 1.25rem 1.5rem;
  border-radius: 16px;
  background: rgba(17, 24, 39, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.12);
  text-align: center;
}

.seo-content h2 {
  margin: 0 0 0.75rem;
  font-size: 1.1rem;
  font-weight: 600;
  color: #e5e7eb;
}

.seo-content p {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.6;
  color: #9ca3af;
}

.seo-content--steps {
  text-align: left;
}

.steps-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.steps-grid article {
  padding: 0.25rem;
}

.steps-grid article h3 {
  margin: 0 0 0.5rem;
  color: #e5e7eb;
  font-size: 1rem;
}

.steps-grid article p {
  color: #9ca3af;
  font-size: 0.92rem;
  line-height: 1.5;
}

@media (max-width: 768px) {
  .page--home {
    padding: 1rem 0.875rem 2.5rem;
  }

  .img-header {
    max-width: 320px;
  }

  .page__title {
    margin-top: 0.85rem;
    font-size: 2rem;
  }

  .page__subtitle {
    font-size: 0.95rem;
  }

  .home-links-grid,
  .steps-grid {
    grid-template-columns: 1fr;
  }

  .card,
  .home-links-card,
  .seo-content {
    padding: 1rem;
  }
}
</style>
