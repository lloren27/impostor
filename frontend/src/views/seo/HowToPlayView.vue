<script setup lang="ts">
import SeoContent from '@/components/seo/SeoContent.vue'
import { useHead } from '@unhead/vue'

useHead({
  title: 'Cómo jugar al Juego del Impostor | Guía completa',
  meta: [
    {
      name: 'description',
      content:
        'Aprende cómo jugar al juego del impostor online paso a paso. Crea salas, invita amigos y descubre quién está mintiendo.',
    },
  ],
})
</script>

<template>
  <div class="seo-page">
    <section class="hero">
      <h1>Cómo jugar al Juego del Impostor</h1>
      <p>
        Aprende paso a paso cómo jugar al juego del impostor online y descubre quién está mintiendo.
      </p>

      <div class="seo-actions">
        <RouterLink to="/" class="seo-button seo-button--primary">Crear sala</RouterLink>
        <RouterLink to="/" class="seo-button seo-button--secondary">Unirse con código</RouterLink>
      </div>
    </section>

    <SeoContent file="como-jugar.md" />

    <section class="images">
      <img src="/images/como-jugar-1.png" alt="Cómo crear sala juego impostor" />
      <img src="/images/como-jugar-2.png" alt="Mecánica del juego impostor" />
    </section>

    <section class="cta">
      <h2>¿Listo para jugar?</h2>
      <div class="seo-actions">
        <RouterLink to="/" class="seo-button seo-button--primary">Crear sala</RouterLink>
        <RouterLink to="/" class="seo-button seo-button--secondary">Unirse con código</RouterLink>
      </div>
    </section>
  </div>
</template>
<style scoped lang="scss">
@use '@/assets/styles/seo-pages';

.images {
  display: flex;
  flex-direction: column;
  align-items: center; // 👉 centra horizontalmente
  gap: 1.5rem;
  margin: 2rem 0;

  img {
    width: 100%;
    max-width: 900px; // 👉 ancho máximo alineado con contenido
    height: auto;
    border-radius: 12px;
  }
}
</style>
