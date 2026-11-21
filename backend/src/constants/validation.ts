import { settings } from "../config";
/**
 * S2.2 — Validación de entradas y límites de uso.
 *
 * Todas las entradas del cliente se validan antes de acceder a Redis.
 * TypeScript no valida mensajes recibidos por Socket.IO.
 */

// Límites configurables
export const MAX_NAME_LENGTH = settings.maxName;
export const MIN_NAME_LENGTH = 1;
export const MAX_WORD_LENGTH = settings.maxWord;
export const MIN_WORD_LENGTH = 1;
export const MAX_PLAYERS_PER_ROOM = settings.maxPlayers;
export const MAX_ROOM_CODE_LENGTH = 10;
export const MAX_TOKEN_LENGTH = 200;

/**
 * Valida el nombre de un jugador.
 * Debe ser un string de 1-30 caracteres tras trim.
 */
export function validateName(name: unknown): string {
  if (typeof name !== "string") {
    throw new Error("INVALID_NAME");
  }
  const trimmed = name.trim();
  if (trimmed.length < MIN_NAME_LENGTH || trimmed.length > MAX_NAME_LENGTH) {
    throw new Error("INVALID_NAME");
  }
  return trimmed;
}

/**
 * Valida una palabra enviada por un jugador.
 * Debe ser un string de 1-80 caracteres tras trim.
 */
export function validateWord(word: unknown): string {
  if (typeof word !== "string") {
    throw new Error("INVALID_WORD");
  }
  const trimmed = word.trim();
  if (trimmed.length < MIN_WORD_LENGTH || trimmed.length > MAX_WORD_LENGTH) {
    throw new Error("INVALID_WORD");
  }
  return trimmed;
}

/**
 * Valida el código de sala.
 * Debe ser un string alfanumérico de 2-10 caracteres.
 */
export function validateRoomCode(roomCode: unknown): string {
  if (typeof roomCode !== "string") {
    throw new Error("INVALID_ROOM_CODE");
  }
  const code = roomCode.trim().toUpperCase();
  if (code.length < 2 || code.length > MAX_ROOM_CODE_LENGTH) {
    throw new Error("INVALID_ROOM_CODE");
  }
  if (!/^[A-Z0-9]+$/.test(code)) {
    throw new Error("INVALID_ROOM_CODE");
  }
  return code;
}

/**
 * Valida el token de jugador.
 * Debe ser un string no vacío.
 */
export function validatePlayerToken(token: unknown): string {
  if (typeof token !== "string") {
    throw new Error("INVALID_TOKEN");
  }
  if (token.trim().length === 0 || token.length > MAX_TOKEN_LENGTH) {
    throw new Error("INVALID_TOKEN");
  }
  return token;
}

/**
 * Valida el modo de juego.
 * Debe ser "classic" o "manual".
 */
export function validateMode(mode: unknown): "classic" | "manual" {
  if (mode === "classic" || mode === "manual") {
    return mode;
  }
  throw new Error("INVALID_MODE");
}

/**
 * Valida un playerId.
 * Debe ser un string no vacío.
 */
export function validatePlayerId(id: unknown): string {
  if (typeof id !== "string" || id.trim().length === 0 || id.length > 128) {
    throw new Error("INVALID_PLAYER_ID");
  }
  return id;
}

/**
 * Valida un socketId.
 * Debe ser un string no vacío.
 */
export function validateSocketId(id: unknown): string {
  if (typeof id !== "string" || id.trim().length === 0 || id.length > 128) {
    throw new Error("INVALID_SOCKET_ID");
  }
  return id;
}

/** Validar el sobre antes de cualquier acceso a propiedades o Redis. */
export function validateEvent(event: string, payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("INVALID_PAYLOAD");
  const p = payload as Record<string, unknown>;
  switch (event) {
    case "createRoom":
      return { name: validateName(p.name), mode: p.mode === undefined ? "classic" : validateMode(p.mode) };
    case "joinRoom":
      return { roomCode: validateRoomCode(p.roomCode), name: validateName(p.name),
        playerToken: p.playerToken === undefined ? undefined : validatePlayerToken(p.playerToken) };
    case "rejoinRoom":
      return { roomCode: validateRoomCode(p.roomCode), playerToken: validatePlayerToken(p.playerToken) };
    case "submitWord":
      return { roomCode: validateRoomCode(p.roomCode), playerId: validatePlayerId(p.playerId), word: validateWord(p.word) };
    case "submitVote":
      return { roomCode: validateRoomCode(p.roomCode), voterId: validatePlayerId(p.voterId), targetId: validatePlayerId(p.targetId),
        voteEpoch: p.voteEpoch === undefined ? 0 : Number.isSafeInteger(p.voteEpoch) && (p.voteEpoch as number) >= 0 ? p.voteEpoch : (() => { throw new Error("INVALID_VOTE_EPOCH"); })() };
    case "startGame": case "startWordsRound": case "startNextRound": case "restartGame": case "endGame":
      return { roomCode: validateRoomCode(p.roomCode) };
    default: throw new Error("INVALID_EVENT");
  }
}
