<script setup lang="ts">
import SeoContent from '@/components/seo/SeoContent.vue'
import { useHead } from '@unhead/vue'

useHead({
  title: 'Jugar al Impostor Online Gratis | Crea una sala y juega con amigos',
  meta: [
    {
      name: 'description',
      content:
        'Juega al impostor online gratis desde móvil o PC. Crea una sala, comparte el código con tus amigos y descubre quién está mintiendo.',
    },
  ],
  link: [
    {
      rel: 'canonical',
      href: 'https://eljuegodelimpostor.es/jugar-impostor-online',
    },
  ],
})
</script>

<template>
  <div class="seo-page">
    <section class="seo-hero">
      <div class="seo-hero__content">
        <p class="seo-eyebrow">Juego online multijugador</p>
        <h1>Jugar al Impostor Online Gratis</h1>
        <p class="seo-lead">
          Crea una sala, comparte el código con tus amigos y empieza una partida en segundos desde
          móvil, tablet u ordenador.
        </p>
      </div>
    </section>

    <section class="seo-section seo-section--highlight">
      <div class="seo-grid seo-grid--3">
        <article class="seo-card">
          <h2>Sin descargar nada</h2>
          <p>Juega directamente desde el navegador sin instalar apps ni programas.</p>
        </article>

        <article class="seo-card">
          <h2>Fácil de compartir</h2>
          <p>Solo necesitas enviar el código o enlace de la sala a tus amigos.</p>
        </article>

        <article class="seo-card">
          <h2>Ideal para grupos</h2>
          <p>Perfecto para partidas rápidas, reuniones con amigos o juegos en grupo.</p>
        </article>
      </div>
    </section>

    <section class="seo-section">
      <SeoContent file="jugar-impostor-online.md" />
    </section>

    <section class="seo-section">
      <h2>Cómo empezar a jugar</h2>

      <div class="seo-grid seo-grid--3">
        <article class="seo-step">
          <span class="seo-step__number">1</span>
          <h3>Crea una sala</h3>
          <p>Inicia una nueva partida y genera un código para compartir.</p>
        </article>

        <article class="seo-step">
          <span class="seo-step__number">2</span>
          <h3>Invita a tus amigos</h3>
          <p>Comparte el enlace o el código de sala para que entren al lobby.</p>
        </article>

        <article class="seo-step">
          <span class="seo-step__number">3</span>
          <h3>Empieza la ronda</h3>
          <p>Descubrid quién es el impostor mientras cada jugador intenta cumplir su rol.</p>
        </article>
      </div>
    </section>

    <section class="seo-section seo-section--image">
      <img
        src="/images/como-jugar-1.png"
        alt="Jugar al impostor online creando o uniéndose a una sala"
        class="seo-image"
      />
    </section>

    <section class="seo-section seo-section--links">
      <h2>Más información</h2>
      <div class="seo-link-list">
        <RouterLink to="/como-jugar">Cómo jugar</RouterLink>
        <RouterLink to="/reglas">Reglas del juego</RouterLink>
        <RouterLink to="/faq">Preguntas frecuentes</RouterLink>
      </div>
    </section>

    <section class="seo-cta">
      <h2>¿Preparado para jugar?</h2>
      <p>Entra ahora, crea una sala o únete con un código y empieza a jugar al impostor online.</p>

      <div class="seo-actions">
        <RouterLink to="/" class="seo-button seo-button--primary"> Crear sala </RouterLink>

        <RouterLink to="/" class="seo-button seo-button--secondary"> Unirse a sala </RouterLink>
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
@use '@/assets/styles/seo-pages';
.seo-page {
  width: 100%;
}

.seo-hero,
.seo-section,
.seo-cta {
  max-width: 1100px;
  margin: 0 auto;
  padding: 3rem 1.25rem;
}

.seo-hero__content {
  max-width: 760px;
}

.seo-eyebrow {
  margin-bottom: 0.75rem;
  font-size: 0.95rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.8;
}

.seo-hero h1,
.seo-section h2,
.seo-cta h2 {
  margin-bottom: 1rem;
  line-height: 1.1;
}

.seo-lead {
  font-size: 1.1rem;
  line-height: 1.6;
  margin-bottom: 1.5rem;
}

.seo-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.seo-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.9rem 1.25rem;
  border-radius: 10px;
  text-decoration: none;
  font-weight: 700;
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}

.seo-button:hover {
  transform: translateY(-1px);
  opacity: 0.95;
}

.seo-button--primary {
  background: #1f7aff;
  color: white;
}

.seo-button--secondary {
  border: 1px solid currentColor;
  color: inherit;
}

.seo-section--highlight {
  padding-top: 0;
}

.seo-grid {
  display: grid;
  gap: 1rem;
}

.seo-grid--3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.seo-card,
.seo-step {
  padding: 1.25rem;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.03);
}

.seo-step__number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  margin-bottom: 0.75rem;
  border-radius: 999px;
  font-weight: 700;
  background: rgba(255, 255, 255, 0.08);
}

.seo-section--image {
  text-align: center;
}

.seo-image {
  width: 100%;
  max-width: 960px;
  height: auto;
  border-radius: 16px;
}

.seo-link-list {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.seo-link-list a {
  font-weight: 600;
  text-decoration: none;
}

@media (max-width: 768px) {
  .seo-grid--3 {
    grid-template-columns: 1fr;
  }

  .seo-hero,
  .seo-section,
  .seo-cta {
    padding: 2rem 1rem;
  }
}
</style>
