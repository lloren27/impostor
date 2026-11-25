import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, ChildProcess } from "node:child_process";
import { once } from "node:events";
import { parse } from "dotenv";
import { Redis } from "@upstash/redis";
import { io, Socket } from "socket.io-client";

const root = resolve(__dirname, "../..");
const testEnv = parse(readFileSync(resolve(root, ".env.test")));
assert(testEnv.UPSTASH_REDIS_REST_URL && testEnv.UPSTASH_REDIS_REST_TOKEN,
  "Faltan credenciales del Redis de pruebas");

const redis = new Redis({
  url: testEnv.UPSTASH_REDIS_REST_URL,
  token: testEnv.UPSTASH_REDIS_REST_TOKEN,
});
const origin = "https://test.example";
const sockets: Socket[] = [];
const children: ChildProcess[] = [];
const roomKeys = new Set<string>();
let baseUrl = "";
let passed = 0;
let failed = 0;

function waitForEvent(socket: Socket, event: string, timeout = 8000): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const listener = (...args: any[]) => {
      clearTimeout(timer);
      resolve(args);
    };
    const timer = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`Timeout esperando ${event}`));
    }, timeout);
    socket.once(event, listener);
  });
}

async function startServer(): Promise<string> {
  const child = spawn(process.execPath, ["-r", "ts-node/register", "src/index.ts"], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DOTENV_CONFIG_PATH: resolve(root, ".env.test"),
      UPSTASH_REDIS_REST_URL: testEnv.UPSTASH_REDIS_REST_URL,
      UPSTASH_REDIS_REST_TOKEN: testEnv.UPSTASH_REDIS_REST_TOKEN,
      NODE_ENV: "production",
      PORT: "0",
      ALLOWED_ORIGINS: origin,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);

  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;
    const timer = setTimeout(() => finish(new Error("Backend no arrancó")), 15000);
    const finish = (error?: Error, url?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(url!);
    };

    child.once("error", error => finish(error));
    child.once("exit", () => finish(new Error("Backend terminó antes de arrancar")));
    child.stdout?.on("data", data => {
      output += String(data);
      const match = output.match(/Servidor escuchando en puerto (\d+)/);
      if (match) finish(undefined, `http://127.0.0.1:${match[1]}`);
    });
    child.stderr?.on("data", () => {});
  });
}

function connect(): Promise<Socket> {
  const socket = io(baseUrl, {
    transports: ["websocket"],
    reconnection: false,
    timeout: 3000,
    extraHeaders: { Origin: origin },
  });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", error => {
      socket.disconnect();
      reject(error);
    });
  });
}

async function openRoom(mode: "classic" | "manual") {
  const hostSocket = await connect();
  const created = waitForEvent(hostSocket, "roomJoined");
  hostSocket.emit("createRoom", { name: "Alice", mode });
  const [hostRoom] = await created;
  const roomCode = hostRoom.roomCode as string;
  const key = `room:${roomCode.toUpperCase()}`;
  roomKeys.add(key);
  assert.equal(hostRoom.room.mode, mode);

  const players = [{
    id: hostRoom.playerId as string,
    token: hostRoom.playerToken as string,
    socket: hostSocket,
  }];
  for (const name of ["Bob", "Charlie"]) {
    const socket = await connect();
    const joined = waitForEvent(socket, "roomJoined");
    socket.emit("joinRoom", { roomCode, name });
    const [player] = await joined;
    players.push({
      id: player.playerId as string,
      token: player.playerToken as string,
      socket,
    });
  }

  return { hostSocket, players, roomCode, key };
}

async function test(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${(error as Error).message}`);
  }
}

async function testClassicGameCompletes(): Promise<void> {
  const { hostSocket, players, roomCode, key } = await openRoom("classic");
  const roleEvents = players.map(player => waitForEvent(player.socket, "yourRole"));
  const started = waitForEvent(hostSocket, "gameStarted");
  hostSocket.emit("startGame", { roomCode });
  const [gameStarted] = await started;
  const roles = (await Promise.all(roleEvents)).map(([role]) => role);
  assert.equal(gameStarted.phase, "reveal");
  assert.equal(roles.filter(role => role.isImpostor).length, 1);
  assert(roles.every(role => role.isImpostor || typeof role.character === "string"));

  const wordsPhase = waitForEvent(hostSocket, "phaseChanged");
  hostSocket.emit("startWordsRound", { roomCode });
  const [wordsStarted] = await wordsPhase;
  assert.equal(wordsStarted.phase, "words");

  for (let index = 0; index < players.length; index++) {
    const room = await redis.get<any>(key);
    assert.equal(room?.phase, "words");
    const playerId = room.baseOrder[room.currentTurnIndex];
    const player = players.find(candidate => candidate.id === playerId);
    assert(player, "El jugador en turno debe tener un socket asociado");
    const wordAdded = waitForEvent(player.socket, "wordAdded");
    const votingPhase = index === players.length - 1
      ? waitForEvent(hostSocket, "phaseChanged")
      : undefined;
    player.socket.emit("submitWord", {
      roomCode,
      playerId,
      word: `palabra${index + 1}`,
    });
    const [word] = await wordAdded;
    assert.equal(word.playerId, playerId);
    if (votingPhase) {
      const [changed] = await votingPhase;
      assert.equal(changed.phase, "voting");
    }
  }

  const votingRoom = await redis.get<any>(key);
  assert.equal(votingRoom?.phase, "voting");
  const impostorId = votingRoom.impostorId as string;
  assert(players.some(player => player.id === impostorId));
  const roundResult = waitForEvent(hostSocket, "roundResult");
  const gameFinished = waitForEvent(hostSocket, "gameFinished");

  for (const player of players) {
    const voteConfirmed = waitForEvent(player.socket, "voteConfirmed");
    player.socket.emit("submitVote", {
      roomCode,
      voterId: player.id,
      targetId: impostorId,
      voteEpoch: votingRoom.voteEpoch ?? 0,
    });
    await voteConfirmed;
  }

  const [[result], [finished]] = await Promise.all([roundResult, gameFinished]);
  assert.equal(result.eliminatedPlayer.id, impostorId);
  assert.equal(result.wasImpostor, true);
  assert.equal(finished.winner, "players");
  const finalRoom = await redis.get<any>(key);
  assert.equal(finalRoom?.phase, "finished");
  assert.equal(finalRoom?.winner, "players");
}

async function testClassicTieReconnectAndHostTransfer(): Promise<void> {
  const { hostSocket, players, roomCode, key } = await openRoom("classic");
  const hostTransfer = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      players[1].socket.off("playersUpdated", listener);
      reject(new Error("Timeout esperando el cambio de anfitrión"));
    }, 8000);
    const listener = (update: { players: any[] }) => {
      const formerHost = update.players.find(player => player.id === players[0].id);
      const newHost = update.players.find(player => player.id === players[1].id);
      if (formerHost?.connected === false && !formerHost.isHost && newHost?.isHost) {
        clearTimeout(timer);
        players[1].socket.off("playersUpdated", listener);
        resolve();
      }
    };
    players[1].socket.on("playersUpdated", listener);
  });
  hostSocket.disconnect();
  await hostTransfer;

  let room = await redis.get<any>(key);
  assert.equal(room?.players.find((player: any) => player.id === players[0].id)?.isHost, false);
  assert.equal(room?.players.find((player: any) => player.id === players[1].id)?.isHost, true);

  const returningSocket = await connect();
  const rejoined = waitForEvent(returningSocket, "roomJoined");
  const restored = waitForEvent(returningSocket, "roomState");
  returningSocket.emit("rejoinRoom", { roomCode, playerToken: players[0].token });
  await rejoined;
  await restored;
  players[0].socket = returningSocket;

  const activeHost = players[1].socket;
  const roleEvents = players.map(player => waitForEvent(player.socket, "yourRole"));
  const started = waitForEvent(activeHost, "gameStarted");
  activeHost.emit("startGame", { roomCode });
  const [gameStarted] = await started;
  const roles = (await Promise.all(roleEvents)).map(([role]) => role);
  assert.equal(gameStarted.phase, "reveal");
  assert.equal(roles.filter(role => role.isImpostor).length, 1);

  const wordsPhase = waitForEvent(activeHost, "phaseChanged");
  activeHost.emit("startWordsRound", { roomCode });
  const [wordsStarted] = await wordsPhase;
  assert.equal(wordsStarted.phase, "words");

  for (let index = 0; index < players.length; index++) {
    room = await redis.get<any>(key);
    const playerId = room.baseOrder[room.currentTurnIndex];
    const player = players.find(candidate => candidate.id === playerId);
    assert(player, "El jugador en turno debe tener un socket asociado");
    const wordAdded = waitForEvent(player.socket, "wordAdded");
    const votingPhase = index === players.length - 1
      ? waitForEvent(activeHost, "phaseChanged")
      : undefined;
    player.socket.emit("submitWord", { roomCode, playerId, word: `empate${index + 1}` });
    await wordAdded;
    if (votingPhase) await votingPhase;
  }

  const votingRoom = await redis.get<any>(key);
  const impostorId = votingRoom.impostorId as string;
  const tieVote = waitForEvent(players[0].socket, "tieVote");
  for (let index = 0; index < players.length; index++) {
    const voteConfirmed = waitForEvent(players[index].socket, "voteConfirmed");
    players[index].socket.emit("submitVote", {
      roomCode,
      voterId: players[index].id,
      targetId: players[(index + 1) % players.length].id,
      voteEpoch: votingRoom.voteEpoch ?? 0,
    });
    await voteConfirmed;
  }
  const [tie] = await tieVote;
  assert.equal(tie.tieCandidates.length, players.length);

  room = await redis.get<any>(key);
  assert.equal(room?.voteEpoch, 1);
  assert.equal(room?.tieCandidates.length, players.length);
  const roundResult = waitForEvent(activeHost, "roundResult");
  const gameFinished = waitForEvent(activeHost, "gameFinished");
  for (const player of players) {
    const voteConfirmed = waitForEvent(player.socket, "voteConfirmed");
    player.socket.emit("submitVote", {
      roomCode,
      voterId: player.id,
      targetId: impostorId,
      voteEpoch: room.voteEpoch,
    });
    await voteConfirmed;
  }

  const [[result], [finished]] = await Promise.all([roundResult, gameFinished]);
  assert.equal(result.eliminatedPlayer.id, impostorId);
  assert.equal(finished.winner, "players");
  room = await redis.get<any>(key);
  assert.equal(room?.phase, "finished");
}

async function testManualRoleDistribution(): Promise<void> {
  const { hostSocket, players, roomCode, key } = await openRoom("manual");
  const roleEvents = players.map(player => waitForEvent(player.socket, "yourRole"));
  const started = waitForEvent(hostSocket, "gameStarted");
  hostSocket.emit("startGame", { roomCode });
  const [gameStarted] = await started;
  const roles = (await Promise.all(roleEvents)).map(([role]) => role);
  assert.equal(gameStarted.phase, "reveal");
  assert.equal(roles.filter(role => role.isImpostor).length, 1);
  assert(roles.every(role => role.isImpostor || typeof role.character === "string"));

  const rejected = waitForEvent(hostSocket, "errorMessage");
  hostSocket.emit("startWordsRound", { roomCode });
  const [error] = await rejected;
  assert.equal(error.code, "MANUAL_MODE_ONLY_ROLES");
  assert.equal((await redis.get<any>(key))?.phase, "reveal");

  const roomEnded = waitForEvent(players[1].socket, "roomEnded");
  hostSocket.emit("endGame", { roomCode });
  await roomEnded;
  assert.equal(await redis.exists(key), 0);
}

async function main(): Promise<void> {
  try {
    baseUrl = await startServer();
    await test("partida classic completa hasta victoria de jugadores", testClassicGameCompletes);
    await test("partida classic con empate, reconexión y cambio de anfitrión", testClassicTieReconnectAndHostTransfer);
    await test("modo manual reparte roles y finaliza la sala", testManualRoleDistribution);
  } finally {
    for (const socket of sockets) socket.disconnect();
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        const ended = once(child, "exit");
        child.kill("SIGTERM");
        await ended;
      }
    }
    for (const key of roomKeys) await redis.del(key);
  }

  console.log(`Sprint 4: ${passed} pasadas, ${failed} fallidas`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(() => {
  console.error("Fallo de infraestructura de pruebas Sprint 4");
  process.exitCode = 1;
});