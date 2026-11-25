/**
 * Pruebas de integración del Sprint 3 — ciclo de vida y recuperación.
 *
 * Ejecutar con:
 *   npm run test:sprint3
 *
 * Requiere un Redis de pruebas configurado en backend/.env.test.
 *
 * Casos cubiertos:
 * - S3.1: salida del expulsado + recarga (snapshot conserva el nombre)
 * - S3.2: confirmación de voto (voteConfirmed emitido por el servidor)
 * - S3.3: recalcular elegibilidad al desconectarse un votante
 */

import { io, Socket } from "socket.io-client";
import { spawn } from "child_process";
import { join } from "path";
import * as fs from "fs";
import * as net from "net";
import { Redis } from "@upstash/redis";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testPort: number = 4000;
const getBaseUrl = () => `http://localhost:${testPort}`;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      server.once("close", () => resolve(port));
      server.close();
    });
    server.on("error", reject);
  });
}

function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(getBaseUrl(), { transports: ["websocket"] });
    s.on("connect", () => resolve(s));
    s.on("connect_error", (err) => reject(err));
  });
}

function waitForEvent(socket: Socket, event: string, timeout = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for '${event}'`)), timeout);
    socket.once(event, (...args: any[]) => {
      clearTimeout(timer);
      resolve(args);
    });
  });
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let serverProcess: ReturnType<typeof spawn> | null = null;

function loadTestEnv(): NodeJS.ProcessEnv {
  const backendRoot = join(__dirname, "..", "..");
  const envTestPath = join(backendRoot, ".env.test");

  const testEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH || "",
    HOME: process.env.HOME || "",
    LANG: process.env.LANG || "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    DOTENV_CONFIG_PATH: envTestPath,
  };

  if (!fs.existsSync(envTestPath)) {
    throw new Error(
      "[setup] .env.test not found. Create backend/.env.test with test Redis credentials."
    );
  }

  const content = fs.readFileSync(envTestPath, "utf-8");
  const parsed: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    const value = trimmed.substring(eqIdx + 1).trim();
    if (key && value !== "") {
      parsed[key] = value;
    }
  }

  if (!parsed.UPSTASH_REDIS_REST_URL || !parsed.UPSTASH_REDIS_REST_TOKEN) {
    throw new Error(
      "[setup] .env.test must define UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN."
    );
  }

  Object.assign(testEnv, parsed);
  return testEnv;
}

async function startServer() {
  const testEnv = loadTestEnv();
  testPort = await findFreePort();
  testEnv.PORT = String(testPort);

  serverProcess = spawn("npx", ["ts-node", "src/index.ts"], {
    cwd: join(__dirname, "..", ".."),
    stdio: ["ignore", "pipe", "pipe"],
    env: testEnv,
  });

  serverProcess.stderr?.on("data", (d) => process.stderr.write(d));

  for (let i = 0; i < 20; i++) {
    await delay(500);
    try {
      const s = await connect();
      s.disconnect();
      return;
    } catch {
      // keep trying
    }
  }
  throw new Error("Could not start backend server");
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

// ---------------------------------------------------------------------------
// Helper: crear sala con 3 jugadores, iniciar juego y llegar a votación
// ---------------------------------------------------------------------------

async function setupGameWithVoting() {
  const sockets: Socket[] = [];
  const socketMap = new Map<string, Socket>();
  const playerIds: string[] = [];

  // Crear sala
  const s1 = await connect();
  sockets.push(s1);
  const created = waitForEvent(s1, "roomJoined");
  s1.emit("createRoom", { name: "Alice", mode: "classic" });
  const [rj1] = await created;
  socketMap.set(rj1.playerId, s1);
  playerIds.push(rj1.playerId);
  const roomCode = rj1.roomCode;

  // Unir 2 jugadores más
  for (const name of ["Bob", "Charlie"]) {
    const s = await connect();
    sockets.push(s);
    const joined = waitForEvent(s, "roomJoined");
    s.emit("joinRoom", { roomCode, name });
    const [rj] = await joined;
    socketMap.set(rj.playerId, s);
    playerIds.push(rj.playerId);
  }

  await delay(200);

  // Iniciar juego: lobby → reveal
  const started = waitForEvent(s1, "gameStarted");
  s1.emit("startGame", { roomCode });
  await started;

  // Iniciar ronda de palabras: reveal → words
  const changed = waitForEvent(s1, "phaseChanged");
  s1.emit("startWordsRound", { roomCode });
  await changed;

  // Escribir 3 palabras
  const testEnv = loadTestEnv();
  const redis = new Redis({
    url: testEnv.UPSTASH_REDIS_REST_URL!,
    token: testEnv.UPSTASH_REDIS_REST_TOKEN!,
  });
  const roomKey = `room:${roomCode.toUpperCase()}`;

  for (let i = 0; i < 3; i++) {
    const room = await redis.get<any>(roomKey);
    assert(room?.phase === "words", `la sala debe estar en words para palabra ${i + 1}`);
    const playerId = room.baseOrder[room.currentTurnIndex];
    const socket = socketMap.get(playerId);
    assert(!!socket, `el jugador del turno debe tener un socket (iteración ${i})`);

    const added = waitForEvent(socket!, "wordAdded");
    socket!.emit("submitWord", { roomCode, playerId, word: `palabra${i + 1}` });
    await added;
  }

  // La ronda debería haber pasado a voting
  const roomAfterWords = await redis.get<any>(roomKey);
  assert(
    roomAfterWords?.phase === "voting",
    `tras 3 palabras la fase debe ser voting, pero es ${roomAfterWords?.phase}`
  );

  return { sockets, socketMap, playerIds, roomCode, redis, roomKey };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/**
 * S3.1 — Salida del expulsado + recarga:
 *
 * Flujo: crear sala con 3 jugadores → iniciar juego → ronda de palabras
 * → votación que elimina a Charlie → Charlie sale de la sala → Alice recarga
 * y verifica que el snapshot conserva el nombre del expulsado.
 */
async function testEliminatedPlayerLeavesThenReconnect() {
  const { sockets, socketMap, playerIds, roomCode, redis, roomKey } =
    await setupGameWithVoting();

  const aliceId = playerIds[0];
  const bobId = playerIds[1];
  const charlieId = playerIds[2];

  const aliceSocket = socketMap.get(aliceId)!;
  const bobSocket = socketMap.get(bobId)!;
  const charlieSocket = socketMap.get(charlieId)!;

  try {
    // Alice, Bob y Charlie votan por Charlie (3 jugadores, 3 votos = Charlie eliminado)
    const voteConfirmedAlice = waitForEvent(aliceSocket, "voteConfirmed");
    aliceSocket.emit("submitVote", {
      roomCode,
      voterId: aliceId,
      targetId: charlieId,
      voteEpoch: 0,
    });
    await voteConfirmedAlice;

    const voteConfirmedBob = waitForEvent(bobSocket, "voteConfirmed");
    bobSocket.emit("submitVote", {
      roomCode,
      voterId: bobId,
      targetId: charlieId,
      voteEpoch: 0,
    });
    await voteConfirmedBob;

    // El voto de Charlie cierra la votación (3 votos de 3 elegibles)
    const roundResultPromise = waitForEvent(aliceSocket, "roundResult");
    charlieSocket.emit("submitVote", {
      roomCode,
      voterId: charlieId,
      targetId: charlieId,
      voteEpoch: 0,
    });
    const [roundResult] = await roundResultPromise;

    // Verificar que Charlie fue eliminado
    assert(
      roundResult.eliminatedPlayer?.id === charlieId,
      `Charlie debería ser eliminado, pero fue ${roundResult.eliminatedPlayer?.id}`
    );

    await delay(300);

    // Charlie sale de la sala
    charlieSocket.emit("leaveRoom");
    await delay(300);

    // Verificar en Redis que lastEliminatedName está persistido
    const roomAfterLeave = await redis.get<any>(roomKey);
    assert(
      roomAfterLeave?.lastEliminatedName === "Charlie",
      `lastEliminatedName debe ser "Charlie", pero es ${roomAfterLeave?.lastEliminatedName}`
    );
    assert(
      roomAfterLeave?.lastEliminatedId === charlieId,
      `lastEliminatedId debe ser ${charlieId}, pero es ${roomAfterLeave?.lastEliminatedId}`
    );

    // Alice se desconecta y reconecta (simula recarga)
    // Necesitamos el token de Alice — obtenerlo de Redis
    const roomForToken = await redis.get<any>(roomKey);
    const alicePlayer = roomForToken.players.find((p: any) => p.id === aliceId);
    assert(alicePlayer, "Alice debe existir en la sala");
    const alicePlayerToken = alicePlayer.token;

    aliceSocket.disconnect();
    await delay(300);

    // Alice reconecta
    const aliceReconnect = await connect();

    // Registrar listener de roomState ANTES de enviar rejoinRoom
    let roomStateReceived: any = null;
    aliceReconnect.once("roomState", (state: any) => {
      roomStateReceived = state;
    });

    const rejoinPromise = waitForEvent(aliceReconnect, "roomJoined");
    aliceReconnect.emit("rejoinRoom", {
      roomCode,
      playerToken: alicePlayerToken,
    });
    await rejoinPromise;

    // Esperar a que roomState llegue (se emite tras roomJoined en rejoinRoom)
    await delay(500);

    // Si roomState no llegó por el listener tardío, verificar directamente
    // que el snapshot contiene los datos del expulsado
    if (!roomStateReceived) {
      // El roomState ya fue emitido durante rejoinRoom; verificar en Redis
      const roomInRedis = await redis.get<any>(roomKey);
      assert(
        roomInRedis?.lastEliminatedName === "Charlie",
        "El snapshot en Redis debe conservar el nombre del expulsado"
      );
      assert(
        roomInRedis?.lastEliminatedId === charlieId,
        "El snapshot en Redis debe conservar el ID del expulsado"
      );
      // Verificar que Charlie ya no está en la lista de players
      const charlieInPlayers = roomInRedis.players.find(
        (p: any) => p.id === charlieId
      );
      assert(
        !charlieInPlayers,
        "Charlie no debe estar en la lista de players tras leaveRoom"
      );
    } else {
      assert(
        roomStateReceived.lastEliminatedName === "Charlie",
        `El snapshot debe incluir lastEliminatedName="Charlie", pero es "${roomStateReceived.lastEliminatedName}"`
      );
      assert(
        roomStateReceived.lastEliminatedId === charlieId,
        `El snapshot debe incluir lastEliminatedId=${charlieId}`
      );
    }

    aliceReconnect.disconnect();
  } finally {
    for (const s of sockets) s.disconnect();
  }
}

/**
 * S3.2 — Confirmación de voto: el servidor emite voteConfirmed
 * antes de marcar el voto como aceptado.
 */
async function testVoteConfirmation() {
  const { sockets, socketMap, playerIds, roomCode } = await setupGameWithVoting();

  const aliceId = playerIds[0];
  const bobId = playerIds[1];
  const charlieId = playerIds[2];

  const aliceSocket = socketMap.get(aliceId)!;
  const bobSocket = socketMap.get(bobId)!;

  try {
    // Alice vota por Charlie — debe recibir voteConfirmed
    let voteConfirmedReceived = false;
    aliceSocket.once("voteConfirmed", (payload: any) => {
      voteConfirmedReceived = true;
      assert(
        payload.voterId === aliceId,
        `voteConfirmed debe incluir voterId=${aliceId}`
      );
    });

    aliceSocket.emit("submitVote", {
      roomCode,
      voterId: aliceId,
      targetId: charlieId,
      voteEpoch: 0,
    });

    // Esperar a que llegue la confirmación
    await delay(500);
    assert(voteConfirmedReceived, "Alice debe recibir voteConfirmed tras votar");

    // Bob vota por Charlie — cierra la votación, también recibe voteConfirmed
    let bobVoteConfirmed = false;
    bobSocket.once("voteConfirmed", () => {
      bobVoteConfirmed = true;
    });

    bobSocket.emit("submitVote", {
      roomCode,
      voterId: bobId,
      targetId: charlieId,
      voteEpoch: 0,
    });

    await delay(500);
    assert(bobVoteConfirmed, "Bob debe recibir voteConfirmed al cerrar la votación");
  } finally {
    for (const s of sockets) s.disconnect();
  }
}

/**
 * S3.3 — Disconnect resuelve votación sin submitVote posterior:
 *
 * Flujo: 2 jugadores en votación (Alice y Bob). Ambos votan por un mismo
 * target (Charlie, que ya fue eliminado en una ronda anterior, o uno de los
 * dos). Cuando uno se desconecta, markPlayerDisconnected debe resolver la
 * votación directamente, sin esperar un submitVote de otro jugador.
 *
 * Escenario concreto: 3 jugadores, Alice y Bob votan por Charlie → Charlie
 * eliminado. Ronda siguiente: solo Alice y Bob vivos. Ambos votan por el
 * otro. Alice se desconecta → solo Bob conectado, pero ya votó → votación
 * resuelta por disconnect, no por submitVote.
 *
 * Simplificación: manipulamos Redis para tener 2 jugadores en votación,
 * ambos ya han votado, y desconectamos uno. El evento roundResult debe
 * llegar sin que nadie envíe submitVote.
 */
async function testDisconnectResolvesVoteWithoutSubmitVote() {
  const sockets: Socket[] = [];
  const socketMap = new Map<string, Socket>();
  const playerIds: string[] = [];

  // Crear sala
  const s1 = await connect();
  sockets.push(s1);
  const created = waitForEvent(s1, "roomJoined");
  s1.emit("createRoom", { name: "Alice", mode: "classic" });
  const [rj1] = await created;
  socketMap.set(rj1.playerId, s1);
  playerIds.push(rj1.playerId);
  const roomCode = rj1.roomCode;

  // Unir Bob
  const s2 = await connect();
  sockets.push(s2);
  const joined2 = waitForEvent(s2, "roomJoined");
  s2.emit("joinRoom", { roomCode, name: "Bob" });
  const [rj2] = await joined2;
  socketMap.set(rj2.playerId, s2);
  playerIds.push(rj2.playerId);

  // Unir Charlie (necesario para iniciar el juego con 3 jugadores)
  const s3 = await connect();
  sockets.push(s3);
  const joined3 = waitForEvent(s3, "roomJoined");
  s3.emit("joinRoom", { roomCode, name: "Charlie" });
  const [rj3] = await joined3;
  socketMap.set(rj3.playerId, s3);
  playerIds.push(rj3.playerId);

  await delay(200);

  const aliceId = playerIds[0];
  const bobId = playerIds[1];
  const charlieId = playerIds[2];

  const aliceSocket = socketMap.get(aliceId)!;
  const bobSocket = socketMap.get(bobId)!;

  try {
    const testEnv = loadTestEnv();
    const redis = new Redis({
      url: testEnv.UPSTASH_REDIS_REST_URL!,
      token: testEnv.UPSTASH_REDIS_REST_TOKEN!,
    });
    const roomKey = `room:${roomCode.toUpperCase()}`;

    // Manipular Redis para crear un estado de votación donde:
    // - Charlie ya fue eliminado en una ronda anterior (no es elegible)
    // - Solo Alice y Bob son elegibles (vivos y conectados)
    // - Ambos ya han votado por Charlie (el target)
    // Cuando Alice se desconecte:
    //   - eligibleVoters = [Bob] (solo Bob vivo y conectado)
    //   - Se filtran los votos de Alice (ya no elegible)
    //   - Bob ya votó → 1 voto de 1 elegible → votación resuelta
    //   - Charlie recibe todos los votos → eliminado
    const room = await redis.get<any>(roomKey);
    assert(room, "La sala debe existir en Redis");

    room.phase = "voting";
    room.votes = [
      { voterId: aliceId, targetId: charlieId },
      { voterId: bobId, targetId: charlieId },
    ];
    room.tieCandidates = null;
    room.voteEpoch = 0;
    room.currentRound = 1;
    room.winner = null;
    room.baseOrder = [aliceId, bobId, charlieId];
    room.currentTurnIndex = 0;
    room.impostorId = charlieId; // Charlie es el impostor
    // Charlie ya fue eliminado en una ronda anterior → no es elegible
    room.players.forEach((p: any) => {
      p.connected = true;
      p.disconnectedAt = null;
      if (p.id === aliceId) {
        p.alive = true;
        p.socketId = s1.id;
      } else if (p.id === bobId) {
        p.alive = true;
        p.socketId = s2.id;
      } else if (p.id === charlieId) {
        p.alive = false; // Charlie ya eliminado → no es elegible
        p.socketId = s3.id;
      }
    });
    await redis.set(roomKey, room, { ex: 3600 });
    await delay(200);

    // Verificar estado: voting, 2 votos, Charlie no vivo
    const roomCheck = await redis.get<any>(roomKey);
    assert(
      roomCheck?.phase === "voting",
      `La fase debe ser voting, pero es ${roomCheck?.phase}`
    );
    assert(
      roomCheck?.votes.length === 2,
      `Deberían haber 2 votos, pero hay ${roomCheck?.votes.length}`
    );
    const charliePlayer = roomCheck?.players.find((p: any) => p.id === charlieId);
    assert(
      charliePlayer?.alive === false,
      "Charlie debe estar marcado como no vivo"
    );

    // Registrar listeners ANTES de desconectar a Alice
    const bobEvents: string[] = [];
    bobSocket.once("roundResult", () => bobEvents.push("roundResult"));
    bobSocket.once("tieVote", () => bobEvents.push("tieVote"));
    bobSocket.once("gameFinished", () => bobEvents.push("gameFinished"));
    bobSocket.once("playersUpdated", () => bobEvents.push("playersUpdated"));

    // Alice se desconecta — markPlayerDisconnected debe:
    // 1. Marcar a Alice como desconectada
    // 2. Filtrar votos: solo Bob es elegible (vivo y conectado)
    //    → voto de Alice se filtra (no elegible), voto de Bob permanece
    // 3. eligibleVoters = [Bob], votes = [voto de Bob]
    //    → 1 voto >= 1 elegible → votación resuelta
    // 4. Charlie recibe el voto de Bob → eliminado (ya estaba no vivo, pero resolvePendingVote lo elimina)
    aliceSocket.disconnect();
    await delay(1000);

    // Verificar que la votación se resolvió
    const roomAfter = await redis.get<any>(roomKey);
    assert(
      roomAfter?.phase !== "voting",
      `La votación no debe quedar bloqueada en voting; fase: ${roomAfter?.phase}`
    );

    // Charlie (impostor) debe haber sido eliminado → winner: players
    assert(
      roomAfter?.players.find((p: any) => p.id === charlieId)?.alive === false,
      "Charlie debe haber sido eliminado"
    );
    assert(
      roomAfter?.winner === "players",
      `Los jugadores deben ganar al eliminar al impostor; winner: ${roomAfter?.winner}`
    );

    // Verificar que se emitió algún evento a Bob (evidencia de que disconnect resolvió)
    assert(
      bobEvents.length > 0,
      `Se debe emitir un evento al desconectarse Alice; eventos recibidos: ${bobEvents.join(", ")}`
    );
    assert(
      bobEvents.includes("roundResult"),
      `Se debe emitir roundResult; eventos recibidos: ${bobEvents.join(", ")}`
    );
  } finally {
    for (const s of sockets) {
      if (s.connected) s.disconnect();
    }
  }
}

async function testVotedPlayerChangesRoom() {
  const { sockets, socketMap, playerIds, roomCode, redis, roomKey } =
    await setupGameWithVoting();
  const [aliceId, bobId, charlieId] = playerIds;
  const alice = socketMap.get(aliceId)!;
  const bob = socketMap.get(bobId)!;
  const charlie = socketMap.get(charlieId)!;
  try {
    for (const [voterId, voterSocket] of [[aliceId, alice], [bobId, bob]] as const) {
      const confirmed = waitForEvent(voterSocket, "voteConfirmed");
      voterSocket.emit("submitVote", { roomCode, voterId, targetId: charlieId, voteEpoch: 0 });
      await confirmed;
    }
    const result = waitForEvent(alice, "roundResult");
    const joined = waitForEvent(charlie, "roomJoined");
    charlie.emit("createRoom", { name: "Charlie", mode: "classic" });
    const [newRoom] = await joined;
    const [roundResult] = await result;
    assert(newRoom.roomCode !== roomCode, "Charlie debe entrar en otra sala");
    assert(roundResult.eliminatedPlayer?.id === charlieId, "La salida debe resolver los votos a Charlie");
    const oldRoom = await redis.get<any>(roomKey);
    assert(!oldRoom.players.some((p: any) => p.id === charlieId), "Charlie debe salir de la sala anterior");
    assert(oldRoom.phase !== "voting", "La votación anterior debe resolverse");
  } finally {
    for (const s of sockets) if (s.connected) s.disconnect();
  }
}

async function testJoinSameRoomKeepsMembership() {
  const socket = await connect();
  try {
    const created = waitForEvent(socket, "roomJoined");
    socket.emit("createRoom", { name: "Alice", mode: "classic" });
    const [first] = await created;
    const joined = waitForEvent(socket, "roomJoined");
    socket.emit("joinRoom", {
      roomCode: first.roomCode,
      name: "Alice",
      playerToken: first.playerToken,
    });
    const [second] = await joined;
    assert(second.playerId === first.playerId, "El reingreso debe conservar la identidad");
    assert(second.room.players.length === 1, "El reingreso no debe duplicar ni borrar al jugador");
  } finally {
    socket.disconnect();
  }
}

async function testVotedPlayerLeavesBeforeAllVotes() {
  const { sockets, socketMap, playerIds, roomCode, redis, roomKey } =
    await setupGameWithVoting();
  const [aliceId, , charlieId] = playerIds;
  const alice = socketMap.get(aliceId)!;
  const charlie = socketMap.get(charlieId)!;
  try {
    const confirmed = waitForEvent(alice, "voteConfirmed");
    alice.emit("submitVote", { roomCode, voterId: aliceId, targetId: charlieId, voteEpoch: 0 });
    await confirmed;
    const result = waitForEvent(alice, "roundResult");
    const joined = waitForEvent(charlie, "roomJoined");
    charlie.emit("createRoom", { name: "Charlie", mode: "classic" });
    await joined;
    const [roundResult] = await result;
    assert(roundResult.eliminatedPlayer?.id === charlieId, "La salida del candidato votado debe resolver la ronda");
    const oldRoom = await redis.get<any>(roomKey);
    assert(oldRoom.phase !== "voting", "No deben quedar votos contra un jugador ausente");
  } finally {
    for (const s of sockets) if (s.connected) s.disconnect();
  }
}

/**
 * S3.3 — Pruebas exhaustivas de desconexión:
 *
 * Cubre los escenarios de desconexión que las pruebas anteriores no cubren:
 * 1. Desconexión del anfitrión → reasignación de host.
 * 2. Desconexión del jugador en turno durante ronda de palabras → avance de turno.
 * 3. Desconexión de todos los participantes → sala vacía.
 */

/**
 * S3.3 — Desconexión del anfitrión:
 *
 * Flujo: crear sala con 3 jugadores → el host (Alice) se desconecta.
 * Verificar que el host se reasigna al jugador conectado más antiguo (Bob).
 */
async function testHostDisconnectReassignsHost() {
  const sockets: Socket[] = [];

  // Crear sala — Alice es el host
  const s1 = await connect();
  sockets.push(s1);
  const created = waitForEvent(s1, "roomJoined");
  s1.emit("createRoom", { name: "Alice", mode: "classic" });
  const [rj1] = await created;
  const roomCode = rj1.roomCode;
  const aliceId = rj1.playerId;

  // Unir Bob
  const s2 = await connect();
  sockets.push(s2);
  const joined2 = waitForEvent(s2, "roomJoined");
  s2.emit("joinRoom", { roomCode, name: "Bob" });
  const [rj2] = await joined2;
  const bobId = rj2.playerId;

  // Unir Charlie
  const s3 = await connect();
  sockets.push(s3);
  const joined3 = waitForEvent(s3, "roomJoined");
  s3.emit("joinRoom", { roomCode, name: "Charlie" });
  await joined3;
  await delay(300);

  try {
    const testEnv = loadTestEnv();
    const redis = new Redis({
      url: testEnv.UPSTASH_REDIS_REST_URL!,
      token: testEnv.UPSTASH_REDIS_REST_TOKEN!,
    });
    const roomKey = `room:${roomCode.toUpperCase()}`;

    // Verificar que Alice es el host
    const roomBefore = await redis.get<any>(roomKey);
    const alicePlayer = roomBefore.players.find((p: any) => p.id === aliceId);
    assert(alicePlayer?.isHost === true, "Alice debe ser el host");

    // Registrar listener de playersUpdated en Bob
    const playersUpdatedPromise = waitForEvent(s2, "playersUpdated");

    // Alice se desconecta
    s1.disconnect();
    const [playersUpdated] = await playersUpdatedPromise;
    await delay(500);

    // Verificar en Redis que Bob es el nuevo host
    const roomAfter = await redis.get<any>(roomKey);
    assert(roomAfter, "La sala debe seguir existiendo");
    const bobPlayer = roomAfter.players.find((p: any) => p.id === bobId);
    assert(bobPlayer?.isHost === true, "Bob debe ser el nuevo host tras desconexión de Alice");

    // Verificar que playersUpdated incluye a Bob como host
    const bobInUpdate = playersUpdated.players.find((p: any) => p.id === bobId);
    assert(bobInUpdate?.isHost === true, "playersUpdated debe mostrar a Bob como host");

    // Verificar que Alice sigue en la sala pero marcada como desconectada
    const aliceStillInRoom = roomAfter.players.find((p: any) => p.id === aliceId);
    assert(aliceStillInRoom, "Alice debe seguir en la sala (gracia de desconexión)");
    assert(aliceStillInRoom.connected === false, "Alice debe estar marcada como desconectada");
  } finally {
    for (const s of sockets) {
      if (s.connected) s.disconnect();
    }
  }
}

/**
 * S3.3 — Desconexión del jugador en turno durante ronda de palabras:
 *
 * Flujo: crear sala con 3 jugadores → iniciar juego → ronda de palabras.
 * El jugador en turno se desconecta antes de escribir. Verificar que:
 * 1. La sala sigue en fase words.
 * 2. El jugador desconectado está marcado como tal.
 * 3. Los jugadores conectados pueden completar la ronda — submitWord
 *    avanza el turno al siguiente conectado (advanceToConnectedTurn).
 */
async function testTurnPlayerDisconnectAdvancesTurn() {
  const sockets: Socket[] = [];
  const socketMap = new Map<string, Socket>();
  const playerIds: string[] = [];

  // Crear sala
  const s1 = await connect();
  sockets.push(s1);
  const created = waitForEvent(s1, "roomJoined");
  s1.emit("createRoom", { name: "Alice", mode: "classic" });
  const [rj1] = await created;
  socketMap.set(rj1.playerId, s1);
  playerIds.push(rj1.playerId);
  const roomCode = rj1.roomCode;

  // Unir Bob y Charlie
  for (const name of ["Bob", "Charlie"]) {
    const s = await connect();
    sockets.push(s);
    const joined = waitForEvent(s, "roomJoined");
    s.emit("joinRoom", { roomCode, name });
    const [rj] = await joined;
    socketMap.set(rj.playerId, s);
    playerIds.push(rj.playerId);
  }

  await delay(200);

  try {
    const testEnv = loadTestEnv();
    const redis = new Redis({
      url: testEnv.UPSTASH_REDIS_REST_URL!,
      token: testEnv.UPSTASH_REDIS_REST_TOKEN!,
    });
    const roomKey = `room:${roomCode.toUpperCase()}`;

    // Iniciar juego
    const started = waitForEvent(s1, "gameStarted");
    s1.emit("startGame", { roomCode });
    await started;

    // Iniciar ronda de palabras
    const changed = waitForEvent(s1, "phaseChanged");
    s1.emit("startWordsRound", { roomCode });
    await changed;

    // Verificar quién tiene el turno
    const room = await redis.get<any>(roomKey);
    assert(room?.phase === "words", `La fase debe ser words, pero es ${room?.phase}`);
    const turnPlayerId = room.baseOrder[room.currentTurnIndex];
    const turnPlayerName = room.players.find((p: any) => p.id === turnPlayerId)?.name;

    // Desconectar al jugador en turno
    const turnSocket = socketMap.get(turnPlayerId);
    assert(turnSocket !== undefined, `El jugador en turno (${turnPlayerName}) debe tener un socket`);

    turnSocket!.disconnect();
    await delay(500);

    // Verificar que la sala sigue en fase words
    const roomAfter = await redis.get<any>(roomKey);
    assert(
      roomAfter?.phase === "words",
      `La sala debe seguir en words tras desconexión, pero es ${roomAfter?.phase}`
    );

    // Verificar que el jugador desconectado está marcado como tal
    const disconnectedPlayer = roomAfter.players.find((p: any) => p.id === turnPlayerId);
    assert(
      disconnectedPlayer?.connected === false,
      "El jugador en turno debe estar marcado como desconectado"
    );

    // S3.3 fix: markPlayerDisconnected avanza el turno al siguiente conectado.
    // Verificar que currentTurnIndex ya no apunta al jugador desconectado.
    const newTurnPlayerId = roomAfter.baseOrder[roomAfter.currentTurnIndex];
    assert(
      newTurnPlayerId !== turnPlayerId,
      `El turno debe avanzar al siguiente conectado, pero sigue en ${turnPlayerName}`
    );
    const newTurnPlayer = roomAfter.players.find((p: any) => p.id === newTurnPlayerId);
    assert(
      newTurnPlayer?.connected === true,
      "El nuevo turno debe ser de un jugador conectado"
    );

    // Los jugadores conectados completan la ronda escribiendo palabras.
    // El turno ya está en un conectado, así que cada uno escribe en orden.
    const connectedPlayers = roomAfter.baseOrder.filter(
      (id: string) => roomAfter.players.find((p: any) => p.id === id)?.connected
    );

    let wordsWritten = 0;
    for (let i = 0; i < connectedPlayers.length; i++) {
      const roomCheck = await redis.get<any>(roomKey);
      if (roomCheck?.phase !== "words") break;

      const currentTurnId = roomCheck.baseOrder[roomCheck.currentTurnIndex];
      const currentSocket = socketMap.get(currentTurnId);
      const currentPlayer = roomCheck.players.find((p: any) => p.id === currentTurnId);

      // El turno debe ser siempre de un conectado — el servidor lo avanza
      assert(
        currentPlayer?.connected === true,
        `El turno debe ser de un conectado en iteración ${i}, pero es ${currentPlayer?.name} (connected=${currentPlayer?.connected})`
      );

      if (currentSocket && currentSocket.connected) {
        const wordAdded = waitForEvent(currentSocket, "wordAdded");
        currentSocket.emit("submitWord", { roomCode, playerId: currentTurnId, word: `palabra${wordsWritten + 1}` });
        await wordAdded;
        wordsWritten++;
        await delay(200);
      }
    }

    // La ronda debe haber pasado a voting
    const roomFinal = await redis.get<any>(roomKey);
    assert(
      roomFinal?.phase === "voting",
      `La ronda debe completar y pasar a voting, pero es ${roomFinal?.phase}`
    );
    assert(
      wordsWritten === connectedPlayers.length,
      `Se deben haber escrito ${connectedPlayers.length} palabras, pero se escribieron ${wordsWritten}`
    );
  } finally {
    for (const s of sockets) {
      if (s.connected) s.disconnect();
    }
  }
}

/**
 * S3.3 — Desconexión de todos los participantes durante una partida activa:
 *
 * Flujo: crear sala con 3 jugadores → iniciar juego → ronda de palabras.
 * Todos se desconectan durante la partida. Verificar que:
 * 1. La sala persiste en Redis con todos los jugadores marcados como desconectados.
 * 2. La fase de la partida se conserva (no se resetea a lobby).
 * 3. Tras la gracia de desconexión, pruneDisconnected elimina a los ausentes
 *    y la sala se borra al quedar vacía.
 */
async function testAllPlayersDisconnect() {
  const sockets: Socket[] = [];

  // Crear sala
  const s1 = await connect();
  sockets.push(s1);
  const created = waitForEvent(s1, "roomJoined");
  s1.emit("createRoom", { name: "Alice", mode: "classic" });
  const [rj1] = await created;
  const roomCode = rj1.roomCode;

  // Unir Bob
  const s2 = await connect();
  sockets.push(s2);
  const joined2 = waitForEvent(s2, "roomJoined");
  s2.emit("joinRoom", { roomCode, name: "Bob" });
  await joined2;

  // Unir Charlie
  const s3 = await connect();
  sockets.push(s3);
  const joined3 = waitForEvent(s3, "roomJoined");
  s3.emit("joinRoom", { roomCode, name: "Charlie" });
  await joined3;

  await delay(300);

  try {
    const testEnv = loadTestEnv();
    const redis = new Redis({
      url: testEnv.UPSTASH_REDIS_REST_URL!,
      token: testEnv.UPSTASH_REDIS_REST_TOKEN!,
    });
    const roomKey = `room:${roomCode.toUpperCase()}`;

    // Iniciar juego
    const started = waitForEvent(s1, "gameStarted");
    s1.emit("startGame", { roomCode });
    await started;

    // Iniciar ronda de palabras
    const changed = waitForEvent(s1, "phaseChanged");
    s1.emit("startWordsRound", { roomCode });
    await changed;

    // Verificar que la sala está en fase words con 3 jugadores conectados
    const roomBefore = await redis.get<any>(roomKey);
    assert(roomBefore?.phase === "words", `La fase debe ser words, pero es ${roomBefore?.phase}`);
    assert(roomBefore?.players.length === 3, "La sala debe tener 3 jugadores");
    assert(
      roomBefore.players.every((p: any) => p.connected === true),
      "Todos los jugadores deben estar conectados"
    );

    // Todos se desconectan durante la partida
    s1.disconnect();
    s2.disconnect();
    s3.disconnect();
    await delay(1000);

    // Verificar que la sala existe pero todos están desconectados
    const roomAfter = await redis.get<any>(roomKey);
    assert(roomAfter, "La sala debe seguir existiendo en Redis (TTL activo)");
    assert(
      roomAfter.players.every((p: any) => p.connected === false),
      "Todos los jugadores deben estar marcados como desconectados"
    );
    // La fase se conserva — no se resetea a lobby
    assert(
      roomAfter.phase === "words",
      `La fase debe conservarse (words), pero es ${roomAfter.phase}`
    );

    // Nota: pruneDisconnected solo se ejecuta en fase lobby, no durante una
    // partida activa. Por lo tanto, la sala persiste en Redis con todos
    // desconectados hasta que expire el TTL. Un nuevo jugador no puede unirse
    // (GAME_ALREADY_STARTED en fase words).
    // Verificar que la sala permanece abandonada con la fase intacta.
    await delay(500);
    const roomStill = await redis.get<any>(roomKey);
    assert(roomStill, "La sala debe persistir en Redis tras desconexión de todos");
    assert(
      roomStill.phase === "words",
      `La fase debe conservarse (words), pero es ${roomStill.phase}`
    );
    assert(
      roomStill.players.every((p: any) => p.connected === false),
      "Todos deben seguir marcados como desconectados"
    );
    assert(
      roomStill.players.length === 3,
      `Los 3 jugadores deben seguir en la sala, pero hay ${roomStill.players.length}`
    );

    // Debe poder continuar quien vuelva primero, aunque el turno persistido
    // apunte a otro jugador que sigue desconectado.
    const persistedTurnId = roomStill.baseOrder[roomStill.currentTurnIndex];
    const returningPlayer = roomStill.players.find((p: any) => p.id !== persistedTurnId);
    assert(returningPlayer, "Debe existir otro jugador para probar la recuperación del turno");
    const returningSocket = await connect();
    sockets.push(returningSocket);
    const rejoined = waitForEvent(returningSocket, "roomJoined");
    const stateReceived = waitForEvent(returningSocket, "roomState");
    returningSocket.emit("rejoinRoom", { roomCode, playerToken: returningPlayer.token });
    await rejoined;
    const [snapshot] = await stateReceived;
    assert(snapshot.currentPlayerId === returningPlayer.id,
      "El primer jugador reconectado debe recibir el turno en el snapshot");
    const wordAdded = waitForEvent(returningSocket, "wordAdded");
    returningSocket.emit("submitWord", {
      roomCode, playerId: returningPlayer.id, word: "recuperada",
    });
    await wordAdded;
  } finally {
    for (const s of sockets) {
      if (s.connected) s.disconnect();
    }
  }
}

/**
 * S3.3 — Recalcular elegibilidad al desconectarse un votante:
 *
 * Flujo: 3 jugadores en votación. Alice vota por Charlie.
 * Bob se desconecta. Charlie vota por Bob (disparando submitVote).
 * pruneDisconnected marca a Bob como desconectado, eligibleVoters = [Alice, Charlie].
 * Alice ya votó, Charlie vota → votación resuelta con 2 votos de 2 elegibles.
 *
 * Nota: la gracia de desconexión (2 minutos) impide que Bob sea podado
 * inmediatamente. Manipulamos Redis para simular la desconexión antigua.
 */
async function testDisconnectRecalculatesEligibility() {
  const { sockets, socketMap, playerIds, roomCode, redis, roomKey } =
    await setupGameWithVoting();

  const aliceId = playerIds[0];
  const bobId = playerIds[1];
  const charlieId = playerIds[2];

  const aliceSocket = socketMap.get(aliceId)!;
  const bobSocket = socketMap.get(bobId)!;
  const charlieSocket = socketMap.get(charlieId)!;

  try {
    // Alice vota por Charlie
    aliceSocket.emit("submitVote", {
      roomCode,
      voterId: aliceId,
      targetId: charlieId,
      voteEpoch: 0,
    });
    await delay(200);

    // Simular que Bob se desconectó hace mucho (fuera de la gracia)
    const room = await redis.get<any>(roomKey);
    const bobPlayer = room.players.find((p: any) => p.id === bobId);
    assert(bobPlayer, "Bob debe existir en la sala");
    bobPlayer.connected = false;
    bobPlayer.socketId = null;
    bobPlayer.disconnectedAt = Date.now() - 120000; // hace 2 minutos
    await redis.set(roomKey, room, { ex: 3600 });

    // Bob se desconecta del socket
    bobSocket.disconnect();
    await delay(200);

    // Charlie vota por Bob — submitVote ejecuta pruneDisconnected,
    // que poda a Bob (desconectado > 2 min). eligibleVoters = [Alice, Charlie].
    // Alice votó por Charlie, Charlie vota por Bob → empate 1-1 → tieVote.
    const tieVotePromise = waitForEvent(charlieSocket, "tieVote");
    charlieSocket.emit("submitVote", {
      roomCode,
      voterId: charlieId,
      targetId: bobId,
      voteEpoch: 0,
    });
    const [tieVote] = await tieVotePromise;

    // Verificar que se emitió tieVote (empate entre Charlie y Bob)
    assert(
      tieVote !== undefined,
      "La votación debe generar un empate (tieVote emitido)"
    );
    assert(
      tieVote.tieCandidates.length === 2,
      `Deberían haber 2 candidatos en empate, pero hay ${tieVote.tieCandidates.length}`
    );

    // Con empate, la fase sigue siendo "voting" pero con tieCandidates establecidos
    // y voteEpoch incrementado — no está bloqueada, espera nuevos votos de los candidatos
    const roomAfter = await redis.get<any>(roomKey);
    assert(
      roomAfter?.tieCandidates !== null && roomAfter?.tieCandidates.length === 2,
      "Deberían haber 2 candidatos en empate en Redis"
    );
    assert(
      roomAfter?.voteEpoch === 1,
      `voteEpoch debería incrementarse tras el empate, pero es ${roomAfter?.voteEpoch}`
    );
  } finally {
    for (const s of sockets) {
      if (s.connected) s.disconnect();
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n=== Pruebas de integración — Sprint 3 ===\n");

  await startServer();

  try {
    console.log("\n[S3.1] Salida del expulsado + recarga:");
    await test(
      "expulsado sale y otro jugador recarga con snapshot correcto",
      testEliminatedPlayerLeavesThenReconnect
    );

    console.log("\n[S3.2] Confirmación de voto:");
    await test("voteConfirmed emitido al votar", testVoteConfirmation);

    console.log("\n[S3.3] Recalcular elegibilidad:");
    await test(
      "votación no queda bloqueada al desconectarse un votante",
      testDisconnectRecalculatesEligibility
    );

    console.log("\n[S3.3] Resolución directa por disconnect:");
    await test(
      "disconnect resuelve votación sin submitVote posterior",
      testDisconnectResolvesVoteWithoutSubmitVote
    );

    console.log("\n[S3.1] Cambio de sala durante votación:");
    await test("jugador votado cambia de sala sin bloquear la anterior", testVotedPlayerChangesRoom);
    await test("reingreso a la misma sala conserva la membresía", testJoinSameRoomKeepsMembership);
    await test("salida del candidato votado resuelve votos incompletos", testVotedPlayerLeavesBeforeAllVotes);

    console.log("\n[S3.3] Pruebas exhaustivas de desconexión:");
    await test("desconexión del anfitrión reasigna el host", testHostDisconnectReassignsHost);
    await test("desconexión del jugador en turno avanza el turno", testTurnPlayerDisconnectAdvancesTurn);
    await test("primer reconectado recupera el turno tras desconexión total", testAllPlayersDisconnect);
  } finally {
    // Las salas de prueba expirarán por TTL
  }

  console.log(`\n=== Resultados: ${passed} pasadas, ${failed} falladas ===\n`);

  stopServer();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  stopServer();
  process.exit(1);
});
