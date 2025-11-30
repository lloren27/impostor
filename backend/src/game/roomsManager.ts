// src/game/roomsManager.ts
import { CHARACTERS } from "./characters";
import { Player, Room } from "./types";

const rooms: Map<string, Room> = new Map();

function generateRoomCode(): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // sin I ni O para evitar confusión
  let code = "";
  for (let i = 0; i < 4; i++) {
    const idx = Math.floor(Math.random() * letters.length);
    code += letters[idx];
  }
  return code;
}

function createUniqueRoomCode(): string {
  let code: string;
  do {
    code = generateRoomCode();
  } while (rooms.has(code));
  return code;
}

export function createRoom(
  hostSocketId: string,
  hostName: string
): { room: Room; player: Player } {
  const code = createUniqueRoomCode();

  const hostPlayer: Player = {
    id: hostSocketId,
    name: hostName,
    isHost: true,
    isImpostor: false,
    character: null,
    alive: true,
  };

  const room: Room = {
    code,
    players: [hostPlayer],
    phase: "lobby",
    character: null,
    impostorId: null,
    currentRound: 0,
    baseOrder: [],
    roundStartIndex: 0,
    currentTurnIndex: 0,
    words: [],
    votes: [],
    winner: null,
  };

  rooms.set(code, room);

  return { room, player: hostPlayer };
}

export function joinRoom(
  roomCode: string,
  socketId: string,
  name: string
): { room: Room; player: Player } {
  const code = roomCode.toUpperCase();
  const room = rooms.get(code);

  if (!room) {
    throw new Error("ROOM_NOT_FOUND");
  }

  if (room.phase !== "lobby") {
    throw new Error("GAME_ALREADY_STARTED");
  }

  const existing = room.players.find((p) => p.id === socketId);
  if (existing) {
    return { room, player: existing };
  }

  const player: Player = {
    id: socketId,
    name,
    isHost: false,
    isImpostor: false,
    character: null,
    alive: true,
  };

  room.players.push(player);

  return { room, player };
}

export function getRoom(roomCode: string): Room | undefined {
  return rooms.get(roomCode.toUpperCase());
}

export function removePlayer(socketId: string): void {
  for (const [code, room] of rooms.entries()) {
    const index = room.players.findIndex((p) => p.id === socketId);
    if (index !== -1) {
      room.players.splice(index, 1);

      // Si no queda nadie, borramos la sala
      if (room.players.length === 0) {
        rooms.delete(code);
        return;
      }

      // Si el que se va era el host, pasamos el host a otro jugador
      const currentHost = room.players.find((p) => p.isHost);
      if (!currentHost) {
        room.players[0].isHost = true;
      }

      return;
    }
  }
}

/**
 * Inicia la partida:
 * - comprueba que hay suficientes jugadores
 * - elige impostor
 * - elige personaje
 * - asigna personaje a todos menos al impostor
 */
export function startGame(roomCode: string): {
  room: Room;
  roles: { playerId: string; isImpostor: boolean; character: string | null }[];
} {
  const room = rooms.get(roomCode.toUpperCase());
  if (!room) throw new Error("ROOM_NOT_FOUND");

  if (room.phase !== "lobby") throw new Error("GAME_ALREADY_STARTED");

  if (room.players.length < 3) {
    throw new Error("NOT_ENOUGH_PLAYERS");
  }

  // Elegir impostor
  const alivePlayers = room.players.filter((p) => p.alive);
  const randomIndex = Math.floor(Math.random() * alivePlayers.length);
  const impostor = alivePlayers[randomIndex];

  room.impostorId = impostor.id;

  // Elegir personaje
  const characterIndex = Math.floor(Math.random() * CHARACTERS.length);
  const character = CHARACTERS[characterIndex];
  room.character = character;

  // Asignar roles
  const roles = room.players.map((p) => {
    const isImpostor = p.id === impostor.id;
    p.isImpostor = isImpostor;
    p.character = isImpostor ? null : character;
    p.alive = true;
    return {
      playerId: p.id,
      isImpostor,
      character: p.character,
    };
  });

  // Resetear estado de partida
  room.phase = "reveal";
  room.currentRound = 1;
  room.words = [];
  room.votes = [];
  room.winner = null;

  // Orden base de jugadores vivos (en círculo)
  room.baseOrder = room.players.filter((p) => p.alive).map((p) => p.id);
  room.roundStartIndex = 0;
  room.currentTurnIndex = 0;

  return { room, roles };
}

/**
 * Prepara una nueva ronda de palabras:
 * - recalcula baseOrder solo con vivos
 * - rota roundStartIndex una posición a la derecha a partir de la segunda ronda
 * - establece currentTurnIndex y devuelve el jugador al que le toca hablar primero
 */
export function startWordsRound(roomCode: string): {
  room: Room;
  currentPlayerId: string;
} {
  const room = rooms.get(roomCode.toUpperCase());
  if (!room) throw new Error("ROOM_NOT_FOUND");

  const alive = room.players.filter((p) => p.alive);
  if (alive.length < 2) {
    throw new Error("NOT_ENOUGH_ALIVE_PLAYERS");
  }

  room.phase = "words";
  room.words = [];
  room.votes = [];

  room.baseOrder = alive.map((p) => p.id);

  if (room.currentRound === 1) {
    room.roundStartIndex = 0;
  } else {
    room.roundStartIndex = (room.roundStartIndex + 1) % room.baseOrder.length;
  }

  room.currentTurnIndex = room.roundStartIndex;
  const currentPlayerId = room.baseOrder[room.currentTurnIndex];

  return { room, currentPlayerId };
}

/**
 * Registra la palabra de un jugador en su turno.
 * Devuelve info para saber si seguimos la ronda o pasamos a votación.
 */
export function submitWord(
  roomCode: string,
  playerId: string,
  word: string
): {
  room: Room;
  finishedRound: boolean;
  currentPlayerId: string | null;
  newWord: { playerId: string; word: string };
} {
  const room = rooms.get(roomCode.toUpperCase());
  if (!room) throw new Error("ROOM_NOT_FOUND");

  if (room.phase !== "words") throw new Error("NOT_WORDS_PHASE");

  const totalAlive = room.baseOrder.length;
  if (totalAlive === 0) throw new Error("NO_ALIVE_PLAYERS");

  const currentPlayerId = room.baseOrder[room.currentTurnIndex];
  if (playerId !== currentPlayerId) {
    throw new Error("NOT_YOUR_TURN");
  }

  const newWord = { playerId, word };
  room.words.push(newWord);

  // Calcular cuántos turnos se han hecho en esta ronda
  const turnsDone =
    ((room.currentTurnIndex - room.roundStartIndex + totalAlive) % totalAlive) +
    1;

  if (turnsDone >= totalAlive) {
    // Fin de ronda → pasamos a votación
    room.phase = "voting";
    return {
      room,
      finishedRound: true,
      currentPlayerId: null,
      newWord,
    };
  }

  // Avanzar turno al siguiente jugador
  room.currentTurnIndex = (room.currentTurnIndex + 1) % totalAlive;
  const nextPlayerId = room.baseOrder[room.currentTurnIndex];

  return {
    room,
    finishedRound: false,
    currentPlayerId: nextPlayerId,
    newWord,
  };
}

export function submitVote(
  roomCode: string,
  voterId: string,
  targetId: string
): {
  room: Room;
  finishedVoting: boolean;
  eliminatedPlayer: Player | null;
  wasImpostor: boolean | null;
  winner: "players" | "impostor" | null;
} {
  const room = rooms.get(roomCode.toUpperCase());
  if (!room) throw new Error("ROOM_NOT_FOUND");
  if (room.phase !== "voting") throw new Error("NOT_VOTING_PHASE");

  const alive = room.players.filter((p) => p.alive);
  const totalAlive = alive.length;

  // No permitir votar dos veces
  const alreadyVoted = room.votes.find((v) => v.voterId === voterId);
  if (alreadyVoted) {
    throw new Error("ALREADY_VOTED");
  }

  // Registrar voto
  room.votes.push({ voterId, targetId });

  // Si NO han votado todos → todavía no termina la fase
  if (room.votes.length < totalAlive) {
    return {
      room,
      finishedVoting: false,
      eliminatedPlayer: null,
      wasImpostor: null,
      winner: null,
    };
  }

  // TODOS han votado → calcular expulsado
  const count: Record<string, number> = {};
  room.votes.forEach((v) => {
    count[v.targetId] = (count[v.targetId] || 0) + 1;
  });

  let eliminatedId = Object.keys(count).reduce((a, b) =>
    count[a] > count[b] ? a : b
  );

  const eliminatedPlayer = room.players.find((p) => p.id === eliminatedId)!;
  eliminatedPlayer.alive = false;

  const wasImpostor = eliminatedPlayer.id === room.impostorId;

  // Condición 1: expulsaron al impostor
  if (wasImpostor) {
    room.phase = "finished";
    room.winner = "players";

    return {
      room,
      finishedVoting: true,
      eliminatedPlayer,
      wasImpostor,
      winner: "players",
    };
  }

  // Condición 2: impostor sobrevivió → ¿solo quedan 2 vivos?
  const aliveNow = room.players.filter((p) => p.alive);
  if (aliveNow.length === 2) {
    // el impostor gana
    room.phase = "finished";
    room.winner = "impostor";

    return {
      room,
      finishedVoting: true,
      eliminatedPlayer,
      wasImpostor,
      winner: "impostor",
    };
  }

  // Condición 3: no termina la partida → empezar una nueva ronda
  room.currentRound += 1;
  room.phase = "revealRound";

  return {
    room,
    finishedVoting: true,
    eliminatedPlayer,
    wasImpostor,
    winner: null,
  };
}

export function startNextRound(roomCode: string): {
  room: Room;
  currentPlayerId: string;
} {
  const room = rooms.get(roomCode.toUpperCase());
  if (!room) throw new Error("ROOM_NOT_FOUND");
  if (room.phase !== "revealRound") throw new Error("NOT_REVEAL_ROUND");

  // Usa la misma lógica que startWordsRound
  room.phase = "words";
  room.words = [];
  room.votes = [];

  const alive = room.players.filter((p) => p.alive);
  room.baseOrder = alive.map((p) => p.id);

  // Rotar a la derecha según la ronda
  room.roundStartIndex = (room.roundStartIndex + 1) % room.baseOrder.length;
  room.currentTurnIndex = room.roundStartIndex;

  const currentPlayerId = room.baseOrder[room.currentTurnIndex];

  return {
    room,
    currentPlayerId,
  };
}
