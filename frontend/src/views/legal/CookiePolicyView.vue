<template>
  <LegalContent :src="loadContent" />
</template>

<script setup lang="ts">
import LegalContent from '@/components/legal/LegalContent.vue'
import { useHead } from '@unhead/vue'

useHead({
  title: 'Política de cookies – El Juego del Impostor',
  meta: [
    {
      name: 'description',
      content: 'Politica de cookies sobre El Juego del Impostor.',
    },
  ],
})

const loadContent = () => import('@/content/legal/cookie-policy.md?raw')
</script>
