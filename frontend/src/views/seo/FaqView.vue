<script setup lang="ts">
import SeoContent from '@/components/seo/SeoContent.vue'
import { useHead } from '@unhead/vue'

useHead({
  title: 'FAQ Juego del Impostor | Preguntas frecuentes y cómo jugar',
  meta: [
    {
      name: 'description',
      content:
        'Resuelve todas tus dudas sobre el juego del impostor: cómo jugar, reglas, cuántos jugadores, si es gratis y cómo empezar.',
    },
  ],
  link: [
    {
      rel: 'canonical',
      href: 'https://eljuegodelimpostor.es/faq',
    },
  ],
  script: [
    {
      type: 'application/ld+json',
      textContent: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: [
          {
            '@type': 'Question',
            name: '¿Cómo se juega al impostor online?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Para jugar al impostor online solo tienes que crear una sala o unirte con un código.',
            },
          },
          {
            '@type': 'Question',
            name: '¿Se puede jugar gratis?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Sí, puedes jugar al impostor online gratis desde la web sin descargar nada.',
            },
          },
          {
            '@type': 'Question',
            name: '¿Se puede jugar desde el móvil?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Sí, el juego funciona en móvil, tablet y ordenador sin necesidad de instalar nada.',
            },
          },
          {
            '@type': 'Question',
            name: '¿Cuántos jugadores pueden jugar?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'El juego funciona mejor con 3 o más jugadores.',
            },
          },
        ],
      }),
    },
  ],
})
</script>

<template>
  <div class="seo-page">
    <!-- HERO -->
    <section class="seo-hero">
      <div class="seo-hero__content">
        <p class="seo-eyebrow">Ayuda y soporte</p>
        <h1>Preguntas frecuentes</h1>
        <p class="seo-lead">
          Resuelve todas tus dudas sobre cómo jugar al juego del impostor online.
        </p>
      </div>
    </section>

    <!-- CONTENIDO FAQ -->
    <section class="seo-section">
      <SeoContent file="faq.md" />
    </section>

    <!-- IMAGEN -->
    <section class="seo-section seo-section--image">
      <img
        src="/images/como-jugar-1.png"
        alt="Juego del impostor online creando y uniéndose a sala"
        class="seo-image"
      />
    </section>

    <!-- LINKS INTERNOS -->
    <section class="seo-section seo-section--links">
      <h2>Más información</h2>
      <div class="seo-link-list">
        <RouterLink to="/como-jugar">Cómo jugar</RouterLink>
        <RouterLink to="/reglas">Reglas</RouterLink>
        <RouterLink to="/jugar-impostor-online">Jugar online</RouterLink>
      </div>
    </section>

    <!-- CTA FINAL -->
    <section class="seo-cta">
      <h2>Empieza a jugar ahora</h2>
      <p>Crea una sala o únete con un código y empieza una partida en segundos.</p>

      <div class="seo-actions">
        <RouterLink to="/" class="seo-button seo-button--primary"> Crear sala </RouterLink>

        <RouterLink to="/" class="seo-button seo-button--secondary"> Unirse a sala </RouterLink>
      </div>
    </section>
  </div>
</template>
<style scoped lang="scss">
@use '@/assets/styles/seo-pages';
</style>
