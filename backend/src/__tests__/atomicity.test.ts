import assert from "node:assert/strict";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { Redis } from "@upstash/redis";

const env = parse(readFileSync(resolve(__dirname, "../../.env.test")));
if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) throw new Error("Configura el Redis independiente en .env.test");
process.env.UPSTASH_REDIS_REST_URL = env.UPSTASH_REDIS_REST_URL;
process.env.UPSTASH_REDIS_REST_TOKEN = env.UPSTASH_REDIS_REST_TOKEN;
process.env.DOTENV_CONFIG_PATH = resolve(__dirname, "../../.env.test");
const redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
const keys: string[] = [];
let failures = 0;
async function main() {
  const game = await import("../game/roomsManagerRedis");
  async function room() { const r = await game.createRoom("host", "Host"); keys.push(`room:${r.room.code}`); return r; }
  async function check(name: string, fn: () => Promise<void>) {
    try { await fn(); console.log(`PASS ${name}`); }
    catch (error) { failures++; console.error(`FAIL ${name}: ${(error as Error).message}`); }
  }
  try {
    await check("lectura sin escritura ni renovación TTL", async () => {
      const { room: r } = await room(); const key = `room:${r.code}`;
      await redis.expire(key, 90); const before = await redis.get(key);
      await game.getRoom(r.code);
      assert.deepEqual(await redis.get(key), before); assert((await redis.ttl(key)) <= 90);
    });
    await check("8 incorporaciones concurrentes", async () => {
      const { room: r } = await room();
      await Promise.all(Array.from({ length: 8 }, (_, i) => game.joinOrRejoinRoom(r.code, `s${i}`, `P${i}`)));
      assert.equal((await game.getRoom(r.code))!.players.length, 9);
    });
    await check("votos concurrentes y duplicados", async () => {
      const { room: r } = await room();
      const a = await game.joinOrRejoinRoom(r.code, "a", "A");
      const b = await game.joinOrRejoinRoom(r.code, "b", "B");
      await game.joinOrRejoinRoom(r.code, "c", "C");
      await game.startGame(r.code, "host"); await game.startWordsRound(r.code, "host");
      for (let i = 0; i < 4; i++) {
        const state = (await game.getRoom(r.code))!;
        const p = state.players.find(p => p.id === state.baseOrder[state.currentTurnIndex])!;
        await game.submitWord(r.code, p.id, p.socketId!, `word${i}`);
      }
      const results = await Promise.allSettled([
        game.submitVote(r.code, a.player.id, "a", r.players[0].id),
        game.submitVote(r.code, b.player.id, "b", r.players[0].id),
        game.submitVote(r.code, a.player.id, "a", r.players[0].id),
      ]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 2);
      assert.equal((await game.getRoom(r.code))!.votes.length, 2);
    });
    await check("reconexión concurrente con desconexión antigua", async () => {
      const { room: r, player } = await room();
      await Promise.all([game.rejoinRoom(r.code, player.token, "new"), game.markPlayerDisconnected(r.code, "host")]);
      const p = (await game.getRoom(r.code))!.players.find(p => p.id === player.id)!;
      assert.equal(p.socketId, "new"); assert.equal(p.connected, true);
    });
    await check("capacidad concurrente máxima y reconexión en sala llena", async () => {
      const { room: r, player } = await room();
      const results = await Promise.allSettled(Array.from({ length: 14 }, (_, i) =>
        game.joinOrRejoinRoom(r.code, `capacity-${i}`, `P${i}`)));
      assert.equal(results.filter(r => r.status === "fulfilled").length, 11);
      assert.equal((await game.getRoom(r.code))!.players.length, 12);
      await game.rejoinRoom(r.code, player.token, "new-host");
      assert.equal((await game.getRoom(r.code))!.players.length, 12);
    });
    await check("migración legacy preserva null y arrays; poda en mutación", async () => {
      const { room: r } = await room();
      const key = `room:${r.code}`;
      const state = (await game.getRoom(r.code))!;
      delete state.version; delete state.instanceId;
      state.players.push({ ...state.players[0], id: "old", token: "old-token", socketId: null,
        isHost: false, connected: false, disconnectedAt: Date.now() - 180000 });
      await redis.set(key, state, { ex: 100 });
      await game.joinOrRejoinRoom(r.code, "legacy-new", "New");
      const current = (await game.getRoom(r.code))!;
      assert.equal(current.version, 1); assert(current.instanceId?.startsWith("legacy:"));
      assert.equal(current.players.length, 2); assert.equal(current.character, null);
      assert.deepEqual(current.words, []); assert.deepEqual(current.votes, []);
    });
    await check("snapshot tardío no resucita sala ni modifica un código reutilizado", async () => {
      const { room: r } = await room();
      const { compareRoomScript, atomicCreateRoomScript } = await import("../game/lua");
      const args = [r.instanceId!, String(r.version), "save", JSON.stringify(r), "100"];
      await game.deleteRoom(r.code, "host");
      assert.equal(await compareRoomScript.exec([`room:${r.code}`], args), "MISSING");
      const replacement = { ...r, instanceId: "new-incarnation" };
      assert.equal(await atomicCreateRoomScript.exec([`room:${r.code}`], [JSON.stringify(replacement), "100"]), "OK");
      assert.equal(await compareRoomScript.exec([`room:${r.code}`], args), "REPLACED");
      assert.equal((await game.getRoom(r.code))!.instanceId, "new-incarnation");
      assert.equal(await atomicCreateRoomScript.exec([`room:${r.code}`], [JSON.stringify(r), "100"]), "TAKEN");
    });
    await check("reintentos releen estado y terminan con ROOM_BUSY", async () => {
      const { room: r } = await room();
      const { compareRoomScript } = await import("../game/lua");
      const original = compareRoomScript.exec.bind(compareRoomScript);
      let calls = 0;
      compareRoomScript.exec = async () => { calls++; return "CONFLICT"; };
      try {
        await assert.rejects(game.joinOrRejoinRoom(r.code, "busy", "Busy"), /ROOM_BUSY/);
        assert.equal(calls, 16); assert.equal((await game.getRoom(r.code))!.players.length, 1);
      } finally { compareRoomScript.exec = original; }
    });
    await check("poda atómica elimina sala vacía y niega incorporación", async () => {
      const { room: r } = await room();
      const key = `room:${r.code}`;
      const stale = (await game.getRoom(r.code))!;
      stale.players[0].socketId = null;
      stale.players[0].connected = false;
      stale.players[0].disconnectedAt = Date.now() - 180000;
      await redis.set(key, stale, { ex: 100 });
      await assert.rejects(game.joinOrRejoinRoom(r.code, "new", "New"), /ROOM_NOT_FOUND/);
      assert.equal(await redis.exists(key), 0);
    });
    await check("voto duplicado no entra en desempate", async () => {
      const { room: r } = await room();
      const a = await game.joinOrRejoinRoom(r.code, "a", "A");
      const b = await game.joinOrRejoinRoom(r.code, "b", "B");
      await game.startGame(r.code, "host"); await game.startWordsRound(r.code, "host");
      for (let i = 0; i < 3; i++) {
        const state = (await game.getRoom(r.code))!;
        const p = state.players.find(p => p.id === state.baseOrder[state.currentTurnIndex])!;
        await game.submitWord(r.code, p.id, p.socketId!, `word${i}`);
      }
      await game.submitVote(r.code, r.players[0].id, "host", a.player.id);
      await game.submitVote(r.code, a.player.id, "a", b.player.id);
      const results = await Promise.allSettled([
        game.submitVote(r.code, b.player.id, "b", r.players[0].id, 0),
        game.submitVote(r.code, b.player.id, "b", r.players[0].id, 0),
      ]);
      assert.equal(results.filter(x => x.status === "fulfilled").length, 1);
      const state = (await game.getRoom(r.code))!;
      assert.equal(state.voteEpoch, 1);
      assert.deepEqual(state.votes, []);
      await game.submitVote(r.code, b.player.id, "b", r.players[0].id, 1);
      assert.equal((await game.getRoom(r.code))!.votes.length, 1);
    });
    await check("época de voto no se reutiliza entre rondas ni reinicios", async () => {
      const { room: r } = await room();
      await game.joinOrRejoinRoom(r.code, "a", "A");
      await game.joinOrRejoinRoom(r.code, "b", "B");
      await game.startGame(r.code, "host");
      await game.startWordsRound(r.code, "host");
      const oldEpoch = (await game.getRoom(r.code))!.voteEpoch ?? 0;
      const state = (await game.getRoom(r.code))!;
      state.phase = "revealRound";
      await redis.set(`room:${r.code}`, state, { ex: 100 });
      await game.startNextRound(r.code, "host");
      assert.equal((await game.getRoom(r.code))!.voteEpoch, oldEpoch + 1);
      await game.restartGame(r.code, "host");
      assert.equal((await game.getRoom(r.code))!.voteEpoch, oldEpoch + 2);
    });
  } finally { for (const key of keys) await redis.del(key); }
  if (failures) process.exitCode = 1;
}
main().catch(() => { console.error("Fallo de infraestructura en atomicity.test"); process.exitCode = 1; });
