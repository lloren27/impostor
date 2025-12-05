<template>
  <div class="overlay">
    <Spinner size="large" />
    <p v-if="text">{{ text }}</p>
  </div>
</template>

<script setup lang="ts">
import Spinner from './Spinner.vue'

defineProps<{
  text?: string
}>()
</script>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(3px);
  z-index: 9999;
}

p {
  margin-top: 1rem;
  color: white;
  font-size: 1.1rem;
}
</style>
