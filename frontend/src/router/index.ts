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
    name:'Legal',
    component: LegalNoticeView,
  },
  {
    path: '/privacy-policy',
    name:'privacy',
    component: PrivacyPolicyView,
  },
  {
    path: '/cookie-policy',
    name:'cookie',
    component: CookiePolicyView,
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
})

export default router
