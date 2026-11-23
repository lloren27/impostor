import { settings, originAllowed } from "./config";
import { consumeRate, clientIP, RateGroup } from "./rateLimit";

import express from "express";
import http from "http";
import cors from "cors";
import { Server as SocketIOServer } from "socket.io";

import {
  getRoom,
  createRoom,
  joinRoom,
  rejoinRoom,
  startGame,
  startWordsRound,
  submitWord,
  submitVote,
  startNextRound,
  restartGame,
  deleteRoom,
  markPlayerDisconnected,
  joinOrRejoinRoom,
  leaveRoom,
  removePlayerFromPreviousRoom,
} from "./game/roomsManagerRedis";
import { KNOWN_ERROR_CODES } from "./constants/errors";
import { GameMode, Player, Room, toPublicPlayer } from "./game/types";
import {
  validateEvent,
  validateName,
  validateWord,
  validateRoomCode,
  validatePlayerToken,
  validateMode,
  validatePlayerId,
} from "./constants/validation";

const PORT = settings.port;
const allowedOrigins = settings.origins;

const app = express();

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  })
);
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Endpoint para comprobar si existe una sala
app.get("/rooms/:code", async (req, res) => {
  try {
    const code = validateRoomCode(req.params.code);
    await consumeRate("lookup", clientIP(req));
    const room = await getRoom(code);

    if (!room) return res.status(404).json({ exists: false });
    return res.json({ exists: true, code });
  } catch (err) {
    logError("GET /rooms/:code", err);
    const code = getErrorCode(err);
    if (code === "RATE_LIMITED") res.setHeader("Retry-After", "60");
    return res.status(code === "RATE_LIMITED" ? 429 : code === "INVALID_ROOM_CODE" ? 400 : 503).json({ exists: false, code });
  }
});

const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: { origin: allowedOrigins, credentials: true },
  maxHttpBufferSize: 4096,
  allowRequest: (req, callback) => {
    if (!originAllowed(req.headers.origin)) { callback(null, false); return; }
    consumeRate("handshake", clientIP(req)).then(
      () => callback(null, true), () => callback(null, false),
    );
  },
  pingInterval: 10000,
  pingTimeout: 20000,
});

function getErrorCode(err: any, fallbackCode: string = "UNKNOWN"): string {
  const raw = typeof err?.message === "string" ? err.message : "";
  return KNOWN_ERROR_CODES.has(raw) ? raw : fallbackCode;
}

function safeEmitError(
  socket: any,
  err: any,
  fallbackCode: string = "UNKNOWN"
) {
  const code = getErrorCode(err, fallbackCode);
  // S1.3: no enviar el mensaje raw del servidor al cliente
  socket.emit("errorMessage", { code, message: code });
}

/** S1.3: loguear solo el código de error, nunca el objeto completo (puede contener tokens) */
function logError(tag: string, err: any) {
  const code = getErrorCode(err);
  console.error(`[${tag}]`, code);
}

function emitRoomStateToSocket(socket: any, room: any, playerId?: string) {
  // S3.2: incluir información del voto propio sin revelar votos ajenos
  let myVote: string | null = null;
  let hasVoted = false;
  if (playerId && room.votes && Array.isArray(room.votes)) {
    const myVoteEntry = room.votes.find((v: any) => v.voterId === playerId);
    if (myVoteEntry) {
      hasVoted = true;
      myVote = myVoteEntry.targetId;
    }
  }

  socket.emit("roomState", {
    roomCode: room.code,
    mode: room.mode,
    phase: room.phase,
    players: room.players.map((p: any) => ({
      id: p.id,
      name: p.name,
      alive: p.alive,
      isHost: p.isHost,
      connected: p.connected,
    })),
    currentRound: room.currentRound,
    words: room.words,
    tieCandidates: room.tieCandidates,
    voteEpoch: room.voteEpoch ?? 0,
    winner: room.winner,
    lastEliminatedId: room.lastEliminatedId ?? null,
    lastEliminatedName: room.lastEliminatedName ?? null,
    lastEliminatedWasImpostor: room.lastEliminatedWasImpostor ?? null,
    currentPlayerId:
      room.phase === "words" && room.baseOrder?.length
        ? room.baseOrder[room.currentTurnIndex]
        : null,
    // S3.2: estado del voto propio
    myVote,
    hasVoted,
  });
}

function emitRoleIfKnown(socket: any, room: any, playerId: string) {
  const p = room.players.find((x: any) => x.id === playerId);
  if (!p) return;

  if (room.phase !== "lobby" && room.impostorId) {
    socket.emit("yourRole", {
      isImpostor: !!p.isImpostor,
      character: p.character,
      roomCode: room.code,
    });
  }
}

io.on("connection", (socket) => {
  // Rechazar antes de Redis los mensajes malformados y ráfagas locales.
  let windowStart = Date.now();
  let messages = 0;
  let pending = 0;
  socket.use((packet, next) => {
    if (Date.now() - windowStart >= 1000) { windowStart = Date.now(); messages = 0; }
    if (++messages > 20 || pending >= 8) { safeEmitError(socket, new Error("RATE_LIMITED")); return; }
    let payload: Record<string, unknown>;
    try { payload = validateEvent(packet[0], packet[1]); }
    catch (err) { safeEmitError(socket, err); return; }
    const event = packet[0];
    const group: RateGroup = ["createRoom", "joinRoom", "rejoinRoom"].includes(event) ? event as RateGroup : "game";
    pending++;
    consumeRate(group, clientIP(socket.request), socket.id, group === "game" && socket.data.roomCode === payload.roomCode && socket.data.playerId ? payload.roomCode as string : undefined)
      .then(() => { if (socket.connected) { packet[1] = payload; next(); } })
      .catch(err => safeEmitError(socket, err))
      .finally(() => { pending--; });
  });

  // ✅ REJOIN (Redis)
  socket.on(
    "rejoinRoom",
    async (payload: { roomCode: string; playerToken: string }) => {
      try {
        // S2.2: validar entradas antes de acceder a Redis
        const roomCode = validateRoomCode(payload.roomCode);
        const playerToken = validatePlayerToken(payload.playerToken);

        const { room, player, oldSocketId, currentPlayerId } = await rejoinRoom(
          roomCode.toUpperCase(),
          playerToken,
          socket.id
        );

        // S1.2: revocar el socket anterior si existe
        if (oldSocketId && oldSocketId !== socket.id) {
          const oldSocket = io.sockets.sockets.get(oldSocketId);
          if (oldSocket) {
            // Limpiar la identidad para que submitWord/submitVote fallen
            oldSocket.data.playerId = undefined;
            oldSocket.data.roomCode = undefined;
            // Desunir de la sala y forzar la desconexión
            oldSocket.leave(room.code);
            oldSocket.disconnect(true);
          }
        }

        // S1.2: asociar identidad al socket
        socket.data.roomCode = room.code;
        socket.data.playerId = player.id;
        socket.join(room.code);

        // S1.1: roomJoined solo con datos públicos + token propio en campo separado
        socket.emit("roomJoined", {
          roomCode: room.code,
          playerId: player.id,
          playerToken: player.token,
          player: toPublicPlayer(player),
          room: {
            code: room.code,
            mode: room.mode,
            phase: room.phase,
            players: room.players.map(toPublicPlayer),
            currentRound: room.currentRound,
          },
        });

        // S3.2: incluir playerId para que el snapshot incluya el voto propio
        emitRoomStateToSocket(socket, room, player.id);
        emitRoleIfKnown(socket, room, player.id);

        // S1.1: playersUpdated con versión pública
        io.to(room.code).emit("playersUpdated", {
          players: room.players.map(toPublicPlayer),
        });
        if (currentPlayerId) {
          io.to(room.code).emit("turnChanged", { currentPlayerId });
        }
      } catch (err: any) {
        logError("rejoinRoom", err);
        safeEmitError(socket, err, "UNKNOWN");
      }
    }
  );

  socket.on(
    "createRoom",
    async (payload: { name: string; mode?: GameMode }) => {
      try {
        // S2.2: validar entradas
        const name = validateName(payload.name);
        const mode = payload.mode ? validateMode(payload.mode) : "classic";

        // S3.1: resolver membresía anterior antes de crear la nueva sala
        const previousRoomCode = socket.data.roomCode;
        const previousPlayerId = socket.data.playerId;
        if (previousRoomCode) {
          // Eliminar al jugador de la sala anterior en Redis y notificar
          if (previousPlayerId) {
            const prevResult = await removePlayerFromPreviousRoom(previousRoomCode, previousPlayerId);
            // Emitir playersUpdated a la sala anterior
            if (prevResult?.room) {
              io.to(previousRoomCode).emit("playersUpdated", {
                players: prevResult.room.players.map(toPublicPlayer),
              });
              // Si la salida resolvió la votación, emitir el resultado
              if (prevResult.voteResolved) {
                emitVoteResolution(io, previousRoomCode, prevResult.voteResolved, prevResult.room);
              }
            }
          }
          socket.leave(previousRoomCode);
          socket.data.roomCode = undefined;
          socket.data.playerId = undefined;
        }

        const { room, player } = await createRoom(socket.id, name, mode);

        // S1.2: asociar identidad al socket
        socket.data.roomCode = room.code;
        socket.data.playerId = player.id;
        socket.join(room.code);

        // S1.1: roomJoined con datos públicos
        socket.emit("roomJoined", {
          roomCode: room.code,
          playerId: player.id,
          playerToken: player.token,
          player: toPublicPlayer(player),
          room: {
            code: room.code,
            mode: room.mode,
            phase: room.phase,
            players: room.players.map(toPublicPlayer),
            currentRound: room.currentRound,
          },
        });

        emitRoomStateToSocket(socket, room);

        // S1.1: playersUpdated con versión pública
        io.to(room.code).emit("playersUpdated", {
          players: room.players.map(toPublicPlayer),
        });
      } catch (err) {
        logError("createRoom", err);
        safeEmitError(socket, err, "UNKNOWN");
      }
    }
  );

  socket.on(
    "joinRoom",
    async (payload: {
      roomCode: string;
      name: string;
      playerToken?: string;
    }) => {
      try {
        // S2.2: validar entradas
        const roomCode = validateRoomCode(payload.roomCode);
        const name = validateName(payload.name);
        const playerToken = payload.playerToken
          ? validatePlayerToken(payload.playerToken)
          : undefined;

        // S3.1: resolver membresía anterior antes de unirse a la nueva sala
        // Si la sala anterior es la misma que la nueva, no eliminar al jugador
        // de Redis — joinOrRejoinRoom lo recuperará por token
        const previousRoomCode = socket.data.roomCode;
        const previousPlayerId = socket.data.playerId;
        const targetRoomCode = roomCode.toUpperCase();
        if (previousRoomCode && previousRoomCode !== targetRoomCode) {
          // Eliminar al jugador de la sala anterior en Redis y notificar
          if (previousPlayerId) {
            const prevResult = await removePlayerFromPreviousRoom(previousRoomCode, previousPlayerId);
            // Emitir playersUpdated a la sala anterior
            if (prevResult?.room) {
              io.to(previousRoomCode).emit("playersUpdated", {
                players: prevResult.room.players.map(toPublicPlayer),
              });
              // Si la desconexión resolvió la votación, emitir el resultado
              if (prevResult.voteResolved) {
                emitVoteResolution(io, previousRoomCode, prevResult.voteResolved, prevResult.room);
              }
            }
          }
          socket.leave(previousRoomCode);
        }
        if (previousRoomCode) {
          socket.data.roomCode = undefined;
          socket.data.playerId = undefined;
        }

        const { room, player, isRejoin, oldSocketId, currentPlayerId } = await joinOrRejoinRoom(
          roomCode.toUpperCase(),
          socket.id,
          name,
          playerToken
        );

        // S1.2: revocar el socket anterior si hubo reconexión
        if (isRejoin && oldSocketId && oldSocketId !== socket.id) {
          const oldSocket = io.sockets.sockets.get(oldSocketId);
          if (oldSocket) {
            // Limpiar la identidad para que submitWord/submitVote fallen
            oldSocket.data.playerId = undefined;
            oldSocket.data.roomCode = undefined;
            // Desunir de la sala y forzar la desconexión
            oldSocket.leave(room.code);
            oldSocket.disconnect(true);
          }
        }

        // S1.2: asociar identidad al socket
        socket.data.roomCode = room.code;
        socket.data.playerId = player.id;
        socket.join(room.code);

        // S1.1: roomJoined con datos públicos
        socket.emit("roomJoined", {
          roomCode: room.code,
          playerId: player.id,
          playerToken: player.token,
          player: toPublicPlayer(player),
          room: {
            code: room.code,
            mode: room.mode,
            phase: room.phase,
            players: room.players.map(toPublicPlayer),
            currentRound: room.currentRound,
          },
          isRejoin,
        });

        // ✅ snapshot + rol al reconectar (S3.2: incluir playerId)
        emitRoomStateToSocket(socket, room, player.id);
        emitRoleIfKnown(socket, room, player.id);

        // S1.1: playersUpdated con versión pública
        io.to(room.code).emit("playersUpdated", {
          players: room.players.map(toPublicPlayer),
        });
        if (currentPlayerId) {
          io.to(room.code).emit("turnChanged", { currentPlayerId });
        }
      } catch (err: any) {
        logError("joinRoom", err);
        safeEmitError(socket, err, "UNKNOWN");
      }
    }
  );

  socket.on("startGame", async (payload: { roomCode: string }) => {
    try {
      // S2.2: validar entradas
      const roomCode = validateRoomCode(payload.roomCode);

      const { room: updatedRoom, roles } = await startGame(
        roomCode.toUpperCase(),
        socket.id
      );

      roles.forEach((r) => {
        if (!r.socketId) return;
        io.to(r.socketId).emit("yourRole", {
          isImpostor: r.isImpostor,
          character: r.character,
          roomCode: updatedRoom.code,
        });
      });

      io.to(updatedRoom.code).emit("gameStarted", {
        roomCode: updatedRoom.code,
        mode: updatedRoom.mode,
        phase: updatedRoom.phase,
        players: updatedRoom.players.map(toPublicPlayer),
        currentRound: updatedRoom.currentRound,
        voteEpoch: updatedRoom.voteEpoch ?? 0,
      });
    } catch (err: any) {
      logError("startGame", err);
      safeEmitError(socket, err, "UNKNOWN");
    }
  });

  socket.on("startWordsRound", async (payload: { roomCode: string }) => {
    try {
      // S2.2: validar entradas
      const roomCode = validateRoomCode(payload.roomCode);

      const { room: updatedRoom, currentPlayerId } = await startWordsRound(
        roomCode.toUpperCase(),
        socket.id
      );

      io.to(updatedRoom.code).emit("phaseChanged", {
        phase: updatedRoom.phase,
        currentRound: updatedRoom.currentRound,
        voteEpoch: updatedRoom.voteEpoch ?? 0,
      });

      io.to(updatedRoom.code).emit("playersUpdated", {
        players: updatedRoom.players.map(toPublicPlayer),
      });

      io.to(updatedRoom.code).emit("turnChanged", { currentPlayerId });
    } catch (err: any) {
      logError("startWordsRound", err);
      safeEmitError(socket, err, "UNKNOWN");
    }
  });
  

  socket.on(
    "submitWord",
    async (payload: { roomCode: string; playerId: string; word: string }) => {
      try {
        // S2.2: validar entradas
        const roomCode = validateRoomCode(payload.roomCode);
        const playerId = validatePlayerId(payload.playerId);
        const word = validateWord(payload.word);

        // S1.2: verificar que el socket está asociado al playerId
        const associatedPlayerId = socket.data.playerId;
        if (typeof associatedPlayerId !== "string" || associatedPlayerId !== playerId) {
          throw new Error("UNAUTHORIZED");
        }

        const {
          room: updatedRoom,
          finishedRound,
          currentPlayerId,
          newWord,
        } = await submitWord(roomCode.toUpperCase(), playerId, socket.id, word);

        io.to(updatedRoom.code).emit("wordAdded", {
          playerId: newWord.playerId,
          word: newWord.word,
          words: updatedRoom.words,
        });

        if (finishedRound) {
          io.to(updatedRoom.code).emit("phaseChanged", {
            phase: updatedRoom.phase,
            currentRound: updatedRoom.currentRound,
          });
        } else if (currentPlayerId) {
          io.to(updatedRoom.code).emit("turnChanged", { currentPlayerId });
        }
      } catch (err: any) {
        logError("submitWord", err);
        safeEmitError(socket, err, "UNKNOWN");
      }
    }
  );

  // ✅ submitVote robusto: payload incluye voterId estable
  socket.on(
    "submitVote",
    async (payload: {
      roomCode: string;
      voterId: string;
      targetId: string;
      voteEpoch?: number;
    }) => {
      try {
        // S2.2: validar entradas
        const roomCode = validateRoomCode(payload.roomCode);
        const voterId = validatePlayerId(payload.voterId);
        const targetId = validatePlayerId(payload.targetId);
        const voteEpoch = payload.voteEpoch ?? 0;

        // S1.2: verificar que el socket está asociado al voterId
        const associatedPlayerId = socket.data.playerId;
        if (typeof associatedPlayerId !== "string" || associatedPlayerId !== voterId) {
          throw new Error("UNAUTHORIZED");
        }

        const {
          room: updatedRoom,
          finishedVoting,
          eliminatedPlayer,
          wasImpostor,
          winner,
          isTie,
          tieCandidates,
        } = await submitVote(
          roomCode.toUpperCase(),
          voterId,
          socket.id,
          targetId,
          voteEpoch
        );

        if (!finishedVoting) {
          // S3.2: confirmar al cliente que su voto fue aceptado en el servidor
          socket.emit("voteConfirmed", { voterId });
          if (isTie && tieCandidates) {
            // S1.1: tieVote con versión pública
            io.to(updatedRoom.code).emit("tieVote", {
              tieCandidates: tieCandidates.map(toPublicPlayer),
              voteEpoch: updatedRoom.voteEpoch ?? 0,
            });
            io.to(updatedRoom.code).emit("playersUpdated", {
              players: updatedRoom.players.map(toPublicPlayer),
            });
          }
          return;
        }

        // S3.2: confirmar el voto antes de notificar el resultado
        socket.emit("voteConfirmed", { voterId });

        io.to(updatedRoom.code).emit("playersUpdated", {
          players: updatedRoom.players.map(toPublicPlayer),
        });

        io.to(updatedRoom.code).emit("phaseChanged", {
          phase: updatedRoom.phase,
          currentRound: updatedRoom.currentRound,
        });

        // S1.1: roundResult — eliminatedPlayer como público
        io.to(updatedRoom.code).emit("roundResult", {
          eliminatedPlayer: eliminatedPlayer ? toPublicPlayer(eliminatedPlayer) : null,
          wasImpostor,
          winner,
        });

        if (updatedRoom.phase === "finished") {
          io.to(updatedRoom.code).emit("gameFinished", {
            winner: updatedRoom.winner,
          });
        }
      } catch (err: any) {
        logError("submitVote", err);
        safeEmitError(socket, err, "UNKNOWN");
      }
    }
  );

  socket.on("startNextRound", async (payload: { roomCode: string }) => {
    try {
      const roomCode = validateRoomCode(payload.roomCode);

      const { room: updatedRoom, currentPlayerId } = await startNextRound(roomCode, socket.id);

      io.to(updatedRoom.code).emit("phaseChanged", {
        phase: updatedRoom.phase,
        currentRound: updatedRoom.currentRound,
        voteEpoch: updatedRoom.voteEpoch ?? 0,
      });

      io.to(updatedRoom.code).emit("playersUpdated", {
        players: updatedRoom.players.map(toPublicPlayer),
      });

      io.to(updatedRoom.code).emit("turnChanged", { currentPlayerId });
    } catch (err: any) {
      logError("startNextRound", err);
      safeEmitError(socket, err, "UNKNOWN");
    }
  });

  socket.on("restartGame", async (payload: { roomCode: string }) => {
    try {
      const roomCode = validateRoomCode(payload.roomCode);

      // restartGame ya valida host dentro
      const { room: updatedRoom, roles } = await restartGame(
        roomCode.toUpperCase(),
        socket.id
      );

      roles.forEach((r) => {
        if (!r.socketId) return;
        io.to(r.socketId).emit("yourRole", {
          isImpostor: r.isImpostor,
          character: r.character,
          roomCode: updatedRoom.code,
        });
      });

      io.to(updatedRoom.code).emit("gameStarted", {
        roomCode: updatedRoom.code,
        mode: updatedRoom.mode,
        phase: updatedRoom.phase,
        players: updatedRoom.players.map(toPublicPlayer),
        currentRound: updatedRoom.currentRound,
        voteEpoch: updatedRoom.voteEpoch ?? 0,
      });
    } catch (err: any) {
      logError("restartGame", err);
      safeEmitError(socket, err, "UNKNOWN");
    }
  });

  socket.on("endGame", async (payload: { roomCode: string }) => {
    try {
      const roomCode = validateRoomCode(payload.roomCode);

      await deleteRoom(roomCode, socket.id);
      io.to(roomCode).emit("roomEnded");
    } catch (err: any) {
      logError("endGame", err);
      safeEmitError(socket, err, "UNKNOWN");
    }
  });

  // S3.1 — leaveRoom: el jugador abandona la sala explícitamente
  socket.on("leaveRoom", async () => {
    try {
      const roomCode = socket.data.roomCode;
      if (!roomCode) return;

      // Limpiar la identidad del socket antes de llamar a leaveRoom
      // para que si la sala ya no existe, el socket no conserve estado
      socket.data.roomCode = undefined;
      socket.data.playerId = undefined;
      socket.leave(roomCode);

      const result = await leaveRoom(roomCode, socket.id);

      // leaveRoom puede devolver undefined cuando la sala queda vacía
      // y updateRoom la borra (ROOM_EMPTY + missingOk)
      if (!result) {
        // Sala se borró: notificar roomEnded a los sockets restantes
        io.to(roomCode).emit("roomEnded");
        return;
      }

      const { room, playerRemoved } = result;

      if (!playerRemoved) {
        // Ya no estaba en la sala (salida repetida, desconexión previa)
        return;
      }

      // Sala aún tiene jugadores: notificar la actualización
      if (room) {
        io.to(roomCode).emit("playersUpdated", {
          players: room.players.map(toPublicPlayer),
        });
      }
    } catch (err: any) {
      logError("leaveRoom", err);
    }
  });

  socket.on("disconnect", async () => {
    try {
      const roomCode = socket.data.roomCode;
      if (!roomCode) return;
      const result = await markPlayerDisconnected(roomCode, socket.id);

      // S3.3: si la desconexión resolvió la votación, emitir el resultado
      if (result?.voteResolved) {
        emitVoteResolution(io, roomCode, result.voteResolved, result.room);
        return;
      }

      const room = await getRoom(roomCode);
      if (room) {
        io.to(room.code).emit("playersUpdated", {
          players: room.players.map(toPublicPlayer),
        });

        // S3.3: si la desconexión avanzó el turno en fase words/revealRound,
        // emitir turnChanged para que el frontend actualice el turno actual
        if (result?.currentPlayerId !== undefined) {
          if (result.currentPlayerId) {
            io.to(room.code).emit("turnChanged", {
              currentPlayerId: result.currentPlayerId,
            });
          }
        }
      }
    } catch (err: any) {
      logError("disconnect", err);
    }
  });
});

/**
 * S3.1/S3.3 — emitVoteResolution: emite los eventos correspondientes cuando
 * una votación se resuelve (por disconnect, removePlayerFromPreviousRoom, etc.).
 * Se usa como helper para evitar duplicar la lógica en disconnect y joinRoom.
 */
function emitVoteResolution(
  io: any,
  roomCode: string,
  voteResolved: {
    eliminatedPlayer: Player | null;
    wasImpostor: boolean | null;
    winner: "players" | "impostor" | null;
    isTie: boolean;
    tieCandidates: Player[] | null;
  },
  room: Room
): void {
  if (voteResolved.isTie && voteResolved.tieCandidates) {
    io.to(roomCode).emit("tieVote", {
      tieCandidates: voteResolved.tieCandidates.map(toPublicPlayer),
      voteEpoch: room.voteEpoch ?? 0,
    });
  } else if (voteResolved.eliminatedPlayer) {
    const { eliminatedPlayer, wasImpostor, winner } = voteResolved;
    io.to(roomCode).emit("playersUpdated", {
      players: room.players.map(toPublicPlayer),
    });
    io.to(roomCode).emit("roundResult", {
      eliminatedPlayer: toPublicPlayer(eliminatedPlayer),
      wasImpostor,
      winner,
      currentRound: room.currentRound,
    });
    if (winner) {
      io.to(roomCode).emit("gameFinished", {
        winner,
        roomCode: room.code,
      });
    } else {
      io.to(roomCode).emit("phaseChanged", {
        phase: room.phase,
        currentRound: room.currentRound,
      });
    }
  }
}

server.listen(Number(PORT), "0.0.0.0", () => {
  const address = server.address();
  console.log(`Servidor escuchando en puerto ${typeof address === "object" && address ? address.port : PORT}`);
});
