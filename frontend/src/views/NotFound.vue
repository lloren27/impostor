<template>
  <main class="page page--error">
    <h1>404</h1>
    <p>Ups... Esta página es un impostor 👀</p>

    <button class="btn" @click="goHome">Volver al inicio</button>
  </main>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
const router = useRouter()
const route = useRoute()

function goHome() {
  router.push('/')
}

onMounted(() => {
  const m = route.path.match(/^\/join\/([A-Za-z0-9]+)$/)
  if (m) {
    router.replace({ name: 'home', query: { join: m[1].toUpperCase() } })
  }
})
</script>

<style scoped>
.page--error {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 1rem;
  text-align: center;
}

h1 {
  font-size: 5rem;
  margin: 0;
  color: #ff4f4f;
}

p {
  font-size: 1.2rem;
  color: #aaa;
}

.btn {
  padding: 0.5rem 1rem;
  background-color: #4a4aff;
  color: white;
  border-radius: 6px;
  cursor: pointer;
  border: none;
}
</style>
