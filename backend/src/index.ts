import "dotenv/config";

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
  removePlayerFromRoom,
} from "./game/roomsManagerRedis";
import { KNOWN_ERROR_CODES } from "./constants/errors";

const PORT = process.env.PORT || 4000;

const allowedOrigins = [
  "http://localhost:5173",
  "https://impostor-frontend.onrender.com",
  "https://eljuegodelimpostor.es",
  "https://www.eljuegodelimpostor.es",
];

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
    const code = req.params.code.toUpperCase();
    const room = await getRoom(code);

    if (!room) return res.status(404).json({ exists: false });
    return res.json({ exists: true, code });
  } catch (err) {
    console.error("[GET /rooms/:code] error", err);
    return res.status(500).json({ exists: false });
  }
});

const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) callback(null, true);
      else callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  },
  pingInterval: 10000,
  pingTimeout: 20000,
});

function safeEmitError(
  socket: any,
  err: any,
  fallbackCode: string = "UNKNOWN"
) {
  const raw = typeof err?.message === "string" ? err.message : "";
  const code = KNOWN_ERROR_CODES.has(raw) ? raw : fallbackCode;
  socket.emit("errorMessage", { code, message: raw || fallbackCode });
}

io.on("connection", (socket) => {
  socket.onAny((event, ...args) => {
    console.log("[onAny]", event, "from", socket.id, "payload:", args[0]);
  });

  // ✅ REJOIN (Redis)
  socket.on(
    "rejoinRoom",
    async (payload: { roomCode: string; playerId: string }) => {
      try {
        const { roomCode, playerId } = payload;

        const { room, player } = await rejoinRoom(
          roomCode.toUpperCase(),
          playerId,
          socket.id
        );

        socket.data.roomCode = room.code;
        socket.join(room.code);

        socket.emit("roomJoined", {
          roomCode: room.code,
          playerId: player.id,
          player,
          room,
        });

        socket.to(room.code).emit("playersUpdated", {
          players: room.players,
        });
      } catch (err: any) {
        console.error("[rejoinRoom ERROR]", err);
        safeEmitError(socket, err, "UNKNOWN");
      }
    }
  );

  socket.on("createRoom", async (payload: { name: string }) => {
    try {
      const { name } = payload;
      const { room, player } = await createRoom(socket.id, name);

      socket.data.roomCode = room.code;
      socket.join(room.code);

      socket.emit("roomJoined", {
        roomCode: room.code,
        playerId: player.id,
        player,
        room,
      });

      io.to(room.code).emit("playersUpdated", {
        players: room.players,
      });
    } catch (err) {
      console.error("[createRoom ERROR]", err);
      safeEmitError(socket, err, "UNKNOWN");
    }
  });

  socket.on("joinRoom", async (payload: { roomCode: string; name: string }) => {
    try {
      const { roomCode, name } = payload;
      const { room, player } = await joinRoom(
        roomCode.toUpperCase(),
        socket.id,
        name
      );

      socket.data.roomCode = room.code;
      socket.join(room.code);

      socket.emit("roomJoined", {
        roomCode: room.code,
        playerId: player.id,
        player,
        room,
      });

      io.to(room.code).emit("playersUpdated", {
        players: room.players,
      });
    } catch (err: any) {
      console.error("[joinRoom ERROR]", err);
      safeEmitError(socket, err, "UNKNOWN");
    }
  });

  socket.on("startGame", async (payload: { roomCode: string }) => {
    try {
      const { roomCode } = payload;

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
        phase: updatedRoom.phase,
        players: updatedRoom.players.map((p) => ({
          id: p.id,
          name: p.name,
          alive: p.alive,
          isHost: p.isHost,
        })),
        currentRound: updatedRoom.currentRound,
      });
    } catch (err: any) {
      console.error("[startGame ERROR]", err);
      safeEmitError(socket, err, "UNKNOWN");
    }
  });

  socket.on("startWordsRound", async (payload: { roomCode: string }) => {
    try {
      const { roomCode } = payload;

      const { room: updatedRoom, currentPlayerId } = await startWordsRound(
        roomCode.toUpperCase(),
        socket.id
      );

      io.to(updatedRoom.code).emit("phaseChanged", {
        phase: updatedRoom.phase,
        currentRound: updatedRoom.currentRound,
      });

      io.to(updatedRoom.code).emit("turnChanged", { currentPlayerId });
    } catch (err: any) {
      console.error("[startWordsRound ERROR]", err);
      safeEmitError(socket, err, "UNKNOWN");
    }
  });

  socket.on(
    "submitWord",
    async (payload: { roomCode: string; playerId: string; word: string }) => {
      try {
        const { roomCode, playerId, word } = payload;

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
        console.error("[submitWord ERROR]", err);
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
    }) => {
      try {
        const { roomCode, voterId, targetId } = payload;

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
          targetId
        );

        if (!finishedVoting) {
          if (isTie && tieCandidates) {
            io.to(updatedRoom.code).emit("tieVote", { tieCandidates });
          }
          return;
        }

        io.to(updatedRoom.code).emit("phaseChanged", {
          phase: updatedRoom.phase,
          currentRound: updatedRoom.currentRound,
        });

        io.to(updatedRoom.code).emit("roundResult", {
          eliminatedPlayer,
          wasImpostor,
          winner,
        });

        if (updatedRoom.phase === "finished") {
          io.to(updatedRoom.code).emit("gameFinished", {
            winner: updatedRoom.winner,
          });
        }
      } catch (err: any) {
        console.error("[submitVote ERROR]", err);
        safeEmitError(socket, err, "UNKNOWN");
      }
    }
  );

  socket.on("startNextRound", async (payload: { roomCode: string }) => {
    try {
      const { roomCode } = payload;
      const { room, currentPlayerId } = await startNextRound(
        roomCode.toUpperCase()
      );

      io.to(room.code).emit("phaseChanged", {
        phase: room.phase,
        currentRound: room.currentRound,
      });

      io.to(room.code).emit("turnChanged", { currentPlayerId });
    } catch (err: any) {
      console.error("[startNextRound ERROR]", err);
      safeEmitError(socket, err, "UNKNOWN");
    }
  });

  socket.on("restartGame", async (payload: { roomCode: string }) => {
    try {
      const { roomCode } = payload;

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
        phase: updatedRoom.phase,
        players: updatedRoom.players.map((p) => ({
          id: p.id,
          name: p.name,
          alive: p.alive,
          isHost: p.isHost,
        })),
        currentRound: updatedRoom.currentRound,
      });
    } catch (err: any) {
      console.error("[restartGame ERROR]", err);
      safeEmitError(socket, err, "UNKNOWN");
    }
  });

  socket.on("endGame", async (payload: { roomCode: string }) => {
    try {
      const { roomCode } = payload;

      const room = await getRoom(roomCode.toUpperCase());
      if (!room) throw new Error("ROOM_NOT_FOUND");

      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player || !player.isHost) throw new Error("ONLY_HOST_CAN_END_GAME");

      io.to(room.code).emit("roomEnded");
      await deleteRoom(room.code);
    } catch (err: any) {
      console.error("[endGame ERROR]", err);
      safeEmitError(socket, err, "UNKNOWN");
    }
  });

  socket.on("disconnect", async () => {
    try {
      const roomCode = socket.data.roomCode as string | undefined;
      if (roomCode) await removePlayerFromRoom(roomCode, socket.id);
    } catch (err) {
      console.error("[disconnect ERROR]", err);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
