<template>
  <div
    class="loading-spinner"
    :class="{
      'loading-spinner--small': size === 'small',
      'loading-spinner--medium': size === 'medium',
      'loading-spinner--large': size === 'large',
    }"
  ></div>
</template>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    size?: 'small' | 'medium' | 'large'
  }>(),
  {
    size: 'medium',
  },
)

const size = props.size
</script>

<style scoped>
.loading-spinner {
  border: 4px solid #e0e0e0;
  border-top-color: var(--color-primary, #333);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.loading-spinner--small {
  width: 24px;
  height: 24px;
}

.loading-spinner--medium {
  width: 40px;
  height: 40px;
}

.loading-spinner--large {
  width: 70px;
  height: 70px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
