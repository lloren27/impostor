<template>
  <LegalContent :src="loadContent" />
</template>

<script setup lang="ts">
import LegalContent from '@/components/legal/LegalContent.vue'

const loadContent = () => import('@/content/legal/cookie-policy.md?raw')
</script>
