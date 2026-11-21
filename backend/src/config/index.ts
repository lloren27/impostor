import { config } from "dotenv";
config({ path: process.env.DOTENV_CONFIG_PATH || ".env", quiet: true });

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta configuración: ${name}`);
  return value;
}
function integer(name: string, fallback: number, max: number, min = 1): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Configuración inválida: ${name}`);
  return value;
}
const production = process.env.NODE_ENV === "production";
const redisUrl = required("UPSTASH_REDIS_REST_URL");
let parsed: URL;
try { parsed = new URL(redisUrl); } catch { throw new Error("Configuración inválida: UPSTASH_REDIS_REST_URL"); }
if (!["http:", "https:"].includes(parsed.protocol) || (production && parsed.protocol !== "https:")) {
  throw new Error("Configuración inválida: UPSTASH_REDIS_REST_URL");
}
const productionOrigins = ["https://impostor-frontend.onrender.com", "https://eljuegodelimpostor.es", "https://www.eljuegodelimpostor.es"];
const origins = (process.env.ALLOWED_ORIGINS?.split(",") ?? [...productionOrigins, ...(!production ? ["http://localhost:5173"] : [])]).map(s => s.trim());
for (const origin of origins) {
  try { const url = new URL(origin); if (url.origin !== origin || !["http:", "https:"].includes(url.protocol) || (production && url.protocol !== "https:")) throw 0; }
  catch { throw new Error("Configuración inválida: ALLOWED_ORIGINS"); }
}
export const settings = {
  production, redisUrl, redisToken: required("UPSTASH_REDIS_REST_TOKEN"), origins,
  port: integer("PORT", 4000, 65535, 0),
  maxName: integer("MAX_NAME_LENGTH", 30, 100),
  maxWord: integer("MAX_WORD_LENGTH", 80, 500),
  maxPlayers: integer("MAX_PLAYERS_PER_ROOM", 12, 50),
};
export function originAllowed(origin: string | undefined): boolean {
  return origin ? settings.origins.includes(origin) : !settings.production;
}
