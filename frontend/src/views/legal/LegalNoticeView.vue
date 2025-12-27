<template>
  <LegalContent :src="loadContent" />
</template>

<script setup lang="ts">
import LegalContent from '@/components/legal/LegalContent.vue'
import { useHead } from '@unhead/vue'

useHead({
  title: 'Aviso legal – El Juego del Impostor',
  meta: [
    {
      name: 'description',
      content:
        'Aviso legal sobre El Juego del Impostor. Su titular, objecto, condiciones, responsabilidad, propiedad intelectual y legislación aplicable.',
    },
  ],
})

const loadContent = () => import('@/content/legal/legal-notice.md?raw')
</script>
