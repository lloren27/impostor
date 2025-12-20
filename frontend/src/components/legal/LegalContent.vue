<template>
  <main class="page page--legal">
    <article class="legal-card" v-html="htmlContent" />
  </main>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { marked } from 'marked'

const props = defineProps<{
  src: () => Promise<{ default: string }>
}>()

const htmlContent = ref('')

onMounted(async () => {
  const md = await props.src()
  htmlContent.value = marked(md.default)
})
</script>

<style scoped>
.page--legal {
  display: flex;
  justify-content: center;
  padding: 2rem 1rem;
}

.legal-card {
  max-width: 820px;
  width: 100%;
  padding: 2rem;
  background: rgba(26, 41, 77, 0.9);
  color: #b4dc51;
  border-radius: 8px;
  line-height: 1.6;
}

.legal-card h1 {
  margin-top: 0;
}

.legal-card h2 {
  margin-top: 1.5rem;
}
</style>
