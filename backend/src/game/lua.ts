import { Redis } from "@upstash/redis";
import { settings } from "../config";
export const redis = new Redis({ url: settings.redisUrl, token: settings.redisToken });

export const atomicCreateRoomScript = redis.createScript<string>(`
  local result = redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', tonumber(ARGV[2]))
  if result then return 'OK' else return 'TAKEN' end
`);

// Solo decodificar metadatos: guardar el JSON original de JS mantiene [] y null.
// La identidad impide escribir sobre una sala nueva que reutilice el mismo código.
export const compareRoomScript = redis.createScript<string>(`
  local raw = redis.call('GET', KEYS[1])
  if not raw then return 'MISSING' end
  local room = cjson.decode(raw)
  local legacy = room.players and room.players[1] and room.players[1].token or 'undefined'
  local identity = room.instanceId or ('legacy:' .. legacy)
  if identity ~= ARGV[1] then return 'REPLACED' end
  if tostring(room.version or 0) ~= ARGV[2] then return 'CONFLICT' end
  if ARGV[3] == 'delete' then
    redis.call('DEL', KEYS[1])
  else
    redis.call('SET', KEYS[1], ARGV[4], 'EX', tonumber(ARGV[5]))
  end
  return 'OK'
`);
