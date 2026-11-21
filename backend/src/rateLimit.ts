import { createHash } from "crypto";
import { isIP } from "net";
import { IncomingMessage } from "http";
import { redis } from "./game/lua";

// Ventanas por IP; los límites por socket son menores y no se comparten entre jugadores.
export const policies = {
  createRoom: { ip: 120, socket: 6, seconds: 600 },
  joinRoom: { ip: 240, socket: 30, seconds: 60 },
  rejoinRoom: { ip: 240, socket: 30, seconds: 60 },
  game: { ip: 1200, socket: 120, seconds: 60 },
  lookup: { ip: 180, socket: 180, seconds: 60 },
  handshake: { ip: 120, socket: 120, seconds: 60 },
};
export type RateGroup = keyof typeof policies;
const limitScript = redis.createScript<number>(`
  for i, key in ipairs(KEYS) do
    if tonumber(redis.call('GET', key) or '0') >= tonumber(ARGV[i * 2 - 1]) then return 0 end
  end
  for i, key in ipairs(KEYS) do
    local count = redis.call('INCR', key)
    if count == 1 then redis.call('EXPIRE', key, tonumber(ARGV[i * 2])) end
  end
  return 1
`);
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const normalizeIP = (s: string) => s.startsWith("::ffff:") ? s.slice(7) : s;
const trusted = new Set((process.env.TRUSTED_PROXY_IPS || "").split(",").filter(Boolean).map(s => normalizeIP(s.trim())));
export function clientIP(req: IncomingMessage): string {
  const remote = normalizeIP(req.socket.remoteAddress || "unknown");
  if (!trusted.has(remote)) return remote;
  const header = req.headers["x-forwarded-for"];
  const chain = (typeof header === "string" ? header : "").split(",").map(s => normalizeIP(s.trim()));
  for (let i = chain.length - 1; i >= 0; i--) {
    if (!isIP(chain[i])) return remote;
    if (!trusted.has(chain[i])) return chain[i];
  }
  return remote;
}
export async function consumeRate(group: RateGroup, ip: string, socketId?: string, roomCode?: string): Promise<void> {
  const policy = policies[group];
  const keys = [`rate:${group}:ip:${digest(ip)}`];
  const args = [String(policy.ip), String(policy.seconds)];
  if (socketId) { keys.push(`rate:${group}:socket:${digest(socketId)}`); args.push(String(policy.socket), String(policy.seconds)); }
  if (roomCode && group === "game") { keys.push(`rate:room:${roomCode}`); args.push("600", "60"); }
  if (await limitScript.exec(keys, args) !== 1) throw new Error("RATE_LIMITED");
}
