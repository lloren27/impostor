import "dotenv/config";
import crypto from "crypto";
import { Redis } from "@upstash/redis";
import { CHARACTERS } from "./characters";
import { Player, Room } from "./types";
import { getRandomCharacter } from "./characters/index";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// TTLs
const ROOM_TTL_SECONDS = 60 * 60 * 2;
const ROOM_EMPTY_TTL_SECONDS = 60 * 10;
const DISCONNECT_GRACE_MS = 2 * 60 * 1000;

function roomKey(code: string) {
  return `room:${code.toUpperCase()}`;
}

function generatePlayerToken(): string {
  return (
    crypto?.randomUUID?.() ??
    Date.now().toString(36) + Math.random().toString(36).slice(2)
  );
}

function ensureHost(room: Room) {
  const connectedPlayers = room.players.filter((p) => p.connected);
  const hasConnectedHost = connectedPlayers.some((p) => p.isHost);

  if (hasConnectedHost) return;

  // si no hay host conectado, asigna al más antiguo conectado
  const nextHost = connectedPlayers.sort((a, b) => a.joinedAt - b.joinedAt)[0];
  if (!nextHost) return;

  room.players.forEach((p) => (p.isHost = false));
  nextHost.isHost = true;
}

function pruneDisconnected(room: Room) {
  if (room.phase !== "lobby") {
    ensureHost(room);
    return;
  }

  const now = Date.now();

  room.players = room.players.filter((p) => {
    if (p.connected) return true;
    if (!p.disconnectedAt) return true;
    return now - p.disconnectedAt < DISCONNECT_GRACE_MS;
  });

  ensureHost(room);
}

function generatePlayerId(): string {
  return (
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10)
  );
}

function generateRoomCode(): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 4; i++)
    code += letters[Math.floor(Math.random() * letters.length)];
  return code;
}

async function loadRoom(roomCode: string): Promise<Room | null> {
  const room = await redis.get<Room>(roomKey(roomCode));
  if (!room) return null;

  pruneDisconnected(room);

  // Si tras prune no queda nadie, puedes borrar la sala
  if (room.players.length === 0) {
    await redis.del(roomKey(room.code));
    return null;
  }

  // Persistimos el prune (importante)
  await saveRoom(
    room,
    room.players.some((p) => p.connected)
      ? ROOM_TTL_SECONDS
      : ROOM_EMPTY_TTL_SECONDS,
  );

  return room;
}

async function saveRoom(
  room: Room,
  ttlSeconds = ROOM_TTL_SECONDS,
): Promise<void> {
  await redis.set(roomKey(room.code), room, { ex: ttlSeconds });
}

export async function getRoom(roomCode: string): Promise<Room | undefined> {
  const room = await loadRoom(roomCode);
  return room ?? undefined;
}

export async function deleteRoom(roomCode: string): Promise<void> {
  await redis.del(roomKey(roomCode));
}

async function createUniqueRoomCode(): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const code = generateRoomCode();
    const exists = await redis.exists(roomKey(code));
    if (!exists) return code;
  }
  throw new Error("COULD_NOT_GENERATE_ROOM_CODE");
}

function syncSocketId(player: Player, socketId: string) {
  player.socketId = socketId;
}

export async function createRoom(
  hostSocketId: string,
  hostName: string,
  mode: "classic" | "manual" = "classic",
): Promise<{ room: Room; player: Player }> {
  const code = await createUniqueRoomCode();

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
    mode,
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

  await saveRoom(room);
  return { room, player: hostPlayer };
}

export async function joinRoom(
  roomCode: string,
  socketId: string,
  name: string,
): Promise<{ room: Room; player: Player }> {
  const room = await loadRoom(roomCode);
  if (!room) throw new Error("ROOM_NOT_FOUND");
  if (room.phase !== "lobby") throw new Error("GAME_ALREADY_STARTED");

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
  await saveRoom(room);

  return { room, player };
}

export async function joinOrRejoinRoom(
  roomCode: string,
  socketId: string,
  name: string,
  playerToken?: string,
): Promise<{ room: Room; player: Player; isRejoin: boolean }> {
  const room = await loadRoom(roomCode);
  if (!room) throw new Error("ROOM_NOT_FOUND");

  // ✅ Si trae token, intenta reenganchar siempre (aunque la partida esté empezada)
  if (playerToken) {
    const existing = room.players.find((p) => p.token === playerToken);
    if (existing) {
      syncSocketId(existing, socketId);
      existing.connected = true;
      existing.disconnectedAt = null;

      // Si ha cambiado nombre, opcionalmente lo actualizas:
      if (name && existing.name !== name) existing.name = name;

      await saveRoom(room, ROOM_TTL_SECONDS);
      return { room, player: existing, isRejoin: true };
    }
    // Si el token no existe en la sala, seguimos como join normal (o puedes lanzar PLAYER_NOT_FOUND)
  }

  // ❌ Si NO hay token y la partida ya empezó: fuera
  if (room.phase !== "lobby") throw new Error("GAME_ALREADY_STARTED");

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
  await saveRoom(room);

  return { room, player, isRejoin: false };
}

export async function rejoinRoom(
  roomCode: string,
  token: string,
  newSocketId: string,
): Promise<{ room: Room; player: Player }> {
  const room = await loadRoom(roomCode);
  if (!room) throw new Error("ROOM_NOT_FOUND");

  const player = room.players.find((p) => p.token === token);
  if (!player) throw new Error("PLAYER_NOT_FOUND");

  syncSocketId(player, newSocketId);
  player.connected = true;
  player.disconnectedAt = null;

  await saveRoom(room, ROOM_TTL_SECONDS);
  return { room, player };
}

export async function markPlayerDisconnected(
  roomCode: string,
  socketId: string,
) {
  const room = await loadRoom(roomCode);
  if (!room) return;

  const player = room.players.find((p) => p.socketId === socketId);
  if (!player) return;

  player.socketId = null;
  player.connected = false;
  player.disconnectedAt = Date.now();

  // Reasignación host “si hace falta” (pero solo a conectados)
  ensureHost(room);

  const anyConnected = room.players.some((p) => p.connected);
  await saveRoom(
    room,
    anyConnected ? ROOM_TTL_SECONDS : ROOM_EMPTY_TTL_SECONDS,
  );
}

/**
 * Si quieres mantener una función "cancelRoomDeletion" estilo antiguo:
 * -> en Redis significa: refrescar TTL largo.
 */
export async function cancelRoomDeletion(roomCode: string): Promise<void> {
  const room = await loadRoom(roomCode);
  if (!room) return;
  await saveRoom(room, ROOM_TTL_SECONDS);
}

export async function startGame(
  roomCode: string,
  callerSocketId: string,
): Promise<{
  room: Room;
  roles: {
    playerId: string;
    socketId: string | null;
    isImpostor: boolean;
    character: string | null;
  }[];
}> {
  const room = await loadRoom(roomCode);
  if (!room) throw new Error("ROOM_NOT_FOUND");
  if (room.phase !== "lobby") throw new Error("GAME_ALREADY_STARTED");

  const caller = room.players.find((p) => p.socketId === callerSocketId);
  if (!caller || !caller.isHost) throw new Error("ONLY_HOST_CAN_START");

  if (room.players.length < 3) throw new Error("NOT_ENOUGH_PLAYERS");

  const alivePlayers = room.players.filter((p) => p.alive);
  const impostor =
    alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
  room.impostorId = impostor.id;

  // const character = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
  // room.character = character;

  const picked = getRandomCharacter({
    ambit: "sports",
    difficulty: 1,
    onlyActive: true,
  });

  const roles = room.players.map((p) => {
    const isImpostor = p.id === impostor.id;
    p.isImpostor = isImpostor;
    p.character = isImpostor ? null : character;
    p.alive = true;

    return {
      playerId: p.id,
      socketId: p.socketId,
      isImpostor,
      character: p.character,
    };
  });

  room.phase = "reveal";
  room.currentRound = 1;
  room.words = [];
  room.votes = [];
  room.winner = null;
  room.tieCandidates = null;

  room.baseOrder = room.players.filter((p) => p.alive).map((p) => p.id);
  room.roundStartIndex = 0;
  room.currentTurnIndex = 0;

  await saveRoom(room);
  return { room, roles };
}

export async function restartGame(roomCode: string, callerSocketId: string) {
  const room = await loadRoom(roomCode);
  if (!room) throw new Error("ROOM_NOT_FOUND");

  const caller = room.players.find((p) => p.socketId === callerSocketId);
  if (!caller || !caller.isHost) throw new Error("ONLY_HOST_CAN_RESTART");

  // ✅ reset común
  room.currentRound = 0;
  room.words = [];
  room.votes = [];
  room.winner = null;
  room.character = null;
  room.impostorId = null;
  room.baseOrder = [];
  room.roundStartIndex = 0;
  room.currentTurnIndex = 0;
  room.tieCandidates = null;

  room.players.forEach((p) => {
    p.alive = true;
    p.isImpostor = false;
    p.character = null;
  });

  // ✅ comportamiento por modo
  if (room.mode === "manual") {
    // no vuelvas a lobby, permite restart estando ya en reveal
    // dejamos la sala en reveal (o incluso puedes dejarla en lobby, pero UX peor)
    room.phase = "reveal";
    await saveRoom(room);
    // startGame exige lobby -> NO lo llames
    // en manual, simplemente reasignas roles aquí mismo (reutiliza lógica de startGame)
    // => mejor: factorizar assignRoles(room)
  } else {
    room.phase = "lobby";
    await saveRoom(room);
    return startGame(roomCode, callerSocketId);
  }

  // ✅ reasignar roles en manual (copias la parte central de startGame)
  if (room.players.length < 3) throw new Error("NOT_ENOUGH_PLAYERS");

  const alivePlayers = room.players.filter((p) => p.alive);
  const impostor =
    alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
  room.impostorId = impostor.id;

  // const character = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
  // room.character = character;

  const picked = getRandomCharacter({
    ambit: "sports",
    difficulty: 1,
    onlyActive: true,
  });

  const roles = room.players.map((p) => {
    const isImpostor = p.id === impostor.id;
    p.isImpostor = isImpostor;
    p.character = isImpostor ? null : character;
    p.alive = true;

    return {
      playerId: p.id,
      socketId: p.socketId,
      isImpostor,
      character: p.character,
    };
  });

  room.phase = "reveal";
  room.currentRound = 1;

  await saveRoom(room);
  return { room, roles };
}

export async function startWordsRound(
  roomCode: string,
  callerSocketId: string,
): Promise<{ room: Room; currentPlayerId: string }> {
  const room = await loadRoom(roomCode);
  if (!room) throw new Error("ROOM_NOT_FOUND");

  ensureNotManual(room);

  const caller = room.players.find((p) => p.socketId === callerSocketId);
  if (!caller || !caller.isHost) throw new Error("ONLY_HOST_CAN_START");

  const alive = room.players.filter((p) => p.alive);
  if (alive.length < 2) throw new Error("NOT_ENOUGH_ALIVE_PLAYERS");

  room.phase = "words";
  room.words = [];
  room.votes = [];

  room.baseOrder = alive.map((p) => p.id);

  if (room.currentRound === 1) {
    room.roundStartIndex = Math.floor(Math.random() * room.baseOrder.length);
  } else {
    room.roundStartIndex = (room.roundStartIndex + 1) % room.baseOrder.length;
  }

  room.currentTurnIndex = room.roundStartIndex;
  const currentPlayerId = room.baseOrder[room.currentTurnIndex];

  await saveRoom(room);
  return { room, currentPlayerId };
}

/**
 * submitWord robusto: recibe playerId (estable) + callerSocketId (para sync)
 */
export async function submitWord(
  roomCode: string,
  playerId: string,
  callerSocketId: string,
  word: string,
): Promise<{
  room: Room;
  finishedRound: boolean;
  currentPlayerId: string | null;
  newWord: { playerId: string; word: string };
}> {
  const room = await loadRoom(roomCode);
  if (!room) throw new Error("ROOM_NOT_FOUND");

  ensureNotManual(room);

  if (room.phase !== "words") throw new Error("NOT_WORDS_PHASE");

  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw new Error("PLAYER_NOT_FOUND");

  // sync socketId por si hubo reconexión
  syncSocketId(player, callerSocketId);

  const totalAlive = room.baseOrder.length;
  if (totalAlive === 0) throw new Error("NO_ALIVE_PLAYERS");

  const currentPlayerId = room.baseOrder[room.currentTurnIndex];
  if (player.id !== currentPlayerId) throw new Error("NOT_YOUR_TURN");

  const newWord = { playerId: player.id, word };
  room.words.push(newWord);

  const turnsDone =
    ((room.currentTurnIndex - room.roundStartIndex + totalAlive) % totalAlive) +
    1;

  if (turnsDone >= totalAlive) {
    room.phase = "voting";
    await saveRoom(room);
    return { room, finishedRound: true, currentPlayerId: null, newWord };
  }

  room.currentTurnIndex = (room.currentTurnIndex + 1) % totalAlive;
  const nextPlayerId = room.baseOrder[room.currentTurnIndex];

  await saveRoom(room);
  return { room, finishedRound: false, currentPlayerId: nextPlayerId, newWord };
}

/**
 * submitVote robusto: recibe voterId (estable) + callerSocketId (para sync)
 */
export async function submitVote(
  roomCode: string,
  voterId: string,
  callerSocketId: string,
  targetId: string,
): Promise<{
  room: Room;
  finishedVoting: boolean;
  eliminatedPlayer: Player | null;
  wasImpostor: boolean | null;
  winner: "players" | "impostor" | null;
  isTie: boolean;
  tieCandidates: Player[] | null;
}> {
  const room = await loadRoom(roomCode);
  if (!room) throw new Error("ROOM_NOT_FOUND");

  ensureNotManual(room);

  if (room.phase !== "voting") throw new Error("NOT_VOTING_PHASE");

  const voter = room.players.find((p) => p.id === voterId);
  if (!voter) throw new Error("PLAYER_NOT_FOUND");
  if (!voter.alive) throw new Error("PLAYER_DEAD");
  if (!voter.connected) throw new Error("PLAYER_DISCONNECTED");

  syncSocketId(voter, callerSocketId);

  const eligibleVoters = room.players.filter((p) => p.alive && p.connected);
  const totalEligible = eligibleVoters.length;

  const targetPlayer = room.players.find((p) => p.alive && p.id === targetId);
  if (!targetPlayer) throw new Error("INVALID_TARGET");

  if (room.tieCandidates && Array.isArray(room.tieCandidates)) {
    const tieIds = (room.tieCandidates as any[]).map((x) =>
      typeof x === "string" ? x : x.id,
    );
    if (!tieIds.includes(targetId)) throw new Error("INVALID_TARGET_TIE");
  }

  const alreadyVoted = room.votes.find((v: any) => v.voterId === voter.id);
  if (alreadyVoted) throw new Error("ALREADY_VOTED");

  room.votes.push({ voterId: voter.id, targetId });

  const eligibleIds = new Set(eligibleVoters.map((p) => p.id));
  room.votes = room.votes.filter((v) => eligibleIds.has(v.voterId));

  if (room.votes.length < totalEligible) {
    await saveRoom(room);
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
  room.votes.forEach((v: any) => {
    count[v.targetId] = (count[v.targetId] || 0) + 1;
  });

  const entries = Object.entries(count);
  const maxVotes = Math.max(...entries.map(([, n]) => n));
  const topCandidateIds = entries
    .filter(([, n]) => n === maxVotes)
    .map(([id]) => id);

  if (topCandidateIds.length > 1) {
    room.tieCandidates = topCandidateIds as any;
    room.votes = [];

    const candidates = room.players.filter((p) =>
      topCandidateIds.includes(p.id),
    );
    await saveRoom(room);

    return {
      room,
      finishedVoting: false,
      eliminatedPlayer: null,
      wasImpostor: null,
      winner: null,
      isTie: true,
      tieCandidates: candidates,
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
    await saveRoom(room);
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
    await saveRoom(room);
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
  await saveRoom(room);

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

export async function startNextRound(
  roomCode: string,
): Promise<{ room: Room; currentPlayerId: string }> {
  const room = await loadRoom(roomCode);
  if (!room) throw new Error("ROOM_NOT_FOUND");

  ensureNotManual(room);

  if (room.phase !== "revealRound") throw new Error("NOT_REVEAL_ROUND");

  room.phase = "words";
  room.words = [];
  room.votes = [];

  const alive = room.players.filter((p) => p.alive);
  room.baseOrder = alive.map((p) => p.id);

  room.roundStartIndex = (room.roundStartIndex + 1) % room.baseOrder.length;
  room.currentTurnIndex = room.roundStartIndex;

  const currentPlayerId = room.baseOrder[room.currentTurnIndex];

  await saveRoom(room);
  return { room, currentPlayerId };
}

function ensureNotManual(room: Room) {
  if (room.mode === "manual") throw new Error("MANUAL_MODE_ONLY_ROLES");
}
