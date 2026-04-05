<template>
  <div class="app-layout">
    <div class="app-content">
      <RouterView />

      <footer class="app-footer">
        <nav class="app-footer__nav" aria-label="Enlaces del sitio">
          <div class="app-footer__group">
            <RouterLink to="/como-jugar">Cómo jugar</RouterLink>
            <RouterLink to="/jugar-impostor-online">Jugar online</RouterLink>
            <RouterLink to="/reglas">Reglas</RouterLink>
            <RouterLink to="/faq">FAQ</RouterLink>
          </div>

          <div class="app-footer__group">
            <RouterLink to="/legal-notice">Aviso legal</RouterLink>
            <RouterLink to="/privacy-policy">Privacidad</RouterLink>
            <RouterLink to="/cookie-policy">Cookies</RouterLink>
          </div>
        </nav>

        <p class="app-footer__copy">© 2026 El Juego del Impostor</p>
      </footer>
    </div>
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
import { storeToRefs } from 'pinia'
import AppPopup from '@/components/ui/AppPopup.vue'
import { useUiStore } from '@/stores/uiStore'

const uiStore = useUiStore()
const { popupVisible, popupTitle, popupMessage } = storeToRefs(uiStore)
</script>

<style>
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

.app-footer {
  margin-top: 2rem;
  padding: 16px 12px 24px;
  border-top: 1px solid rgba(148, 163, 184, 0.12);
  text-align: center;
  font-size: 0.9rem;
  opacity: 0.85;
}

.app-footer__nav {
  max-width: 960px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.app-footer__group {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0.75rem 1rem;
}

.app-footer a {
  color: inherit;
  text-decoration: none;
}

.app-footer a:hover {
  text-decoration: underline;
  opacity: 1;
}

.app-footer__copy {
  margin: 1rem 0 0;
  text-align: center;
  font-size: 0.8rem;
  opacity: 0.7;
}

@media (max-width: 768px) {
  .app-footer {
    font-size: 0.85rem;
    padding: 14px 10px 20px;
  }

  .app-footer__copy {
    font-size: 0.75rem;
    line-height: 1.4;
  }
}
</style>
