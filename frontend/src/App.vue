<template>
  <RouterView />
  <AppPopup
    v-model="popupVisible"
    :title="popupTitle"
    :message="popupMessage"
    :showCancel="false"
    :showConfirm="true"
    confirmText="Entendido"
    @confirm="uiStore.hidePopup"
  />
</template>
<script setup lang="ts">
import { RouterView } from 'vue-router'
import AppPopup from '@/components/ui/AppPopup.vue'
import { useUiStore } from '@/stores/uiStore'
import { storeToRefs } from 'pinia'

const uiStore = useUiStore()
const { popupVisible, popupTitle, popupMessage } = storeToRefs(uiStore)
</script>

<style>
/* Aquí puedes poner estilos globales básicos si quieres */
body {
  margin: 0;
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
}
</style>
