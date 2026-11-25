import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { parse } from "dotenv";
import { Redis } from "@upstash/redis";
import { io, Socket } from "socket.io-client";

const root = resolve(__dirname, "../..");
const testEnv = parse(readFileSync(resolve(root, ".env.test")));
assert(testEnv.UPSTASH_REDIS_REST_URL && testEnv.UPSTASH_REDIS_REST_TOKEN, "Faltan credenciales de pruebas");
const redis = new Redis({ url: testEnv.UPSTASH_REDIS_REST_URL, token: testEnv.UPSTASH_REDIS_REST_TOKEN });
const children: ChildProcess[] = [];
const sockets: Socket[] = [];
const keys = new Set<string>();
const origin = "https://test.example";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
let failures = 0;
async function server(): Promise<string> {
  const child = spawn(process.execPath, ["-r", "ts-node/register", "src/index.ts"], {
    cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME,
      UPSTASH_REDIS_REST_URL: testEnv.UPSTASH_REDIS_REST_URL,
      UPSTASH_REDIS_REST_TOKEN: testEnv.UPSTASH_REDIS_REST_TOKEN,
      DOTENV_CONFIG_PATH: resolve(root, ".env.test"), NODE_ENV: "production", PORT: "0", ALLOWED_ORIGINS: origin },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Backend no arrancó")), 15000);
    child.once("exit", () => { clearTimeout(timer); reject(new Error("Backend terminó antes de arrancar")); });
    child.once("error", () => { clearTimeout(timer); reject(new Error("No se pudo arrancar backend")); });
    child.stdout!.on("data", data => {
      const match = String(data).match(/Servidor escuchando en puerto (\d+)/);
      if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); }
    });
    // Consumir stderr sin volcar datos de proveedores o credenciales.
    child.stderr!.on("data", () => {});
  });
}
async function connect(url: string, transport = "websocket", originHeader: string | undefined = origin): Promise<Socket> {
  const socket = io(url, { transports: [transport], upgrade: false, reconnection: false, timeout: 3000,
    extraHeaders: originHeader === undefined ? {} : { Origin: originHeader } });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", () => { socket.disconnect(); reject(new Error("HANDSHAKE_REJECTED")); });
  });
}
function event(socket: Socket, name: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const cb = (payload: any) => { clearTimeout(timer); resolve(payload); };
    const timer = setTimeout(() => { socket.off(name, cb); reject(new Error(`Timeout ${name}`)); }, 7000);
    socket.once(name, cb);
  });
}
async function request(socket: Socket, name: string, payload: unknown, response: string): Promise<any> {
  const pending = event(socket, response); socket.emit(name, payload); return pending;
}
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${(error as Error).message}`); }
}
async function main() {
  try {
    const url = await server();
    const second = await server();
    await check("handshake polling/websocket: permitido, rechazado y sin Origin", async () => {
      for (const transport of ["polling", "websocket"]) {
        (await connect(url, transport)).disconnect();
        await assert.rejects(connect(url, transport, "https://evil.example"), /HANDSHAKE_REJECTED/);
        // null no se serializa como cabecera: usar undefined explícitamente en helper separado.
        const s = io(url, { transports: [transport], reconnection: false, timeout: 2000 });
        sockets.push(s);
        await new Promise<void>((resolve, reject) => {
          s.once("connect_error", () => { s.disconnect(); resolve(); });
          s.once("connect", () => { s.disconnect(); reject(new Error("Origin ausente admitido")); });
        });
      }
    });
    await check("validación de todos los sobres, campos y límites", async () => {
      const s = await connect(url);
      const cases: [string, unknown, string][] = [
        ["createRoom", null, "INVALID_PAYLOAD"], ["createRoom", [], "INVALID_PAYLOAD"],
        ["createRoom", { name: " " }, "INVALID_NAME"], ["createRoom", { name: "x".repeat(31) }, "INVALID_NAME"],
        ["createRoom", { name: "A", mode: "" }, "INVALID_MODE"],
        ["joinRoom", { roomCode: "!", name: "A" }, "INVALID_ROOM_CODE"],
        ["rejoinRoom", { roomCode: "ABCD", playerToken: {} }, "INVALID_TOKEN"],
        ["rejoinRoom", { roomCode: "ABCD", playerToken: "   " }, "INVALID_TOKEN"],
        ["submitWord", { roomCode: "ABCD", playerId: "p", word: "x".repeat(81) }, "INVALID_WORD"],
        ["submitVote", { roomCode: "ABCD", voterId: {}, targetId: "p" }, "INVALID_PLAYER_ID"],
        ["submitVote", { roomCode: "ABCD", voterId: "   ", targetId: "p" }, "INVALID_PLAYER_ID"],
        ...["startGame", "startWordsRound", "startNextRound", "restartGame", "endGame"].map(name => [name, {}, "INVALID_ROOM_CODE"] as [string, unknown, string]),
      ];
      for (const [name, payload, code] of cases) {
        assert.equal((await request(s, name, payload, "errorMessage")).code, code);
      }
      const created = await request(s, "createRoom", { name: "  " + "a".repeat(30) + "  ", mode: "manual" }, "roomJoined");
      keys.add(`room:${created.roomCode}`);
      assert.equal(created.player.name.length, 30); assert.equal(created.room.mode, "manual");
      assert.equal((await fetch(`${url}/rooms/!`)).status, 400);
      s.disconnect();
    });
    await check("cuota por socket y paquete máximo", async () => {
      const s = await connect(url);
      for (let i = 0; i < 6; i++) {
        const r = await request(s, "createRoom", { name: "A" }, "roomJoined"); keys.add(`room:${r.roomCode}`);
      }
      assert.equal((await request(s, "createRoom", { name: "A" }, "errorMessage")).code, "RATE_LIMITED");
      const large = await connect(url);
      const disconnected = event(large, "disconnect");
      large.emit("createRoom", { name: "a".repeat(5000) });
      await disconnected; s.disconnect();
    });
    await check("cuota por IP compartida entre procesos y recuperación", async () => {
      const hash = createHash("sha256").update("127.0.0.1").digest("hex");
      const key = `rate:lookup:ip:${hash}`; keys.add(key);
      await redis.set(key, 179, { ex: 10 });
      const results = await Promise.all([fetch(`${url}/rooms/ZZZZ`), fetch(`${second}/rooms/ZZZZ`)]);
      assert.equal(results.filter(r => r.status === 429).length, 1);
      assert.equal(results.find(r => r.status === 429)!.headers.get("retry-after"), "60");
      await redis.expire(key, 1); await sleep(1100);
      assert.equal((await fetch(`${second}/rooms/ZZZZ`)).status, 404);
    });
    await check("solicitud ajena no consume cuota de sala", async () => {
      const host = await connect(url);
      const r = await request(host, "createRoom", { name: "Host" }, "roomJoined");
      keys.add(`room:${r.roomCode}`);
      const roomRateKey = `rate:room:${r.roomCode}`; keys.add(roomRateKey);
      await redis.set(roomRateKey, 599, { ex: 60 });
      const outsider = await connect(url);
      assert.equal((await request(outsider, "startGame", { roomCode: r.roomCode }, "errorMessage")).code,
        "ONLY_HOST_CAN_START");
      assert.equal(await redis.get(roomRateKey), 599);
      assert.equal((await request(host, "startGame", { roomCode: r.roomCode }, "errorMessage")).code,
        "NOT_ENOUGH_PLAYERS");
      assert.equal(await redis.get(roomRateKey), 600);
      outsider.disconnect(); host.disconnect();
    });
    await check("12 jugadores tras la misma IP sin falsos bloqueos", async () => {
      const host = await connect(url);
      const r = await request(host, "createRoom", { name: "Host" }, "roomJoined"); keys.add(`room:${r.roomCode}`);
      const players = [host];
      for (let i = 0; i < 11; i++) {
        const s = await connect(url); players.push(s);
        await request(s, "joinRoom", { roomCode: r.roomCode, name: `P${i}` }, "roomJoined");
      }
      const extra = await connect(url);
      assert.equal((await request(extra, "joinRoom", { roomCode: r.roomCode, name: "Extra" }, "errorMessage")).code, "ROOM_FULL");
      await request(host, "startGame", { roomCode: r.roomCode }, "gameStarted");
      await request(host, "startWordsRound", { roomCode: r.roomCode }, "phaseChanged");
      const state = await redis.get<any>(`room:${r.roomCode}`);
      const p = state.players.find((p: any) => p.id === state.baseOrder[state.currentTurnIndex]);
      const sender = players.find(s => s.id === p.socketId)!;
      await request(sender, "submitWord", { roomCode: r.roomCode, playerId: p.id, word: "x".repeat(80) }, "wordAdded");
      for (const s of [...players, extra]) s.disconnect();
    });
  } finally {
    for (const s of sockets) s.disconnect();
    for (const child of children) {
      if (child.exitCode === null) { const ended = once(child, "exit"); child.kill("SIGTERM"); await ended; }
    }
    for (const key of keys) await redis.del(key);
  }
  if (failures) process.exitCode = 1;
}
main().catch(() => { console.error("Fallo de infraestructura de pruebas Sprint 2"); process.exitCode = 1; });
