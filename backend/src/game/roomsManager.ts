// src/game/roomsManager.ts
import { CHARACTERS } from "./characters";
import { Player, Room } from "./types";

const rooms: Map<string, Room> = new Map();
const roomDeletionTimers: Map<string, NodeJS.Timeout> = new Map();

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

function generatePlayerToken(): string {
  return (
    crypto?.randomUUID?.() ??
    Date.now().toString(36) + Math.random().toString(36).slice(2)
  );
}

function generatePlayerId(): string {
  return (
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10)
  );
}

export function createRoom(
  hostSocketId: string,
  hostName: string
): { room: Room; player: Player } {
  const code = createUniqueRoomCode();
  cancelRoomDeletion(code);

  const hostPlayer: Player = {
    id: generatePlayerId(),
    token: generatePlayerToken(),
    socketId: hostSocketId,
    name: hostName,
    isHost: true,
    isImpostor: false,
    character: null,
    alive: true,
    connected: true,
    disconnectedAt: null,
    joinedAt: Date.now(),
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
    tieCandidates: null,
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
  cancelRoomDeletion(code);
  const room = rooms.get(code);

  if (!room) {
    throw new Error("ROOM_NOT_FOUND");
  }

  if (room.phase !== "lobby") {
    throw new Error("GAME_ALREADY_STARTED");
  }

  // Siempre creamos jugador nuevo. El "rejoin" se hace con rejoinRoom, no aquí.
  const player: Player = {
    id: generatePlayerId(),
    token: generatePlayerToken(),
    socketId,
    name,
    isHost: false,
    isImpostor: false,
    character: null,
    alive: true,
    connected: true,
    disconnectedAt: null,
    joinedAt: Date.now(),
  };

  room.players.push(player);

  return { room, player };
}

export function getRoom(roomCode: string): Room | undefined {
  return rooms.get(roomCode.toUpperCase());
}

export function deleteRoom(roomCode: string): void {
  const code = roomCode.toUpperCase();
  rooms.delete(code);
}

// Ahora NO borramos al jugador, solo marcamos su socket como desconectado.
// Si absolutamente todos están desconectados, sí borramos la sala.
export function removePlayer(socketId: string): void {
  for (const [code, room] of rooms.entries()) {
    const player = room.players.find((p) => p.socketId === socketId);
    if (player) {
      player.socketId = null;

      const anyConnected = room.players.some((p) => p.socketId !== null);
      if (!anyConnected) {
        scheduleRoomDeletion(code, 10 * 60 * 1000); // 10 min
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
  roles: {
    playerId: string; // ID estable
    socketId: string | null; // socket actual (para emitir yourRole)
    isImpostor: boolean;
    character: string | null;
  }[];
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

  room.impostorId = impostor.id; // <- ID estable del impostor

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
      playerId: p.id, // estable
      socketId: p.socketId, // para io.to()
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

  // Orden base de jugadores vivos (en círculo) por ID estable
  room.baseOrder = room.players.filter((p) => p.alive).map((p) => p.id);
  room.roundStartIndex = 0;
  room.currentTurnIndex = 0;

  return { room, roles };
}

export function restartGame(roomCode: string): {
  room: Room;
  roles: {
    playerId: string;
    socketId: string | null;
    isImpostor: boolean;
    character: string | null;
  }[];
} {
  const code = roomCode.toUpperCase();
  const room = rooms.get(code);
  if (!room) {
    throw new Error("ROOM_NOT_FOUND");
  }

  // resetear estado de la sala
  room.phase = "lobby";
  room.currentRound = 0;
  room.words = [];
  room.votes = [];
  room.winner = null;
  room.character = null;
  room.impostorId = null;
  room.baseOrder = [];
  room.roundStartIndex = 0;
  room.currentTurnIndex = 0;

  room.players.forEach((p) => {
    p.alive = true;
    p.isImpostor = false;
    p.character = null;
  });

  return startGame(roomCode);
}

/**
 * Prepara una nueva ronda de palabras
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

  // baseOrder siempre por ID estable
  room.baseOrder = alive.map((p) => p.id);

  if (room.currentRound === 1) {
    room.roundStartIndex = Math.floor(Math.random() * room.baseOrder.length);
  } else {
    room.roundStartIndex = (room.roundStartIndex + 1) % room.baseOrder.length;
  }

  room.currentTurnIndex = room.roundStartIndex;
  const currentPlayerId = room.baseOrder[room.currentTurnIndex];

  return { room, currentPlayerId };
}

export function submitWord(
  roomCode: string,
  playerId: string, // <- ID estable, NO socketId
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

  const turnsDone =
    ((room.currentTurnIndex - room.roundStartIndex + totalAlive) % totalAlive) +
    1;

  if (turnsDone >= totalAlive) {
    room.phase = "voting";
    return {
      room,
      finishedRound: true,
      currentPlayerId: null,
      newWord,
    };
  }

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
  voterId: string, // <- ID estable
  targetId: string // <- ID estable del objetivo
): {
  room: Room;
  finishedVoting: boolean;
  eliminatedPlayer: Player | null;
  wasImpostor: boolean | null;
  winner: "players" | "impostor" | null;
  isTie: boolean;
  tieCandidates: Player[] | null;
} {
  const room = rooms.get(roomCode.toUpperCase());
  if (!room) throw new Error("ROOM_NOT_FOUND");
  if (room.phase !== "voting") throw new Error("NOT_VOTING_PHASE");

  const alive = room.players.filter((p) => p.alive);
  const totalAlive = alive.length;

  const targetPlayer = alive.find((p) => p.id === targetId);
  if (!targetPlayer) {
    throw new Error("INVALID_TARGET");
  }

  if (room.tieCandidates && !room.tieCandidates.includes(targetId)) {
    throw new Error("INVALID_TARGET_TIE");
  }

  const alreadyVoted = room.votes.find((v) => v.voterId === voterId);
  if (alreadyVoted) {
    throw new Error("ALREADY_VOTED");
  }

  room.votes.push({ voterId, targetId });

  if (room.votes.length < totalAlive) {
    return {
      room,
      finishedVoting: false,
      eliminatedPlayer: null,
      wasImpostor: null,
      winner: null,
      isTie: false,
      tieCandidates: null,
    };
  }

  const count: Record<string, number> = {};
  room.votes.forEach((v) => {
    count[v.targetId] = (count[v.targetId] || 0) + 1;
  });

  const entries = Object.entries(count);
  const maxVotes = Math.max(...entries.map(([, n]) => n));

  const topCandidateIds = entries
    .filter(([, n]) => n === maxVotes)
    .map(([id]) => id);

  if (topCandidateIds.length > 1) {
    room.tieCandidates = topCandidateIds;
    room.votes = [];

    return {
      room,
      finishedVoting: false,
      eliminatedPlayer: null,
      wasImpostor: null,
      winner: null,
      isTie: true,
      tieCandidates: room.players.filter((p) => topCandidateIds.includes(p.id)),
    };
  }

  const eliminatedId = topCandidateIds[0];
  const eliminatedPlayer = room.players.find((p) => p.id === eliminatedId)!;
  eliminatedPlayer.alive = false;

  const wasImpostor = eliminatedPlayer.id === room.impostorId;

  room.tieCandidates = null;
  room.votes = [];

  if (wasImpostor) {
    room.phase = "finished";
    room.winner = "players";

    return {
      room,
      finishedVoting: true,
      eliminatedPlayer,
      wasImpostor,
      winner: "players",
      isTie: false,
      tieCandidates: null,
    };
  }

  const aliveNow = room.players.filter((p) => p.alive);
  if (aliveNow.length === 2) {
    room.phase = "finished";
    room.winner = "impostor";

    return {
      room,
      finishedVoting: true,
      eliminatedPlayer,
      wasImpostor,
      winner: "impostor",
      isTie: false,
      tieCandidates: null,
    };
  }

  room.currentRound += 1;
  room.phase = "revealRound";

  return {
    room,
    finishedVoting: true,
    eliminatedPlayer,
    wasImpostor,
    winner: null,
    isTie: false,
    tieCandidates: null,
  };
}

export function startNextRound(roomCode: string): {
  room: Room;
  currentPlayerId: string;
} {
  const room = rooms.get(roomCode.toUpperCase());
  if (!room) throw new Error("ROOM_NOT_FOUND");
  if (room.phase !== "revealRound") throw new Error("NOT_REVEAL_ROUND");

  room.phase = "words";
  room.words = [];
  room.votes = [];

  const alive = room.players.filter((p) => p.alive);
  room.baseOrder = alive.map((p) => p.id);

  room.roundStartIndex = (room.roundStartIndex + 1) % room.baseOrder.length;
  room.currentTurnIndex = room.roundStartIndex;

  const currentPlayerId = room.baseOrder[room.currentTurnIndex];

  return {
    room,
    currentPlayerId,
  };
}

export function scheduleRoomDeletion(code: string, ms = 10 * 60 * 1000) {
  cancelRoomDeletion(code);
  const timer = setTimeout(() => {
    rooms.delete(code);
    roomDeletionTimers.delete(code);
    console.log(`[rooms] Deleted inactive room ${code}`);
  }, ms);

  roomDeletionTimers.set(code, timer);
}

export function cancelRoomDeletion(code: string) {
  const t = roomDeletionTimers.get(code);
  if (t) clearTimeout(t);
  roomDeletionTimers.delete(code);
}
