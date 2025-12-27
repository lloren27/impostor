<template>
  <LegalContent :src="loadContent" />
</template>

<script setup lang="ts">
import { useHead } from '@unhead/vue'
import LegalContent from '../../components/legal/LegalContent.vue'

useHead({
  title: 'Política de privacidad – El Juego del Impostor',
  meta: [
    {
      name: 'description',
      content: 'Información sobre el tratamiento de datos personales en El Juego del Impostor.',
    },
  ],
})

const loadContent = () => import('@/content/legal/privacy-policy.md?raw')
</script>
