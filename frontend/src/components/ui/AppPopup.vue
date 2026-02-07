<template>
  <Teleport to="body">
    <transition name="popup-fade">
      <div v-if="modelValue" class="popup-overlay" @click="onOverlayClick">
        <div class="popup" @click.stop>
          <!-- Header -->
          <header class="popup__header" v-if="title || showClose">
            <h2 v-if="title" class="popup__title">
              {{ title }}
            </h2>
            <button v-if="showClose" class="popup__close-btn" type="button" @click="handleCancel">
              ✕
            </button>
          </header>

          <!-- Body -->
          <section class="popup__body">
            <p v-if="message" class="popup__message">
              {{ message }}
            </p>
            <slot />
          </section>

          <!-- Footer -->
          <footer v-if="hasFooter" class="popup__footer">
            <button
              v-if="showCancelComputed"
              type="button"
              class="btn btn--secondary"
              @click="handleCancel"
            >
              {{ cancelTextComputed }}
            </button>

            <button
              v-if="showConfirmComputed"
              type="button"
              class="btn btn--primary"
              @click="handleConfirm"
            >
              {{ confirmTextComputed }}
            </button>
          </footer>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  modelValue: boolean
  title?: string
  message?: string
  confirmText?: string
  cancelText?: string
  showConfirm?: boolean
  showCancel?: boolean
  showClose?: boolean
  persistent?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()

const hasFooter = computed(() => props.showConfirm ?? props.showCancel ?? true)
const showConfirmComputed = computed(() => props.showConfirm ?? true)
const showCancelComputed = computed(() => props.showCancel ?? false)

const confirmTextComputed = computed(() => props.confirmText ?? 'Aceptar')
const cancelTextComputed = computed(() => props.cancelText ?? 'Cancelar')
const showClose = computed(() => props.showClose ?? true)

function close() {
  emit('update:modelValue', false)
}

function handleConfirm() {
  emit('confirm')
  close()
}

function handleCancel() {
  emit('cancel')
  close()
}

function onOverlayClick() {
  if (!props.persistent) {
    handleCancel()
  }
}
</script>

<style scoped lang="scss">
/* Overlay */
.popup-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.5);
  backdrop-filter: blur(3px);

  display: flex;
  justify-content: center;
  align-items: flex-start;

  padding: 16px;
  overflow: auto;
  z-index: 2000;
}

/* Contenedor */
.popup {
  width: min(420px, 92vw);
  background: #0f172a;
  border-radius: 8px;
  padding: 1.25rem 1.5rem;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
  color: #e5e7eb;

  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 32px);
  overflow: hidden;
}

/* Header */
.popup__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.popup__title {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0;
}

.popup__close-btn {
  border: none;
  background: transparent;
  color: #9ca3af;
  cursor: pointer;
  font-size: 1rem;
  padding: 0.2rem 0.4rem;
  border-radius: 4px;

  &:hover {
    background: rgba(148, 163, 184, 0.16);
    color: #e5e7eb;
  }
}

/* Body (scrollable) */
.popup__body {
  font-size: 0.95rem;
  line-height: 1.4;

  flex: 1 1 auto; /* ✅ CLAVE: ocupa el espacio disponible */
  overflow: auto; /* ✅ scroll aquí */
  min-height: 0;
}

.popup__message {
  margin: 0 0 0.75rem;
}

/* Footer */
.popup__footer {
  margin-top: 1rem;
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  flex-wrap: wrap;
  flex-shrink: 0;
}

/* 🔥 Override del .btn global (width: 100%) SOLO en el popup */
.popup__footer :deep(.btn) {
  width: auto;
  min-width: 110px;
}

/* Transiciones */
.popup-fade-enter-active,
.popup-fade-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.popup-fade-enter-from,
.popup-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}
</style>
