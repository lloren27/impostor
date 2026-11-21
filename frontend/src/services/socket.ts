// src/services/socket.ts
import { io, Socket } from 'socket.io-client'

import { BACKEND_URL } from './backendUrl'

export const socket: Socket = io(BACKEND_URL, {
  transports: ['polling', 'websocket'],
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
})
