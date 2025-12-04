// src/index.ts
import express from "express";
import http from "http";
import cors from "cors";
import { Server as SocketIOServer } from "socket.io";
import {
  getRoom,
  createRoom,
  joinRoom,
  startGame,
  startWordsRound,
  submitWord,
  submitVote,
  startNextRound,
  removePlayer,
  restartGame,
  deleteRoom,
} from "./game/roomsManager";

const PORT = process.env.PORT || 4000;

const app = express();

// Middleware
app.use(
  cors({
    origin: [
      "http://localhost:5173", 
      "https://impostor-frontend.onrender.com", 
    ],
    methods: ["GET", "POST"],
  })
);
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// src/index.ts
app.get("/rooms/:code", (req, res) => {
  const code = req.params.code.toUpperCase();
  const room = getRoom(code); // función de roomsManager

  if (!room) {
    return res.status(404).json({ exists: false });
  }

  return res.json({ exists: true, code });
});

const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: [
      "http://localhost:5173",
      "https://impostor-frontend.onrender.com",
    ],
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  console.log(`Nuevo cliente conectado: ${socket.id}`);

  socket.on("createRoom", (payload: { name: string }) => {
    try {
      const { name } = payload;
      const { room, player } = createRoom(socket.id, name);

      socket.join(room.code);

      // Enviamos al creador su info de sala
      socket.emit("roomJoined", {
        roomCode: room.code,
        player,
        room,
      });

      // Enviamos lista de jugadores actualizada al lobby de esa sala
      io.to(room.code).emit("playersUpdated", {
        players: room.players,
      });
    } catch (err) {
      console.error(err);
      socket.emit("errorMessage", { message: "No se pudo crear la sala" });
    }
  });

  socket.on("joinRoom", (payload: { roomCode: string; name: string }) => {
    try {
      const { roomCode, name } = payload;
      const { room, player } = joinRoom(roomCode, socket.id, name);

      socket.join(room.code);

      socket.emit("roomJoined", {
        roomCode: room.code,
        player,
        room,
      });

      io.to(room.code).emit("playersUpdated", {
        players: room.players,
      });
    } catch (err: any) {
      console.error(err);
      if (err instanceof Error) {
        socket.emit("errorMessage", { message: err.message });
      } else {
        socket.emit("errorMessage", { message: "Error al unirse a la sala" });
      }
    }
  });

  socket.on("startGame", (payload: { roomCode: string }) => {
    try {
      const { roomCode } = payload;
      const room = getRoom(roomCode);
      if (!room) throw new Error("ROOM_NOT_FOUND");

      const player = room.players.find((p) => p.id === socket.id);
      if (!player || !player.isHost) {
        throw new Error("ONLY_HOST_CAN_START");
      }

      const { room: updatedRoom, roles } = startGame(roomCode);

      console.log("aqio --->", roomCode);

      // Enviar rol a cada jugador de forma privada
      roles.forEach((r) => {
        io.to(r.playerId).emit("yourRole", {
          isImpostor: r.isImpostor,
          character: r.character,
          roomCode: updatedRoom.code,
        });
      });

      // Avisar a toda la sala de que la partida ha empezado y estamos en fase "reveal"
      io.to(updatedRoom.code).emit("gameStarted", {
        roomCode: updatedRoom.code,
        phase: updatedRoom.phase,
        players: updatedRoom.players.map((p) => ({
          id: p.id,
          name: p.name,
          alive: p.alive,
          isHost: p.isHost,
        })),
      });
    } catch (err: any) {
      console.error(err);
      socket.emit("errorMessage", {
        message: err.message || "Error al empezar la partida",
      });
    }
  });

  socket.on("startWordsRound", (payload: { roomCode: string }) => {
    try {
      const { roomCode } = payload;
      const room = getRoom(roomCode);
      if (!room) throw new Error("ROOM_NOT_FOUND");

      const player = room.players.find((p) => p.id === socket.id);
      if (!player || !player.isHost) {
        throw new Error("ONLY_HOST_CAN_START_ROUND");
      }

      const { room: updatedRoom, currentPlayerId } = startWordsRound(roomCode);

      io.to(updatedRoom.code).emit("phaseChanged", {
        phase: updatedRoom.phase,
        currentRound: updatedRoom.currentRound,
      });

      io.to(updatedRoom.code).emit("turnChanged", {
        currentPlayerId,
      });
    } catch (err: any) {
      console.error(err);
      socket.emit("errorMessage", {
        message: err.message || "Error al iniciar la ronda de palabras",
      });
    }
  });

  socket.on("submitWord", (payload: { roomCode: string; word: string }) => {
    try {
      const { roomCode, word } = payload;
      const playerId = socket.id;

      const {
        room: updatedRoom,
        finishedRound,
        currentPlayerId,
        newWord,
      } = submitWord(roomCode, playerId, word);

      // Emitimos la nueva palabra a todos
      io.to(updatedRoom.code).emit("wordAdded", {
        playerId: newWord.playerId,
        word: newWord.word,
        words: updatedRoom.words,
      });

      if (finishedRound) {
        // Ronda terminada → pasamos a votación
        io.to(updatedRoom.code).emit("phaseChanged", {
          phase: updatedRoom.phase, // 'voting'
          currentRound: updatedRoom.currentRound,
        });
      } else if (currentPlayerId) {
        // Turno del siguiente jugador
        io.to(updatedRoom.code).emit("turnChanged", {
          currentPlayerId,
        });
      }
    } catch (err: any) {
      console.error(err);
      socket.emit("errorMessage", {
        message: err.message || "Error al enviar la palabra",
      });
    }
  });

  socket.on("submitVote", (payload: { roomCode: string; targetId: string }) => {
    try {
      const { roomCode, targetId } = payload;
      const voterId = socket.id;

      const { room, finishedVoting, eliminatedPlayer, wasImpostor, winner } =
        submitVote(roomCode, voterId, targetId);

      if (!finishedVoting) {
        return;
      }

      io.to(room.code).emit("phaseChanged", {
        phase: room.phase,
        currentRound: room.currentRound,
      });

      // Emitimos el resultado de la ronda
      io.to(room.code).emit("roundResult", {
        eliminatedPlayer,
        wasImpostor,
        winner,
      });

      if (room.phase === "finished") {
        io.to(room.code).emit("gameFinished", {
          winner: room.winner,
        });
      }
    } catch (err: any) {
      console.error(err);
      socket.emit("errorMessage", {
        message: err.message || "Error en la votación",
      });
    }
  });

  socket.on("startNextRound", (payload: { roomCode: string }) => {
    try {
      const { roomCode } = payload;

      const { room, currentPlayerId } = startNextRound(roomCode);

      io.to(room.code).emit("phaseChanged", {
        phase: room.phase,
        currentRound: room.currentRound,
      });

      io.to(room.code).emit("turnChanged", {
        currentPlayerId,
      });
    } catch (err: any) {
      console.error(err);
      socket.emit("errorMessage", {
        message: err.message || "Error al iniciar la siguiente ronda",
      });
    }
  });

  socket.on("restartGame", (payload: { roomCode: string }) => {
    try {
      const { roomCode } = payload;
      const room = getRoom(roomCode);
      if (!room) throw new Error("ROOM_NOT_FOUND");

      const player = room.players.find((p) => p.id === socket.id);
      if (!player || !player.isHost) {
        throw new Error("ONLY_HOST_CAN_RESTART");
      }

      const { room: updatedRoom, roles } = restartGame(roomCode);

      // igual que startGame: mandamos roles privados
      roles.forEach((r) => {
        io.to(r.playerId).emit("yourRole", {
          isImpostor: r.isImpostor,
          character: r.character,
          roomCode: updatedRoom.code,
        });
      });

      io.to(updatedRoom.code).emit("gameStarted", {
        roomCode: updatedRoom.code,
        phase: updatedRoom.phase, // 'reveal'
        players: updatedRoom.players.map((p) => ({
          id: p.id,
          name: p.name,
          alive: p.alive,
          isHost: p.isHost,
        })),
      });
    } catch (err: any) {
      console.error(err);
      socket.emit("errorMessage", {
        message: err.message || "Error al reiniciar la partida",
      });
    }
  });

  socket.on("endGame", (payload: { roomCode: string }) => {
    try {
      const { roomCode } = payload;
      const room = getRoom(roomCode);
      if (!room) throw new Error("ROOM_NOT_FOUND");

      const player = room.players.find((p) => p.id === socket.id);
      if (!player || !player.isHost) {
        throw new Error("ONLY_HOST_CAN_END_GAME");
      }

      // avisar a todos
      io.to(room.code).emit("roomEnded");

      // borrar la sala
      deleteRoom(roomCode);
    } catch (err: any) {
      console.error(err);
      socket.emit("errorMessage", {
        message: err.message || "Error al finalizar la partida",
      });
    }
  });

  // Desconexión
  socket.on("disconnect", () => {
    console.log(`Cliente desconectado: ${socket.id}`);
    removePlayer(socket.id);
    // En un MVP podríamos emitir un "playersUpdated" a las salas afectadas,
    // más adelante podemos mejorarlo si guardamos el código de sala en el socket.
  });
});

server.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
