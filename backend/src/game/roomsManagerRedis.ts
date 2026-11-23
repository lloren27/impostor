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
      lastEliminatedId: null,
      lastEliminatedName: null,
      lastEliminatedWasImpostor: null,
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
): Promise<{ room: Room; player: Player; isRejoin: boolean; oldSocketId: string | null; currentPlayerId?: string | null }> {
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
        const currentPlayerId = recoverTurnOnRejoin(room);
        return { room, player: existing, isRejoin: true, oldSocketId, currentPlayerId };
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
): Promise<{ room: Room; player: Player; oldSocketId: string | null; currentPlayerId?: string | null }> {
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
    const currentPlayerId = recoverTurnOnRejoin(room);
    return { room, player, oldSocketId, currentPlayerId };
  });
}

function recoverTurnOnRejoin(room: Room): string | null | undefined {
  if (room.phase !== "words") return undefined;
  const currentId = room.baseOrder[room.currentTurnIndex];
  if (room.players.some(p => p.id === currentId && p.connected)) return undefined;
  return advanceToConnectedTurn(room);
}

export async function markPlayerDisconnected(
  roomCode: string,
  socketId: string
): Promise<{
  room: Room;
  voteResolved?: {
    eliminatedPlayer: Player | null;
    wasImpostor: boolean | null;
    winner: "players" | "impostor" | null;
    isTie: boolean;
    tieCandidates: Player[] | null;
  };
  currentPlayerId?: string | null;
} | undefined> {
  return updateRoom(roomCode, room => {
    pruneDisconnected(room);
    if (room.players.length === 0) throw new Error("ROOM_EMPTY");

    const player = room.players.find((p) => p.socketId === socketId);
    if (player) {
      player.socketId = null;
      player.connected = false;
      player.disconnectedAt = Date.now();
    }

    // Reasignación host "si hace falta" (pero solo a conectados)
    ensureHost(room);

    // S3.3: si la fase es voting, verificar si la votación puede resolverse
    // porque un votante elegible se desconectó. Esta comprobación se ejecuta
    // incluso si el jugador ya estaba marcado como desconectado en Redis
    // (por ejemplo, si otro proceso ya lo actualizó).
    if (room.phase === "voting") {
      const eligibleVoters = room.players.filter((p) => p.alive && p.connected);
      const eligibleIds = new Set(eligibleVoters.map((p) => p.id));
      // Filtrar votos de jugadores ya no elegibles
      const filteredVotes = room.votes.filter((v) => eligibleIds.has(v.voterId));
      const votesChanged = filteredVotes.length !== room.votes.length;
      room.votes = filteredVotes;

      // Si los votos restantes ya cubren a todos los elegibles conectados,
      // resolver la votación
      if (room.votes.length >= eligibleVoters.length && eligibleVoters.length > 0) {
        const result = resolvePendingVote(room);
        return { room, voteResolved: result };
      }

      // Si no se resolvió y no hubo cambios en los votos, evitar guardar
      // la sala innecesariamente (evita conflictos con submitVote)
      if (!votesChanged && !player) {
        // No hay cambios: retornar sin modificar la sala
        // (updateRoom detectará que room no cambió y no guardará)
      }
    }

    // S3.3: si la fase es words o revealRound y el jugador que se desconectó
    // tenía el turno, avanzar al siguiente jugador conectado.
    if (room.phase === "words" || room.phase === "revealRound") {
      const currentPlayerId = advanceToConnectedTurn(room);
      return { room, currentPlayerId };
    }

    return { room };
  }, { missingOk: true });
}

/**
 * S3.1 — removePlayerFromPreviousRoom: elimina al jugador de la sala anterior
 * en Redis cuando cambia de sala (createRoom/joinRoom). Si la sala estaba en
 * votación, verifica si la partida puede resolverse sin ese jugador.
 * Retorna la sala actualizada y, si aplica, el resultado de la votación.
 */
export async function removePlayerFromPreviousRoom(
  roomCode: string,
  playerId: string
): Promise<{
  room: Room;
  voteResolved?: {
    eliminatedPlayer: Player | null;
    wasImpostor: boolean | null;
    winner: "players" | "impostor" | null;
    isTie: boolean;
    tieCandidates: Player[] | null;
  };
} | undefined> {
  return updateRoom(roomCode, room => {
    if (room.players.length === 0) throw new Error("ROOM_EMPTY");
    const idx = room.players.findIndex((p) => p.id === playerId);
    if (idx === -1) return { room };
    const [departedPlayer] = room.players.splice(idx, 1);
    if (room.players.length === 0) {
      throw new Error("ROOM_EMPTY");
    }
    ensureHost(room);

    // Si la sala estaba en votación, verificar si puede resolverse
    // sin el jugador que se fue
    if (room.phase === "voting") {
      const eligibleVoters = room.players.filter((p) => p.alive && p.connected);
      const eligibleIds = new Set(eligibleVoters.map((p) => p.id));
      // Filtrar votos de jugadores ya no elegibles (incluido el que se fue)
      const filteredVotes = room.votes.filter((v) => eligibleIds.has(v.voterId));
      room.votes = filteredVotes;

      // Si había votos contra quien abandona, su salida resuelve la ronda:
      // ese candidato ya no puede participar en una votación posterior.
      const departedWasVoted = room.votes.some(v => v.targetId === departedPlayer.id);
      if (eligibleVoters.length > 0 &&
          (departedWasVoted || room.votes.length >= eligibleVoters.length)) {
        const result = resolvePendingVote(room, departedPlayer, departedWasVoted);
        return { room, voteResolved: result };
      }
    }

    return { room };
  }, { missingOk: true });
}

/**
 * S3.3 — resolvePendingVote: resuelve la votación con los votos actuales
 * sin añadir uno nuevo. Se usa cuando un votante se desconecta y los votos
 * restantes ya cubren a todos los elegibles.
 */
function resolvePendingVote(room: Room, departedPlayer?: Player, departedWasVoted = false): {
  eliminatedPlayer: Player | null;
  wasImpostor: boolean | null;
  winner: "players" | "impostor" | null;
  isTie: boolean;
  tieCandidates: Player[] | null;
} {
  const count: Record<string, number> = {};
  room.votes.forEach((v: any) => {
    count[v.targetId] = (count[v.targetId] || 0) + 1;
  });

  const entries = Object.entries(count);
  if (entries.length === 0) {
    return {
      eliminatedPlayer: null,
      wasImpostor: null,
      winner: null,
      isTie: false,
      tieCandidates: null,
    };
  }

  const maxVotes = Math.max(...entries.map(([, n]) => n));
  const topCandidateIds = entries
    .filter(([, n]) => n === maxVotes)
    .map(([id]) => id);

  if (topCandidateIds.length > 1 && !departedWasVoted &&
      !topCandidateIds.includes(departedPlayer?.id ?? "")) {
    room.tieCandidates = topCandidateIds as any;
    room.voteEpoch = (room.voteEpoch ?? 0) + 1;
    room.votes = [];
    const candidates = room.players.filter((p) =>
      topCandidateIds.includes(p.id)
    );
    return {
      eliminatedPlayer: null,
      wasImpostor: null,
      winner: null,
      isTie: true,
      tieCandidates: candidates,
    };
  }

  // Un jugador que abandona la sala no puede participar en un desempate.
  const eliminatedId = departedWasVoted || topCandidateIds.includes(departedPlayer?.id ?? "")
    ? departedPlayer!.id
    : topCandidateIds[0];
  const eliminatedPlayer = room.players.find((p) => p.id === eliminatedId) ??
    (departedPlayer?.id === eliminatedId ? departedPlayer : undefined);
  if (!eliminatedPlayer) throw new Error("PLAYER_NOT_FOUND");
  eliminatedPlayer.alive = false;

  const wasImpostor = eliminatedPlayer.id === room.impostorId;

  room.tieCandidates = null;
  room.votes = [];
  room.lastEliminatedId = eliminatedId;
  room.lastEliminatedName = eliminatedPlayer.name;
  room.lastEliminatedWasImpostor = wasImpostor;

  if (wasImpostor) {
    room.phase = "finished";
    room.winner = "players";
    return { eliminatedPlayer, wasImpostor, winner: "players", isTie: false, tieCandidates: null };
  }

  const aliveNow = room.players.filter((p) => p.alive);
  if (aliveNow.length === 2) {
    room.phase = "finished";
    room.winner = "impostor";
    return { eliminatedPlayer, wasImpostor, winner: "impostor", isTie: false, tieCandidates: null };
  }

  room.currentRound += 1;
  room.phase = "revealRound";
  return { eliminatedPlayer, wasImpostor, winner: null, isTie: false, tieCandidates: null };
}

/**
 * S3.1 — leaveRoom: el jugador abandona explícitamente la sala.
 * Lo elimina del array de jugadores, reasigna el host si es necesario
 * y borra la sala si queda vacía (mediante ROOM_EMPTY que updateRoom detecta).
 */
export async function leaveRoom(
  roomCode: string,
  socketId: string
): Promise<{ room: Room | null; playerRemoved: boolean }> {
  return updateRoom(roomCode, room => {
    if (room.players.length === 0) throw new Error("ROOM_EMPTY");

    const playerIndex = room.players.findIndex((p) => p.socketId === socketId);
    if (playerIndex === -1) {
      // El socket ya no está asociado (posible salida repetida o desconexión previa)
      return { room, playerRemoved: false };
    }

    room.players.splice(playerIndex, 1);

    // Si la sala queda vacía, lanzar ROOM_EMPTY para que updateRoom la borre
    if (room.players.length === 0) {
      throw new Error("ROOM_EMPTY");
    }

    // Reasignar host si el que sale era el anfitrión
    ensureHost(room);

    return { room, playerRemoved: true };
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
  room.lastEliminatedId = null;
  room.lastEliminatedName = null;
  room.lastEliminatedWasImpostor = null;

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
): Promise<{ room: Room; currentPlayerId: string | null }> {
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

    // S3.3: no asignar turno inicial a un jugador desconectado
    const currentPlayerId = advanceToConnectedTurn(room);
    return { room, currentPlayerId };
  });
}

/**
 * S3.3 — Avanza currentTurnIndex hasta encontrar un jugador conectado.
 * Si todos están desconectados, devuelve null sin modificar el índice.
 */
function advanceToConnectedTurn(room: Room): string | null {
  const totalAlive = room.baseOrder.length;
  if (totalAlive === 0) return null;

  // Intentar hasta totalAlive posiciones; si no hay nadie conectado, devolver null
  for (let i = 0; i < totalAlive; i++) {
    const candidateId = room.baseOrder[room.currentTurnIndex];
    const candidate = room.players.find((p) => p.id === candidateId);
    if (candidate && candidate.connected) {
      return candidateId;
    }
    // Avanzar al siguiente
    room.currentTurnIndex = (room.currentTurnIndex + 1) % totalAlive;
  }
  return null;
}

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

    // S3.3 fix: contar palabras de jugadores conectados para la condición de cierre
    // en vez de usar distancia de índices (que incluye desconectados).
    const connectedInOrder = room.baseOrder.filter(
      (id) => room.players.find((p) => p.id === id)?.connected
    );
    const wordsByConnected = room.words.filter(
      (w) => connectedInOrder.includes(w.playerId)
    ).length;

    // La ronda termina cuando todos los conectados han escrito una palabra
    if (wordsByConnected >= connectedInOrder.length) {
      room.phase = "voting";
      return { room, finishedRound: true, currentPlayerId: null, newWord };
    }

    room.currentTurnIndex = (room.currentTurnIndex + 1) % totalAlive;

    // S3.3: avanzar al siguiente jugador conectado
    const nextPlayerId = advanceToConnectedTurn(room);
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

    const eligibleIds = new Set(eligibleVoters.map((p) => p.id));
    room.votes = room.votes.filter((v) => eligibleIds.has(v.voterId));

    // S3.3: si todos los elegibles ya votaron (por ejemplo, un votante se
    // desconectó y su voto fue filtrado), resolver la votación antes de
    // procesar el voto del jugador actual.
    if (room.votes.length >= totalEligible) {
      // El votante actual ya no cuenta como pendiente; si ya votó,
      // no necesita enviar otro voto — la votación se resuelve con los votos existentes.
      const alreadyVoted = room.votes.find((v: any) => v.voterId === voter.id);
      if (alreadyVoted) {
        // El jugador ya votó y la votación puede resolverse
        // (no necesita enviar un nuevo voto).
        // Caer en la lógica de resolución más abajo.
      } else {
        // El jugador no ha votado pero los votos existentes ya cubren
        // a todos los elegibles (incluido este jugador si vota ahora).
        // Añadir el voto y continuar.
        room.votes.push({ voterId: voter.id, targetId });
      }
      // votes.length >= totalEligible: saltar la comprobación y resolver.
    } else {
      // Votación aún pendiente: verificar si el jugador ya votó.
      const alreadyVoted = room.votes.find((v: any) => v.voterId === voter.id);
      if (alreadyVoted) throw new Error("ALREADY_VOTED");

      room.votes.push({ voterId: voter.id, targetId });

      // Re-filtrar después de añadir el voto (por si elegibilidad cambió)
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
    room.lastEliminatedId = eliminatedId;
    room.lastEliminatedName = eliminatedPlayer.name;
    room.lastEliminatedWasImpostor = wasImpostor;

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
): Promise<{ room: Room; currentPlayerId: string | null }> {
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

    // S3.3: no asignar turno inicial a un jugador desconectado
    const currentPlayerId = advanceToConnectedTurn(room);
    return { room, currentPlayerId };
  });
}

function ensureNotManual(room: Room) {
  if (room.mode === "manual") throw new Error("MANUAL_MODE_ONLY_ROLES");
}
