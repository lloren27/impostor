import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import LobbyView from '../views/LobbyView.vue'
import GameView from '../views/GameView.vue'
import JoinRoomView from '../views/JoinRoomView.vue'
import NotFound from '../views/NotFound.vue'

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
    component: JoinRoomView
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: NotFound
  }
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

export default router
