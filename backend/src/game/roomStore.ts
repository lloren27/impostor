import { compareRoomScript, redis } from "./lua";
import { Room } from "./types";
import { recordMetric } from "../metrics";
export const ROOM_TTL_SECONDS = 7200;
export const ROOM_EMPTY_TTL_SECONDS = 600;
export const roomKey = (code: string) => `room:${code.toUpperCase()}`;
export const roomIdentity = (room: Room): string => room.instanceId ?? `legacy:${room.players[0]?.token}`;

export async function readRoom(code: string): Promise<Room | null> {
  return redis.get<Room>(roomKey(code));
}

/** Las funciones de cambio no pueden emitir eventos ni realizar otras escrituras. */
export async function updateRoom<T>(
  code: string,
  change: (room: Room) => T,
  options: { remove?: boolean; missingOk?: boolean; refresh?: boolean } = {},
): Promise<T> {
  let identity: string | undefined;
  for (let attempt = 0; attempt < 16; attempt++) {
    const room = await readRoom(code);
    if (!room) {
      if (options.missingOk) return undefined as T;
      throw new Error("ROOM_NOT_FOUND");
    }
    const currentIdentity = roomIdentity(room);
    if (identity !== undefined && currentIdentity !== identity) throw new Error("ROOM_NOT_FOUND");
    identity = currentIdentity;
    const version = room.version ?? 0;
    const before = JSON.stringify(room);
    let result: T;
    let removeEmpty = false;
    try { result = change(room); }
    catch (error) {
      if ((error as Error).message !== "ROOM_EMPTY") throw error;
      removeEmpty = true;
      result = undefined as T;
    }
    if (!options.remove && !removeEmpty && !options.refresh && JSON.stringify(room) === before) return result;
    room.instanceId = identity;
    room.version = version + 1;
    const ttl = room.players.some(p => p.connected) ? ROOM_TTL_SECONDS : ROOM_EMPTY_TTL_SECONDS;
    const saved = await compareRoomScript.exec([roomKey(code)], [
      identity, String(version), options.remove || removeEmpty ? "delete" : "save", JSON.stringify(room), String(ttl),
    ]);
    if (saved === "OK") {
      if (removeEmpty) {
        if (options.missingOk) return undefined as T;
        throw new Error("ROOM_NOT_FOUND");
      }
      return result;
    }
    if (saved !== "CONFLICT") throw new Error("ROOM_NOT_FOUND");
    recordMetric("redis_conflicts");
    await new Promise(resolve => setTimeout(resolve, 5 + Math.random() * 25 * (attempt + 1)));
  }
  throw new Error("ROOM_BUSY");
}
