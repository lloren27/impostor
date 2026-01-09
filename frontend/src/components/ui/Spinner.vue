<template>
  <div
    class="spinner"
    :class="{
      'spinner--small': size === 'small',
      'spinner--medium': size === 'medium',
      'spinner--large': size === 'large',
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
.spinner {
  border: 4px solid #e0e0e0;
  border-top-color: var(--color-primary, #333);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.spinner--small {
  width: 24px;
  height: 24px;
}

.spinner--medium {
  width: 40px;
  height: 40px;
}

.spinner--large {
  width: 70px;
  height: 70px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
