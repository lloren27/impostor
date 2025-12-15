<template>
  <div class="portrait" :class="{ 'portrait--revealed': revealed }">
    <div class="portrait__frame">
      <div class="portrait__silhouette" aria-hidden="true"></div>

      <img class="portrait__photo" :src="roleImage" alt="Retrato del rol" draggable="false" />

      <div v-if="playReveal" class="portrait__scan" aria-hidden="true"></div>

      <div class="portrait__stamp" :class="stampClass">
        {{ stampText }}
      </div>
    </div>

    <div class="portrait__caption">
      <span class="portrait__label">Identidad</span>
      <span class="portrait__value">{{ captionText }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import impostorImg from '@/assets/roles/impostor.png'
import citizenImg from '@/assets/roles/citizen.png'

const props = defineProps<{
  revealed: boolean
  playReveal: boolean
  isImpostor?: boolean
  character?: string | null
}>()

const roleImage = computed(() => (props.isImpostor ? impostorImg : citizenImg))

const stampText = computed(() => {
  if (!props.revealed) return 'CLASIFICADO'
  return props.isImpostor ? 'IMPOSTOR' : 'CIUDADANO'
})

const stampClass = computed(() => {
  if (!props.revealed) return 'stamp--neutral'
  return props.isImpostor ? 'stamp--danger' : 'stamp--ok'
})

const captionText = computed(() => {
  if (!props.revealed) return 'Desconocida'
  if (props.isImpostor) return 'Impostor'
  return props.character ? props.character : 'Ciudadano'
})
</script>

<style scoped>
.portrait {
  width: 86px;
  user-select: none;
}

.portrait__frame {
  position: relative;
  width: 86px;
  height: 104px;
  border-radius: 10px;
  overflow: hidden;
  background:
    radial-gradient(120px 120px at 30% 20%, rgba(255, 255, 255, 0.08), transparent 55%),
    linear-gradient(180deg, rgba(2, 6, 23, 0.95), rgba(0, 0, 0, 0.95));
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 10px 22px rgba(0, 0, 0, 0.35);
}

/* Silueta "genérica" (no AmongUs) */
.portrait__silhouette {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(60px 60px at 50% 38%, rgba(255, 255, 255, 0.1), transparent 60%),
    radial-gradient(30px 30px at 52% 40%, rgba(255, 255, 255, 0.06), transparent 65%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.08), transparent 70%);
  filter: blur(0.2px);
  opacity: 1;
  transition: opacity 420ms ease;
}

/* Foto real */
.portrait__photo {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transform: scale(1.03);
  filter: saturate(0.9) contrast(1.05);
  transition:
    opacity 420ms ease,
    transform 620ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

/* Cuando revelamos */
.portrait--revealed .portrait__silhouette {
  opacity: 0;
}
.portrait--revealed .portrait__photo {
  opacity: 1;
  transform: scale(1);
}

/* Scan */
.portrait__scan {
  position: absolute;
  left: -40%;
  top: -10%;
  width: 60%;
  height: 120%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
  transform: rotate(12deg);
  animation: scan 850ms ease-out;
  pointer-events: none;
}

@keyframes scan {
  from {
    transform: translateX(-40%) rotate(12deg);
    opacity: 0;
  }
  20% {
    opacity: 1;
  }
  to {
    transform: translateX(260%) rotate(12deg);
    opacity: 0;
  }
}

/* Sello */
.portrait__stamp {
  position: absolute;
  left: 6px;
  bottom: 6px;
  padding: 2px 6px;
  font-size: 0.58rem;
  letter-spacing: 0.08em;
  border-radius: 999px;
  text-transform: uppercase;
  backdrop-filter: blur(4px);
  border: 1px solid rgba(255, 255, 255, 0.14);
}

.stamp--neutral {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.75);
}
.stamp--ok {
  background: rgba(16, 185, 129, 0.12);
  color: rgba(167, 243, 208, 0.95);
  border-color: rgba(16, 185, 129, 0.25);
}
.stamp--danger {
  background: rgba(239, 68, 68, 0.12);
  color: rgba(254, 202, 202, 0.95);
  border-color: rgba(239, 68, 68, 0.25);
}

/* Caption */
.portrait__caption {
  margin-top: 6px;
  line-height: 1.05;
}
.portrait__label {
  display: block;
  font-size: 0.62rem;
  color: rgba(148, 163, 184, 0.9);
}
.portrait__value {
  display: block;
  font-size: 0.7rem;
  color: rgba(241, 245, 249, 0.95);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
