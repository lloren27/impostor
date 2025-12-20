<template>
  <div class="app-content">
    <RouterView />
    <footer class="app-footer">
      <RouterLink to="/legal-notice">Aviso legal</RouterLink>
      <span class="sep">·</span>
      <RouterLink to="/privacy-policy">Privacidad</RouterLink>
      <span class="sep">·</span>
      <RouterLink to="/cookie-policy">Cookies</RouterLink>
    </footer>
  </div>
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

.app-layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-content {
  flex: 1;
  display: flex;
  flex-direction: column;
}

/* Footer */
.app-footer {
  text-align: center;
  font-size: 12px;
  opacity: 0.6;
  padding: 12px 8px;
}

.app-footer a {
  color: inherit;
  text-decoration: none;
}

.app-footer a:hover {
  text-decoration: underline;
  opacity: 1;
}

.app-footer .sep {
  margin: 0 4px;
}
</style>
