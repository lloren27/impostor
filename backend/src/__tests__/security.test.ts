/**
 * Pruebas de regresión de seguridad — Sprint 1.
 *
 * Ejecutar con:
 *   npm run test:security
 *
 * Requiere un Redis de pruebas configurado en backend/.env.test.
 * Si no está en ejecución, el script lanza el backend automáticamente
 * usando las credenciales de ese archivo.
 *
 * IMPORTANTE: No usar las credenciales de producción en .env.test.
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

/**
 * Encuentra un puerto TCP libre para arrancar el backend de pruebas.
 * Garantiza que las pruebas no reutilicen un servidor ajeno.
 */
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

/**
 * Carga las credenciales de .env.test para usar un Redis independiente
 * de producción durante las pruebas.
 *
 * Aislamiento estricto:
 * - No hereda UPSTASH_REDIS_* de process.env para evitar usar producción.
 * - Exige que .env.test exista y tenga credenciales activas.
 * - Pasa DOTENV_CONFIG_PATH=.env.test al backend para que dotenv cargue
 *   el archivo correcto en vez de .env.
 */
function loadTestEnv(): NodeJS.ProcessEnv {
  const backendRoot = join(__dirname, "..", "..");
  const envTestPath = join(backendRoot, ".env.test");

  // Partir de un entorno mínimo — NO heredar process.env completo,
  // porque podría contener credenciales de producción.
  // PORT se establece en startServer() con un puerto libre.
  const testEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH || "",
    HOME: process.env.HOME || "",
    LANG: process.env.LANG || "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    // Indicar a dotenv que cargue .env.test en vez de .env
    DOTENV_CONFIG_PATH: envTestPath,
  };

  if (!fs.existsSync(envTestPath)) {
    throw new Error(
      "[setup] .env.test not found. Create backend/.env.test with test Redis credentials.\n" +
      "Do NOT use production credentials. See .env.test template for instructions."
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

  // Exigir que las credenciales de Redis estén configuradas
  if (!parsed.UPSTASH_REDIS_REST_URL || !parsed.UPSTASH_REDIS_REST_TOKEN) {
    throw new Error(
      "[setup] .env.test must define UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.\n" +
      "These MUST point to a test database — never production.\n" +
      "Note: @upstash/redis uses REST API, not native Redis protocol.\n" +
      "A local Redis server won't work directly; use an Upstash test database."
    );
  }

  // Aplicar las credenciales de .env.test al entorno
  Object.assign(testEnv, parsed);
  console.log("[setup] Using .env.test for Redis credentials (isolated from production)");

  return testEnv;
}

async function startServer() {
  // Cargar y validar las credenciales de prueba ANTES de cualquier otra acción.
  // Esto falla si .env.test no está configurado, evitando silenciosamente
  // usar credenciales de producción.
  const testEnv = loadTestEnv();

  // Siempre usar un puerto libre para garantizar aislamiento.
  // Un backend ajeno podría usar Redis de producción; nunca lo reutilizamos.
  testPort = await findFreePort();
  testEnv.PORT = String(testPort);

  console.log(`[setup] Starting backend server on port ${testPort} with test credentials...`);
  serverProcess = spawn("npx", ["ts-node", "src/index.ts"], {
    cwd: join(__dirname, "..", ".."),
    stdio: ["ignore", "pipe", "pipe"],
    env: testEnv,
  });

  serverProcess.stderr?.on("data", (d) => process.stderr.write(d));

  // Wait for server to be ready
  for (let i = 0; i < 20; i++) {
    await delay(500);
    try {
      const s = await connect();
      s.disconnect();
      console.log(`[setup] Backend started on port ${testPort}`);
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
// Tests
// ---------------------------------------------------------------------------

async function testSocketRevocation() {
  // Crear sala con socket1
  const socket1 = await connect();
  socket1.emit("createRoom", { name: "Alice", mode: "classic" });
  const [rejoin1] = await waitForEvent(socket1, "roomJoined");
  const roomCode = rejoin1.roomCode;
  const token = rejoin1.playerToken;

  // Registrar desconexión antes de la reconexión
  let socket1Disconnected = false;
  socket1.on("disconnect", () => {
    socket1Disconnected = true;
  });

  // Socket2 se reconecta con el mismo token
  const socket2 = await connect();
  socket2.emit("rejoinRoom", { roomCode, playerToken: token });
  const [rejoin2] = await waitForEvent(socket2, "roomJoined");

  assert(rejoin2.playerId === rejoin1.playerId, "socket2 debería tener el mismo playerId");

  // Esperar a que la revocación ocurra
  await delay(300);

  // Socket1 debería haber sido desconectado
  assert(
    socket1Disconnected,
    "socket1 debería haber sido desconectado tras la reconexión con socket2"
  );

  socket1.disconnect();
  socket2.disconnect();
}

async function testPublicDataPrivacy() {
  const socket1 = await connect();
  socket1.emit("createRoom", { name: "Alice", mode: "classic" });
  const [rj1] = await waitForEvent(socket1, "roomJoined");
  const roomCode = rj1.roomCode;

  // Crear un segundo jugador
  const socket2 = await connect();
  socket2.emit("joinRoom", {
    roomCode,
    name: "Bob",
  });

  // Capturar playersUpdated — waitForEvent devuelve un array de args
  const [playersUpdatedArgs] = await Promise.all([
    waitForEvent(socket1, "playersUpdated"),
  ]);
  // El primer argumento es el objeto { players: [...] }
  const playersUpdated = Array.isArray(playersUpdatedArgs)
    ? playersUpdatedArgs[0]
    : playersUpdatedArgs;

  // Verificar que ningún jugador expone campos privados
  const players = playersUpdated.players;
  for (const p of players) {
    assert(!("token" in p), `player ${p.id} no debería exponer token`);
    assert(!("socketId" in p), `player ${p.id} no debería exponer socketId`);
    assert(!("isImpostor" in p), `player ${p.id} no debería exponer isImpostor`);
    assert(!("character" in p), `player ${p.id} no debería exponer character`);
  }

  socket1.disconnect();
  socket2.disconnect();
}

async function testSubmitWordRequiresAuth() {
  const socket1 = await connect();
  socket1.emit("createRoom", { name: "Alice", mode: "classic" });
  const [rj1] = await waitForEvent(socket1, "roomJoined");
  const roomCode = rj1.roomCode;
  const playerId = rj1.playerId;

  // Socket2 intenta enviar una palabra con el playerId de socket1
  const socket2 = await connect();
  socket2.emit("joinRoom", { roomCode, name: "Bob" });
  await waitForEvent(socket2, "roomJoined");

  let gotError = false;
  socket2.once("errorMessage", (err: any) => {
    gotError = err.code === "UNAUTHORIZED";
  });

  socket2.emit("submitWord", { roomCode, playerId, word: "hack" });
  await delay(300);

  assert(gotError, "socket2 debería recibir UNAUTHORIZED al enviar palabra de otro jugador");

  socket1.disconnect();
  socket2.disconnect();
}

async function testSubmitVoteRequiresAuth() {
  const socket1 = await connect();
  socket1.emit("createRoom", { name: "Alice", mode: "classic" });
  const [rj1] = await waitForEvent(socket1, "roomJoined");
  const roomCode = rj1.roomCode;
  const playerId = rj1.playerId;

  const socket2 = await connect();
  socket2.emit("joinRoom", { roomCode, name: "Bob" });
  const [rj2] = await waitForEvent(socket2, "roomJoined");

  let gotError = false;
  socket2.once("errorMessage", (err: any) => {
    gotError = err.code === "UNAUTHORIZED";
  });

  // Socket2 intenta votar como socket1
  socket2.emit("submitVote", { roomCode, voterId: playerId, targetId: rj2.playerId });
  await delay(300);

  assert(gotError, "socket2 debería recibir UNAUTHORIZED al votar como otro jugador");

  socket1.disconnect();
  socket2.disconnect();
}

async function testStartNextRoundRequiresHost() {
  // Socket1 (host) crea la sala
  const socket1 = await connect();
  socket1.emit("createRoom", { name: "Alice", mode: "classic" });
  const [rj1] = await waitForEvent(socket1, "roomJoined");
  const roomCode = rj1.roomCode;

  // Socket2 (no host) se une a la sala
  const socket2 = await connect();
  socket2.emit("joinRoom", { roomCode, name: "Bob" });
  await waitForEvent(socket2, "roomJoined");

  // Socket2 intenta iniciar ronda — debería recibir ONLY_HOST_CAN_START.
  // Index.ts verifica el host ANTES de llamar al gestor, así que el error
  // es ONLY_HOST_CAN_START independientemente de la fase actual.
  const rejected = waitForEvent(socket2, "errorMessage");
  socket2.emit("startNextRound", { roomCode });
  const [error] = await rejected;

  assert(
    error.code === "ONLY_HOST_CAN_START",
    "socket2 debería recibir ONLY_HOST_CAN_START al intentar iniciar ronda sin ser host"
  );

  socket1.disconnect();
  socket2.disconnect();
}

// ---------------------------------------------------------------------------
// Pruebas adicionales — Sprint 1
// ---------------------------------------------------------------------------

/**
 * S1.2 — Revocación por joinRoom con token: cuando un jugador se une con
 * joinRoom incluyendo playerToken, joinOrRejoinRoom detecta que ya existe
 * un jugador con ese token y revoca el socket anterior.
 *
 * Esta es la rama DISTINCTA de testSocketRevocation (que usa rejoinRoom).
 */
async function testJoinRoomRevokesOldSocket() {
  // Socket1 crea la sala
  const socket1 = await connect();
  socket1.emit("createRoom", { name: "Alice", mode: "classic" });
  const [rj1] = await waitForEvent(socket1, "roomJoined");
  const roomCode = rj1.roomCode;

  // Socket2 se une como Bob
  const socket2 = await connect();
  socket2.emit("joinRoom", { roomCode, name: "Bob" });
  const [rj2] = await waitForEvent(socket2, "roomJoined");
  const bobPlayerId = rj2.playerId;
  const bobToken = rj2.playerToken;

  // Registrar desconexión de socket2 ANTES de la reconexión
  let socket2Disconnected = false;
  socket2.on("disconnect", () => {
    socket2Disconnected = true;
  });

  // Socket3 se une con joinRoom + playerToken de Bob.
  // joinOrRejoinRoom detecta el token existente, revoca socket2
  // y asocia socket3 con el playerId de Bob.
  const socket3 = await connect();
  socket3.emit("joinRoom", { roomCode, name: "Bob", playerToken: bobToken });
  const [rj3Args] = await waitForEvent(socket3, "roomJoined");
  const rj3 = Array.isArray(rj3Args) ? rj3Args[0] : rj3Args;

  assert(
    rj3.playerId === bobPlayerId,
    "socket3 debería tener el mismo playerId que socket2 (reconexión por token)"
  );
  assert(
    rj3.isRejoin === true,
    "joinRoom con token existente debe marcar isRejoin=true"
  );

  await delay(300);

  assert(
    socket2Disconnected,
    "socket2 debería haber sido desconectado tras joinRoom con el token de Bob"
  );

  socket1.disconnect();
  socket2.disconnect();
  socket3.disconnect();
}

/**
 * S1.2 — Rechazo de jugador desconectado: prueba directa del gestor.
 *
 * Manipula Redis para poner socketId=null en un jugador conectado y verifica
 * que submitWord es rechazado por la comparación estricta del gestor
 * (`player.socketId !== callerSocketId`).
 *
 * Esto prueba el control del gestor, no solo el manejador de index.ts.
 * El manejador acepta porque socket.data.playerId coincide, pero el gestor
 * rechaza porque player.socketId (null) !== callerSocketId (socket.id).
 */
async function testDisconnectedPlayerRejected() {
  // Crear sala con 3 jugadores para poder iniciar el juego
  const socket1 = await connect();
  socket1.emit("createRoom", { name: "Alice", mode: "classic" });
  const [rj1Args] = await waitForEvent(socket1, "roomJoined");
  const rj1 = Array.isArray(rj1Args) ? rj1Args[0] : rj1Args;
  const roomCode = rj1.roomCode;
  const alicePlayerId = rj1.playerId;

  const socket2 = await connect();
  socket2.emit("joinRoom", { roomCode, name: "Bob" });
  await waitForEvent(socket2, "roomJoined");

  const socket3 = await connect();
  socket3.emit("joinRoom", { roomCode, name: "Charlie" });
  await waitForEvent(socket3, "roomJoined");

  await delay(300);

  // Iniciar el juego: lobby → reveal → words
  socket1.emit("startGame", { roomCode });
  const [gsArgs] = await waitForEvent(socket1, "gameStarted");
  const gs = Array.isArray(gsArgs) ? gsArgs[0] : gsArgs;
  assert(gs.phase === "reveal", "startGame debería cambiar la fase a reveal");

  socket1.emit("startWordsRound", { roomCode });
  const [pcArgs] = await waitForEvent(socket1, "phaseChanged");
  const pc = Array.isArray(pcArgs) ? pcArgs[0] : pcArgs;
  assert(pc.phase === "words", "startWordsRound debería cambiar la fase a words");

  // Manipular Redis: poner socketId=null en Alice mientras el socket1
  // sigue asociado (socket.data.playerId === alicePlayerId).
  // El manejador de index.ts acepta, pero el gestor rechaza.
  // Las credenciales no están en process.env porque loadTestEnv
  // no las hereda; cargarlas desde .env.test directamente.
  const testEnv = loadTestEnv();
  const redis = new Redis({
    url: testEnv.UPSTASH_REDIS_REST_URL!,
    token: testEnv.UPSTASH_REDIS_REST_TOKEN!,
  });
  const roomKey = `room:${roomCode.toUpperCase()}`;
  const roomData = await redis.get<any>(roomKey);
  assert(roomData, "la sala debería existir en Redis");

  const alicePlayer = roomData.players.find((p: any) => p.id === alicePlayerId);
  assert(alicePlayer, "Alice debería existir en la sala");
  const originalSocketId = alicePlayer.socketId;
  assert(originalSocketId !== null, "Alice debería tener un socketId antes de manipular");

  // Poner socketId=null en Redis
  alicePlayer.socketId = null;
  alicePlayer.connected = false;
  await redis.set(roomKey, roomData, { ex: 3600 });

  // Ahora socket1 intenta enviar una palabra.
  // El manejador acepta (socket.data.playerId === alicePlayerId),
  // pero el gestor rechaza (player.socketId null !== callerSocketId).
  let gotError = false;
  let errorCode: string | null = null;
  socket1.once("errorMessage", (err: any) => {
    gotError = true;
    errorCode = err.code;
  });

  socket1.emit("submitWord", { roomCode, playerId: alicePlayerId, word: "test" });
  await delay(500);

  try {
    // Verificar que el gestor rechaza la acción de un jugador desconectado.
    // Estas aserciones están dentro del try para que finally restaure
    // el jugador incluso si fallan.
    assert(
      gotError,
      "el gestor debe rechazar submitWord cuando player.socketId es null"
    );
    assert(
      errorCode === "UNAUTHORIZED",
      `el error debe ser UNAUTHORIZED, pero es ${errorCode}`
    );

    // Verificar que el estado permanece intacto leyendo directamente de Redis.
    // No podemos unir un cuarto jugador porque la sala ya está en juego.
    const roomDataAfter = await redis.get<any>(roomKey);
    assert(roomDataAfter, "la sala debería existir en Redis después del intento fallido");

    // La sala debe seguir en fase words
    assert(
      roomDataAfter.phase === "words",
      `la sala debería seguir en words tras el intento fallido, pero está en ${roomDataAfter.phase}`
    );

    // Verificar que "test" no está en las palabras
    if (roomDataAfter.words && Array.isArray(roomDataAfter.words)) {
      const hasTestWord = roomDataAfter.words.some((w: any) => w.word === "test");
      assert(
        !hasTestWord,
        "la palabra 'test' no debería estar en la sala tras el intento fallido"
      );
    }
  } finally {
    // Restaurar el socketId original en el objeto ACTUAL de Redis,
    // no en el snapshot anterior (roomData) que ya no es el estado vigente.
    const roomDataCurrent = await redis.get<any>(roomKey);
    if (roomDataCurrent) {
      const alicePlayerCurrent = roomDataCurrent.players.find((p: any) => p.id === alicePlayerId);
      if (alicePlayerCurrent) {
        alicePlayerCurrent.socketId = originalSocketId;
        alicePlayerCurrent.connected = true;
        await redis.set(roomKey, roomDataCurrent, { ex: 3600 });
      }
    }
  }

  socket1.disconnect();
  socket2.disconnect();
  socket3.disconnect();
}

/**
 * S1.1 — Privacidad en roomJoined: el evento roomJoined no debe exponer
 * campos privados de otros jugadores.
 */
async function testRoomJoinedPrivacy() {
  // Crear sala y verificar que roomJoined del creador no expone campos privados
  const socket1 = await connect();
  socket1.emit("createRoom", { name: "Alice", mode: "classic" });
  const [rj1Args] = await waitForEvent(socket1, "roomJoined");

  // roomJoined devuelve un array de args; el primer elemento es el dato
  const rj1 = Array.isArray(rj1Args) ? rj1Args[0] : rj1Args;

  // El token propio está en playerToken (campo separado), no en el objeto del jugador
  // Verificar que la respuesta no expone campos privados en el nivel superior
  // (playerToken es legítimo; token, socketId, isImpostor no)
  assert(
    "playerToken" in rj1,
    "roomJoined debe incluir playerToken para el jugador propio"
  );

  // Los jugadores están en rj1.room.players, no en rj1.players.
  // Exigir que room.players exista para evitar falsos positivos.
  assert(
    "room" in rj1 && "players" in rj1.room && Array.isArray(rj1.room.players),
    "roomJoined debe incluir room.players"
  );
  for (const p of rj1.room.players) {
    assert(!("token" in p), `jugador en roomJoined no debería exponer token`);
    assert(!("socketId" in p), `jugador en roomJoined no debería exponer socketId`);
    assert(!("isImpostor" in p), `jugador en roomJoined no debería exponer isImpostor`);
    assert(!("character" in p), `jugador en roomJoined no debería exponer character`);
  }

  // Un segundo jugador se une y verifica su roomJoined
  const socket2 = await connect();
  socket2.emit("joinRoom", { roomCode: rj1.roomCode, name: "Bob" });
  const [rj2Args] = await waitForEvent(socket2, "roomJoined");
  const rj2 = Array.isArray(rj2Args) ? rj2Args[0] : rj2Args;

  // Mismo control para el segundo jugador
  assert(
    "room" in rj2 && "players" in rj2.room && Array.isArray(rj2.room.players),
    "roomJoined (segundo jugador) debe incluir room.players"
  );
  for (const p of rj2.room.players) {
    assert(!("token" in p), `jugador en roomJoined (segundo jugador) no debería exponer token`);
    assert(!("socketId" in p), `jugador en roomJoined (segundo jugador) no debería exponer socketId`);
    assert(!("isImpostor" in p), `jugador en roomJoined (segundo jugador) no debería exponer isImpostor`);
  }

  socket1.disconnect();
  socket2.disconnect();
}

/**
 * S1.3 — Redacción de errores: los errores enviados al cliente no deben
 * contener mensajes internos del servidor.
 *
 * safeEmitError solo envía {code, message: code} — el message es el código,
 * no un mensaje raw del servidor. Esta prueba verifica que:
 * 1. Un error conocido (UNAUTHORIZED) devuelve message === code.
 * 2. Un error interno inesperado (provocado corrompiendo Redis) también
 *    devuelve un código genérico sin exponer el mensaje del error ni
 *    detalles internos en la respuesta al cliente.
 */
async function testErrorMessageRedaction() {
  // --- Caso 1: error conocido ---
  const socket = await connect();

  let errorMessageReceived: any = null;
  socket.once("errorMessage", (err: any) => {
    errorMessageReceived = err;
  });

  // Intentar una acción inválida que genere un error conocido
  socket.emit("submitWord", {
    roomCode: "INVALID",
    playerId: "fake",
    word: "test",
  });
  await delay(300);

  assert(
    errorMessageReceived !== null,
    "debería recibir un errorMessage"
  );

  // El error debe tener un código conocido
  assert(
    typeof errorMessageReceived.code === "string",
    "errorMessage debe tener un código"
  );

  // safeEmitError establece message = code, no un mensaje raw del servidor.
  // Exigir igualdad exacta: message debe ser el código, sin excepciones.
  const message = errorMessageReceived.message || "";
  assert(
    message === errorMessageReceived.code,
    `errorMessage.message debe ser exactamente el código (${errorMessageReceived.code}), no "${message}"`
  );

  // El mensaje no debe contener patrones típicos de errores internos
  assert(
    !message.includes("undefined") && !message.includes("TypeError") &&
    !message.includes("ReferenceError") && !message.includes("at ") &&
    !message.includes("stack"),
    "errorMessage no debe contener detalles internos del servidor"
  );

  socket.disconnect();

  // --- Caso 2: error interno inesperado ---
  // Provocar un error corrompiendo los datos de una sala en Redis.
  // Si players no es un array, room.players.find() lanzará un TypeError
  // que no es un error conocido → safeEmitError envía {code: "UNKNOWN", message: "UNKNOWN"}.
  const sensitiveMarker = "SENSITIVE_INTERNAL_DATA_12345";

  const testEnv = loadTestEnv();
  const redis = new Redis({
    url: testEnv.UPSTASH_REDIS_REST_URL!,
    token: testEnv.UPSTASH_REDIS_REST_TOKEN!,
  });

  // Crear una sala válida
  const socket2 = await connect();
  socket2.emit("createRoom", { name: "Alice", mode: "classic" });
  const [rj2Args] = await waitForEvent(socket2, "roomJoined");
  const rj2 = Array.isArray(rj2Args) ? rj2Args[0] : rj2Args;
  const roomCode2 = rj2.roomCode;

  // Corromper la sala: reemplazar players (array) por un objeto con un
  // marcador sensible. Cuando el servidor intente players.find(), lanzará
  // un TypeError cuyo mensaje podría contener referencias internas.
  const roomKey2 = `room:${roomCode2.toUpperCase()}`;
  const roomData2 = await redis.get<any>(roomKey2);
  assert(roomData2, "la sala debería existir en Redis");
  // Reemplazar players por un string con el marcador sensible.
  // Esto provocará un error al intentar iterar o buscar en players.
  roomData2.players = sensitiveMarker;
  await redis.set(roomKey2, roomData2, { ex: 3600 });

  // Intentar una acción que lea la sala corrompida
  let internalErrorMessage: any = null;
  socket2.once("errorMessage", (err: any) => {
    internalErrorMessage = err;
  });

  socket2.emit("submitWord", {
    roomCode: roomCode2,
    playerId: rj2.playerId,
    word: "test",
  });
  await delay(500);

  assert(
    internalErrorMessage !== null,
    "debería recibir un errorMessage tras el error interno"
  );

  // El código debe ser UNKNOWN (no un error conocido)
  assert(
    internalErrorMessage.code === "UNKNOWN",
    `el código debe ser UNKNOWN para un error interno, pero es ${internalErrorMessage.code}`
  );

  // El message debe ser el código, NO el mensaje del error interno
  const internalMessage = internalErrorMessage.message || "";
  assert(
    internalMessage === internalErrorMessage.code,
    `errorMessage.message debe ser el código (${internalErrorMessage.code}), no "${internalMessage}"`
  );

  // El marcador sensible NO debe aparecer en la respuesta al cliente
  const responseStr = JSON.stringify(internalErrorMessage);
  assert(
    !responseStr.includes("SENSITIVE"),
    "la respuesta no debe contener el marcador sensible"
  );
  assert(
    !responseStr.includes("12345"),
    "la respuesta no debe contener parte del marcador sensible"
  );

  // Restaurar la sala para que el disconnect funcione correctamente
  const roomData2Restored = await redis.get<any>(roomKey2);
  if (roomData2Restored) {
    // Crear un array de players válido para que disconnect no falle
    roomData2Restored.players = [];
    await redis.set(roomKey2, roomData2Restored, { ex: 3600 });
  }

  socket2.disconnect();
}

/**
 * S1.3 — Transición inválida: intentar iniciar una ronda de palabras
 * sin estar en fase reveal no debe modificar datos.
 */
async function testInvalidTransition() {
  const socket1 = await connect();
  socket1.emit("createRoom", { name: "Alice", mode: "classic" });
  const [rj1] = await waitForEvent(socket1, "roomJoined");
  const roomCode = rj1.roomCode;

  // La sala está en fase 'waiting' (lobby). Intentar startWordsRound
  // debería fallar sin modificar la sala.
  const rejected = waitForEvent(socket1, "errorMessage");
  socket1.emit("startWordsRound", { roomCode });
  const [error] = await rejected;

  assert(
    error.code === "NOT_REVEAL_ROUND",
    `startWordsRound en fase waiting debería recibir NOT_REVEAL_ROUND, recibió ${error.code}`
  );

  // Verificar que la sala sigue intacta uniéndose
  const socket2 = await connect();
  socket2.emit("joinRoom", { roomCode, name: "Bob" });
  const [rj2] = await waitForEvent(socket2, "roomJoined");

  assert(
    rj2.roomCode === roomCode,
    "la sala debería seguir existiendo tras la transición inválida"
  );

  socket1.disconnect();
  socket2.disconnect();
}

/**
 * S1.3 — Transiciones repetidas: intentar avanzar de fase dos veces
 * seguidas debe rechazar la segunda transición y no modificar datos.
 *
 * Flujo: crear sala con 3 jugadores → startGame (lobby → reveal)
 * → startWordsRound (reveal → words) → tres palabras → voting → un voto
 * → repetir startWordsRound debe fallar sin borrar palabras ni votos.
 *
 * Se compara fase, palabras y votos antes/después para demostrar que
 * Redis permanece intacto tras la transición rechazada.
 */
async function testRepeatedTransitions() {
  const sockets: Socket[] = [];
  try {
    // Registrar cada espera antes de emitir: también funciona con respuestas rápidas.
    const socket1 = await connect();
    sockets.push(socket1);
    const created = waitForEvent(socket1, "roomJoined");
    socket1.emit("createRoom", { name: "Alice", mode: "classic" });
    const [rj1] = await created;
    const roomCode = rj1.roomCode;
    const socketMap = new Map<string, Socket>([[rj1.playerId, socket1]]);
    const playerIds = [rj1.playerId];

    for (const name of ["Bob", "Charlie"]) {
      const socket = await connect();
      sockets.push(socket);
      const joined = waitForEvent(socket, "roomJoined");
      socket.emit("joinRoom", { roomCode, name });
      const [player] = await joined;
      socketMap.set(player.playerId, socket);
      playerIds.push(player.playerId);
    }

    const started = waitForEvent(socket1, "gameStarted");
    socket1.emit("startGame", { roomCode });
    const [gameStarted] = await started;
    assert(gameStarted.phase === "reveal", "startGame debe pasar a reveal");

    const changed = waitForEvent(socket1, "phaseChanged");
    socket1.emit("startWordsRound", { roomCode });
    const [phaseChanged] = await changed;
    assert(phaseChanged.phase === "words", "startWordsRound debe pasar a words");

    const testEnv = loadTestEnv();
    const redis = new Redis({
      url: testEnv.UPSTASH_REDIS_REST_URL!,
      token: testEnv.UPSTASH_REDIS_REST_TOKEN!,
    });
    const roomKey = `room:${roomCode.toUpperCase()}`;

    for (let i = 0; i < 3; i++) {
      const room = await redis.get<any>(roomKey);
      assert(room?.phase === "words", "la sala debe admitir la siguiente palabra");
      const playerId = room.baseOrder[room.currentTurnIndex];
      const socket = socketMap.get(playerId);
      assert(!!socket, "el jugador del turno debe tener un socket asociado");
      const added = waitForEvent(socket!, "wordAdded");
      socket!.emit("submitWord", { roomCode, playerId, word: `palabra${i + 1}` });
      const [entry] = await added;
      assert(entry.playerId === playerId && entry.word === `palabra${i + 1}`,
        "debe confirmarse la palabra del jugador en turno");
    }

    // Un voto no finaliza la votación de tres jugadores. El servidor no emite
    // confirmación para ese voto: esperar su persistencia, con un plazo acotado.
    socket1.emit("submitVote", {
      roomCode, voterId: playerIds[0], targetId: playerIds[1],
    });
    const deadline = Date.now() + 5000;
    let before: any;
    do {
      before = await redis.get<any>(roomKey);
      if (before?.votes?.some((v: any) =>
        v.voterId === playerIds[0] && v.targetId === playerIds[1])) break;
      await delay(50);
    } while (Date.now() < deadline);

    assert(before?.phase === "voting", "las tres palabras deben iniciar voting");
    assert(Array.isArray(before.words) && before.words.length === 3,
      "la prueba requiere tres palabras persistidas");
    assert(Array.isArray(before.votes) && before.votes.length === 1 &&
      before.votes[0].voterId === playerIds[0] && before.votes[0].targetId === playerIds[1],
      "la prueba requiere el voto persistido antes de repetir la transición");
    const wordsBefore = JSON.stringify(before.words);
    const votesBefore = JSON.stringify(before.votes);

    const rejected = waitForEvent(socket1, "errorMessage");
    socket1.emit("startWordsRound", { roomCode });
    const [error] = await rejected;
    assert(error.code === "NOT_REVEAL_ROUND",
      "repetir startWordsRound debe devolver NOT_REVEAL_ROUND");

    const after = await redis.get<any>(roomKey);
    assert(after?.phase === before.phase, "el rechazo no debe cambiar la fase");
    assert(JSON.stringify(after.words) === wordsBefore,
      "el rechazo debe conservar palabras, autores y orden");
    assert(JSON.stringify(after.votes) === votesBefore,
      "el rechazo debe conservar los votos completos");
  } finally {
    for (const socket of sockets) socket.disconnect();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n=== Pruebas de regresión de seguridad — Sprint 1 ===\n");

  await startServer();

  try {
    console.log("\n[1] Revocación del socket anterior:");
    await test("rejoinRoom revoca el socket anterior", testSocketRevocation);
    await test("joinRoom + rejoinRoom revoca el socket anterior", testJoinRoomRevokesOldSocket);

    console.log("\n[2] Privacidad de datos públicos:");
    await test("playersUpdated no expone campos privados", testPublicDataPrivacy);
    await test("roomJoined no expone campos privados", testRoomJoinedPrivacy);

    console.log("\n[3] Permisos en submitWord:");
    await test("submitWord exige identidad del socket", testSubmitWordRequiresAuth);

    console.log("\n[4] Permisos en submitVote:");
    await test("submitVote exige identidad del socket", testSubmitVoteRequiresAuth);

    console.log("\n[5] Permisos en startNextRound:");
    await test("startNextRound exige anfitrión", testStartNextRoundRequiresHost);

    console.log("\n[6] Rechazo de jugador desconectado:");
    await test("submitWord rechaza jugador desconectado", testDisconnectedPlayerRejected);

    console.log("\n[7] Redacción de errores:");
    await test("errorMessage no filtra detalles internos", testErrorMessageRedaction);

    console.log("\n[8] Transiciones inválidas:");
    await test("startWordsRound en fase incorrecta falla", testInvalidTransition);

    console.log("\n[9] Transiciones repetidas:");
    await test("startWordsRound repetido es rechazado", testRepeatedTransitions);
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
