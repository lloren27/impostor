<template>
  <Teleport to="body">
    <transition name="popup-fade">
      <div v-if="modelValue" class="popup-overlay" @click="onOverlayClick">
        <div class="popup" @click.stop>
          <header class="popup__header" v-if="title || showClose">
            <h2 v-if="title" class="popup__title">
              {{ title }}
            </h2>
            <button v-if="showClose" class="popup__close-btn" type="button" @click="handleCancel">
              ✕
            </button>
          </header>

          <section class="popup__body">
            <p v-if="message" class="popup__message">
              {{ message }}
            </p>
            <!-- Contenido extra opcional -->
            <slot />
          </section>

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
  /** Si es true, no se cierra al hacer clic en el overlay */
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
.popup-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.5);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.popup {
  width: min(420px, 92vw);
  background: #0f172a;
  border-radius: 8px;
  padding: 1.25rem 1.5rem;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
  color: #e5e7eb;
}

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
  padding: 0.1rem 0.25rem;
  border-radius: 4px;

  &:hover {
    background: rgba(148, 163, 184, 0.16);
    color: #e5e7eb;
  }
}

.popup__body {
  font-size: 0.95rem;
  line-height: 1.4;
}

.popup__message {
  margin: 0 0 0.75rem;
}

.popup__footer {
  margin-top: 1rem;
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

/* Reutiliza tu estilo .btn si ya existe, o deja esto */
.btn {
  border-radius: 4px;
  padding: 0.4rem 0.9rem;
  font-size: 0.9rem;
  border: none;
  cursor: pointer;
  font-weight: 500;

  &--primary {
    background: #22c55e;
    color: #022c22;

    &:hover {
      background: #16a34a;
    }
  }

  &--secondary {
    background: #1f2937;
    color: #e5e7eb;

    &:hover {
      background: #111827;
    }
  }
}

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
