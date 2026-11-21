import crypto from "crypto";
import { CHARACTERS } from "./characters";
import { Player, Room } from "./types";
import { atomicCreateRoomScript } from "./lua";
import { readRoom, updateRoom, roomKey, ROOM_TTL_SECONDS } from "./roomStore";
import { MAX_PLAYERS_PER_ROOM } from "../constants/validation";
const DISCONNECT_GRACE_MS = 2 * 60 * 1000;

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

export async function getRoom(roomCode: string): Promise<Room | undefined> {
  return (await readRoom(roomCode)) ?? undefined;
}

export async function deleteRoom(roomCode: string, callerSocketId: string): Promise<void> {
  await updateRoom(roomCode, room => {
    const caller = room.players.find(p => p.socketId === callerSocketId);
    if (!caller?.isHost) throw new Error("ONLY_HOST_CAN_END_GAME");
  }, { remove: true });
}

/**
 * Crea una sala atómicamente con SET NX.
 * Si el código ya existe, reintenta con otro código.
 */
async function atomicCreateRoom(
  code: string,
  room: Room,
  ttlSeconds: number
): Promise<boolean> {
  const result = await atomicCreateRoomScript.exec(
    [roomKey(code)],
    [JSON.stringify(room), String(ttlSeconds)]
  );
  return result === "OK";
}

function syncSocketId(player: Player, socketId: string) {
  player.socketId = socketId;
}

export async function createRoom(
  hostSocketId: string,
  hostName: string,
  mode: "classic" | "manual" = "classic"
): Promise<{ room: Room; player: Player }> {
  // S2.1: crear sala atómicamente con SET NX para evitar colisiones de código
  for (let i = 0; i < 30; i++) {
    const code = generateRoomCode();

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
      version: 0,
      voteEpoch: 0,
      instanceId: crypto.randomUUID(),
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

    const created = await atomicCreateRoom(code, room, ROOM_TTL_SECONDS);
    if (created) {
      return { room, player: hostPlayer };
    }
    // Código ya existe, intentar con otro
  }
  throw new Error("COULD_NOT_GENERATE_ROOM_CODE");
}

export async function joinRoom(
  roomCode: string,
  socketId: string,
  name: string
): Promise<{ room: Room; player: Player }> {
  return updateRoom(roomCode, room => {
    pruneDisconnected(room);
    if (room.players.length === 0) throw new Error("ROOM_EMPTY");
    if (room.phase !== "lobby") throw new Error("GAME_ALREADY_STARTED");
    if (room.players.length >= MAX_PLAYERS_PER_ROOM) throw new Error("ROOM_FULL");

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
  });
}

export async function joinOrRejoinRoom(
  roomCode: string,
  socketId: string,
  name: string,
  playerToken?: string
): Promise<{ room: Room; player: Player; isRejoin: boolean; oldSocketId: string | null }> {
  return updateRoom(roomCode, room => {
    pruneDisconnected(room);
    if (room.players.length === 0) throw new Error("ROOM_EMPTY");

    // ✅ Si trae token, intenta reenganchar siempre (aunque la partida esté empezada)
    if (playerToken) {
      const existing = room.players.find((p) => p.token === playerToken);
      if (existing) {
        // S1.2: recordar el socket anterior para revocarlo en index.ts
        const oldSocketId = existing.socketId;

        syncSocketId(existing, socketId);
        existing.connected = true;
        existing.disconnectedAt = null;

        // Si ha cambiado nombre, opcionalmente lo actualizas:
        if (name && existing.name !== name) existing.name = name;
        return { room, player: existing, isRejoin: true, oldSocketId };
      }
      // Si el token no existe en la sala, seguimos como join normal
    }

    // ❌ Si NO hay token y la partida ya empezó: fuera
    if (room.phase !== "lobby") throw new Error("GAME_ALREADY_STARTED");
    if (room.players.length >= MAX_PLAYERS_PER_ROOM) throw new Error("ROOM_FULL");

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

    return { room, player, isRejoin: false, oldSocketId: null };
  });
}

export async function rejoinRoom(
  roomCode: string,
  token: string,
  newSocketId: string
): Promise<{ room: Room; player: Player; oldSocketId: string | null }> {
  return updateRoom(roomCode, room => {
    pruneDisconnected(room);
    if (room.players.length === 0) throw new Error("ROOM_EMPTY");

    const player = room.players.find((p) => p.token === token);
    if (!player) throw new Error("PLAYER_NOT_FOUND");

    // S1.2: recordar el socket anterior para revocarlo en index.ts
    const oldSocketId = player.socketId;

    syncSocketId(player, newSocketId);
    player.connected = true;
    player.disconnectedAt = null;
    return { room, player, oldSocketId };
  });
}

export async function markPlayerDisconnected(
  roomCode: string,
  socketId: string
) {
  return updateRoom(roomCode, room => {
    pruneDisconnected(room);
    if (room.players.length === 0) throw new Error("ROOM_EMPTY");

    const player = room.players.find((p) => p.socketId === socketId);
    if (!player) return;

    player.socketId = null;
    player.connected = false;
    player.disconnectedAt = Date.now();

    // Reasignación host "si hace falta" (pero solo a conectados)
    ensureHost(room);

  }, { missingOk: true });
}

/**
 * Si quieres mantener una función "cancelRoomDeletion" estilo antiguo:
 * -> en Redis significa: refrescar TTL largo.
 */
export async function cancelRoomDeletion(roomCode: string): Promise<void> {
  return updateRoom(roomCode, room => {
    pruneDisconnected(room);
    if (room.players.length === 0) throw new Error("ROOM_EMPTY");

    room.version = room.version ?? 0;
  }, { missingOk: true, refresh: true });
}

export async function startGame(
  roomCode: string,
  callerSocketId: string
): Promise<{
  room: Room;
  roles: {
    playerId: string;
    socketId: string | null;
    isImpostor: boolean;
    character: string | null;
  }[];
}> {
  return updateRoom(roomCode, room => {
    pruneDisconnected(room);
    if (room.players.length === 0) throw new Error("ROOM_EMPTY");
    if (room.phase !== "lobby") throw new Error("GAME_ALREADY_STARTED");

    const caller = room.players.find((p) => p.socketId === callerSocketId);
    if (!caller || !caller.isHost) throw new Error("ONLY_HOST_CAN_START");

    return assignRoles(room);
  });
}

function assignRoles(room: Room) {
  if (room.players.length < 3) throw new Error("NOT_ENOUGH_PLAYERS");

  const alivePlayers = room.players.filter((p) => p.alive);
  const impostor =
    alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
  room.impostorId = impostor.id;

  const character = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
  room.character = character;

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

  return { room, roles };
}

export async function restartGame(roomCode: string, callerSocketId: string) {
  return updateRoom(roomCode, room => {
    pruneDisconnected(room);
    if (room.players.length === 0) throw new Error("ROOM_EMPTY");
    const caller = room.players.find(p => p.socketId === callerSocketId);
    if (!caller?.isHost) throw new Error("ONLY_HOST_CAN_RESTART");
    room.players.forEach(p => { p.alive = true; });
    room.voteEpoch = (room.voteEpoch ?? 0) + 1;
    return assignRoles(room);
  });
}

export async function startWordsRound(
  roomCode: string,
  callerSocketId: string
): Promise<{ room: Room; currentPlayerId: string }> {
  return updateRoom(roomCode, room => {
    pruneDisconnected(room);
    if (room.players.length === 0) throw new Error("ROOM_EMPTY");

    ensureNotManual(room);

    // S1.3 (GAME-04): exigir fase reveal para startWordsRound
    if (room.phase !== "reveal") throw new Error("NOT_REVEAL_ROUND");

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
    return { room, currentPlayerId };
  });
}

/**
 * submitWord robusto: recibe playerId (estable) + callerSocketId (para sync)
 */
export async function submitWord(
  roomCode: string,
  playerId: string,
  callerSocketId: string,
  word: string
): Promise<{
  room: Room;
  finishedRound: boolean;
  currentPlayerId: string | null;
  newWord: { playerId: string; word: string };
}> {
  return updateRoom(roomCode, room => {
    pruneDisconnected(room);
    if (room.players.length === 0) throw new Error("ROOM_EMPTY");

    ensureNotManual(room);

    if (room.phase !== "words") throw new Error("NOT_WORDS_PHASE");

    const player = room.players.find((p) => p.id === playerId);
    if (!player) throw new Error("PLAYER_NOT_FOUND");

    // S1.2: validar que el socket que llama es la conexión vigente del jugador
    // Comparación estricta: si socketId es null (desconectado) también debe fallar.
    if (player.socketId !== callerSocketId) {
      throw new Error("UNAUTHORIZED");
    }

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
      return { room, finishedRound: true, currentPlayerId: null, newWord };
    }

    room.currentTurnIndex = (room.currentTurnIndex + 1) % totalAlive;
    const nextPlayerId = room.baseOrder[room.currentTurnIndex];
    return { room, finishedRound: false, currentPlayerId: nextPlayerId, newWord };
  });
}

/**
 * submitVote robusto: recibe voterId (estable) + callerSocketId (para sync)
 */
export async function submitVote(
  roomCode: string,
  voterId: string,
  callerSocketId: string,
  targetId: string,
  voteEpoch = 0
): Promise<{
  room: Room;
  finishedVoting: boolean;
  eliminatedPlayer: Player | null;
  wasImpostor: boolean | null;
  winner: "players" | "impostor" | null;
  isTie: boolean;
  tieCandidates: Player[] | null;
}> {
  return updateRoom(roomCode, room => {
    pruneDisconnected(room);
    if (room.players.length === 0) throw new Error("ROOM_EMPTY");

    ensureNotManual(room);

    if (room.phase !== "voting") throw new Error("NOT_VOTING_PHASE");
    if (voteEpoch !== (room.voteEpoch ?? 0)) throw new Error("STALE_VOTE");

    const voter = room.players.find((p) => p.id === voterId);
    if (!voter) throw new Error("PLAYER_NOT_FOUND");
    if (!voter.alive) throw new Error("PLAYER_DEAD");
    if (!voter.connected) throw new Error("PLAYER_DISCONNECTED");

    // S1.2: validar que el socket que llama es la conexión vigente del jugador
    // Comparación estricta: si socketId es null (desconectado) también debe fallar.
    if (voter.socketId !== callerSocketId) {
      throw new Error("UNAUTHORIZED");
    }

    const eligibleVoters = room.players.filter((p) => p.alive && p.connected);
    const totalEligible = eligibleVoters.length;

    const targetPlayer = room.players.find((p) => p.alive && p.id === targetId);
    if (!targetPlayer) throw new Error("INVALID_TARGET");

    if (room.tieCandidates && Array.isArray(room.tieCandidates)) {
      const tieIds = (room.tieCandidates as any[]).map((x) =>
        typeof x === "string" ? x : x.id
      );
      if (!tieIds.includes(targetId)) throw new Error("INVALID_TARGET_TIE");
    }

    const alreadyVoted = room.votes.find((v: any) => v.voterId === voter.id);
    if (alreadyVoted) throw new Error("ALREADY_VOTED");

    room.votes.push({ voterId: voter.id, targetId });

    const eligibleIds = new Set(eligibleVoters.map((p) => p.id));
    room.votes = room.votes.filter((v) => eligibleIds.has(v.voterId));

    if (room.votes.length < totalEligible) {
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
      room.voteEpoch = (room.voteEpoch ?? 0) + 1;
      room.votes = [];

      const candidates = room.players.filter((p) =>
        topCandidateIds.includes(p.id)
      );

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
  });
}

export async function startNextRound(
  roomCode: string,
  callerSocketId: string
): Promise<{ room: Room; currentPlayerId: string }> {
  return updateRoom(roomCode, room => {
    pruneDisconnected(room);
    if (room.players.length === 0) throw new Error("ROOM_EMPTY");

    const caller = room.players.find(p => p.socketId === callerSocketId);
    if (!caller?.isHost) throw new Error("ONLY_HOST_CAN_START");
    ensureNotManual(room);

    if (room.phase !== "revealRound") throw new Error("NOT_REVEAL_ROUND");

    room.phase = "words";
    room.words = [];
    room.votes = [];
    room.voteEpoch = (room.voteEpoch ?? 0) + 1;

    const alive = room.players.filter((p) => p.alive);
    room.baseOrder = alive.map((p) => p.id);

    room.roundStartIndex = (room.roundStartIndex + 1) % room.baseOrder.length;
    room.currentTurnIndex = room.roundStartIndex;

    const currentPlayerId = room.baseOrder[room.currentTurnIndex];
    return { room, currentPlayerId };
  });
}

function ensureNotManual(room: Room) {
  if (room.mode === "manual") throw new Error("MANUAL_MODE_ONLY_ROLES");
}
