import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import LobbyView from '../views/LobbyView.vue'
import GameView from '../views/GameView.vue'
import JoinRoomView from '../views/JoinRoomView.vue'
import NotFound from '../views/NotFound.vue'
import LegalNoticeView from '../views/legal/LegalNoticeView.vue'
import PrivacyPolicyView from '../views/legal/PrivacyPolicyView.vue'
import CookiePolicyView from '../views/legal/CookiePolicyView.vue'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: HomeView,
  },
  {
    path: '/room/:code/lobby',
    name: 'lobby',
    component: LobbyView,
  },
  {
    path: '/room/:code/game',
    name: 'game',
    component: GameView,
  },
  {
    path: '/join/:roomCode',
    name: 'JoinRoom',
    component: JoinRoomView,
  },
  {
    path: '/legal-notice',
    name: 'Legal',
    component: LegalNoticeView,
  },
  {
    path: '/privacy-policy',
    name: 'privacy',
    component: PrivacyPolicyView,
  },
  {
    path: '/cookie-policy',
    name: 'cookie',
    component: CookiePolicyView,
  },
  {
    path: '/faq',
    name: 'faq',
    component: () => import('@/views/seo/FaqView.vue'),
  },
  {
    path: '/como-jugar',
    name: 'how-to-play',
    component: () => import('@/views/seo/HowToPlayView.vue'),
  },
  {
    path: '/reglas',
    name: 'rules',
    component: () => import('@/views/seo/RulesView.vue'),
  },
  {
    path: '/jugar-impostor-online',
    name: 'play-online',
    component: () => import('@/views/seo/PlayOnlineView.vue'),
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: NotFound,
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior(_to, _from, savedPosition) {
    if (savedPosition) {
      return savedPosition
    }

    return { top: 0, left: 0, behavior: 'smooth' }
  },
})

export default router