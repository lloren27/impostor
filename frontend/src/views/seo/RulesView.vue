<script setup lang="ts">
import SeoContent from '@/components/seo/SeoContent.vue'
import { useHead } from '@unhead/vue'

useHead({
  title: 'Reglas del Juego del Impostor | Cómo se juega paso a paso',
  meta: [
    {
      name: 'description',
      content:
        'Descubre las reglas del juego del impostor. Aprende los roles, fases del juego y cómo ganar cada partida online.',
    },
  ],
  link: [
    {
      rel: 'canonical',
      href: 'https://eljuegodelimpostor.es/reglas',
    },
  ],
})
</script>

<template>
  <div class="seo-page">
    <!-- HERO -->
    <section class="seo-hero">
      <div class="seo-hero__content">
        <p class="seo-eyebrow">Guía del juego</p>
        <h1>Reglas del Juego del Impostor</h1>
        <p class="seo-lead">
          Aprende todas las reglas del juego del impostor y descubre cómo ganar cada partida.
        </p>

        <div class="seo-actions">
          <RouterLink to="/" class="seo-button seo-button--primary"> Crear sala </RouterLink>

          <RouterLink to="/" class="seo-button seo-button--secondary"> Unirse a sala </RouterLink>
        </div>
      </div>
    </section>

    <!-- CONTENIDO SEO -->
    <section class="seo-section">
      <SeoContent file="reglas.md" />
    </section>

    <!-- IMAGEN MECÁNICA -->
    <section class="seo-section seo-section--image">
      <img
        src="/images/como-jugar-2.png"
        alt="Reglas del juego del impostor con fases y votación"
        class="seo-image"
      />
    </section>

    <!-- LINKS INTERNOS -->
    <section class="seo-section seo-section--links">
      <h2>Más información</h2>
      <div class="seo-link-list">
        <RouterLink to="/como-jugar">Cómo jugar</RouterLink>
        <RouterLink to="/jugar-impostor-online">Jugar online</RouterLink>
        <RouterLink to="/faq">Preguntas frecuentes</RouterLink>
      </div>
    </section>

    <!-- CTA FINAL -->
    <section class="seo-cta">
      <h2>¿Listo para jugar?</h2>
      <p>Pon en práctica las reglas y descubre quién es el impostor en tu próxima partida.</p>

      <div class="seo-actions">
        <RouterLink to="/" class="seo-button seo-button--primary"> Crear sala </RouterLink>

        <RouterLink to="/" class="seo-button seo-button--secondary"> Unirse con código </RouterLink>
      </div>
    </section>
  </div>
</template>
<style scoped lang="scss">
@use '@/assets/styles/seo-pages';
</style>
