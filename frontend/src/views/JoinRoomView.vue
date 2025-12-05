<template>
  <main class="page page--join">
    <div class="page__content">
      <h1>Te han invitado a una sala</h1>
      <h1 class="page__title">
        Sala:
        {{ roomCode }}
      </h1>
      <section class="card">
        <div class="field">
          <input id="name-join" v-model="nameJoin" type="text" placeholder="Introduce tu nombre" />
        </div>

        <div v-if="errorMessage" class="error-box">
          {{ errorMessage }}
        </div>
      </section>

      <button class="btn" :disabled="loading" @click="joinRoom">Entrar a la sala</button>

      <p class="hint">
        Si el código no es válido o la sala no existe, recibirás un mensaje de error.
      </p>
    </div>

    <FullScreenLoader v-if="loading" text="Entrando en la sala..." />
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import router from '@/router'
import { useGameSocket } from '@/composables/useGameSocket'
import FullScreenLoader from '@/components/ui/FullScreenLoader.vue'

const route = useRoute()
const { socket, onRoomJoined, onError } = useGameSocket()

const roomCode = route.params.roomCode as string
const nameJoin = ref('')
const loading = ref(false)
const errorMessage = ref<string | null>(null)

onRoomJoined((payload) => {
  loading.value = false
  router.push({ name: 'lobby', params: { code: payload.roomCode } })
})

onError(() => {
  loading.value = false
})

const joinRoom = () => {
  errorMessage.value = null

  if (!nameJoin.value.trim()) {
    errorMessage.value = 'Debes introducir tu nombre'
    return
  }

  loading.value = true

  socket.emit('joinRoom', {
    roomCode,
    name: nameJoin.value.trim(),
  })
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
.hint {
  margin-top: 0.75rem;
  font-size: 0.8rem;
  color: #666;
}
</style>
