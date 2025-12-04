import { createI18n } from 'vue-i18n'

const messages = {
  es: {
    phases: {
      lobby: 'Sala de espera',
      reveal: 'Revelación de roles',
      words: 'Escritura de palabras',
      voting: 'Votación',
      revealRound: 'Revelación de votos',
      finished: 'Partida terminada',
    },
    buttons: {
      start: 'Empezar partida',
      join: 'Unirse',
      restart: 'Reiniciar',
      finish: 'Finalizar partida',
    },
  },
  en: {
    phases: {
      lobby: 'Lobby',
      reveal: 'Role Reveal',
      words: 'Write Words',
      voting: 'Voting',
      revealRound: 'Reveal Round',
      finished: 'Game Finished',
    },
    buttons: {
      start: 'Start Game',
      join: 'Join',
      restart: 'Restart',
      finish: 'Finish Game',
    },
  },
}

export const i18n = createI18n({
  legacy: false,
  locale: 'es',
  fallbackLocale: 'en',
  messages,
})
