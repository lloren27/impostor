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
    origin: ["http://localhost:5173", "https://impostor-frontend.onrender.com"],
    methods: ["GET", "POST"],
  })
);
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Endpoint para que el frontend compruebe si existe una sala
app.get("/rooms/:code", (req, res) => {
  const code = req.params.code.toUpperCase();
  const room = getRoom(code);

  if (!room) {
    return res.status(404).json({ exists: false });
  }

  return res.json({ exists: true, code });
});

const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: ["http://localhost:5173", "https://impostor-frontend.onrender.com"],
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  socket.onAny((event, ...args) => {
    console.log("[onAny]", event, "from", socket.id, "payload:", args[0]);
  });

  /**
   * REJOIN: el cliente nos manda roomCode + playerId (estable).
   * Nosotros:
   * - buscamos la sala
   * - buscamos el player por su id (estable)
   * - actualizamos su socketId
   * - lo volvemos a unir a la room de Socket.IO
   * - le mandamos un roomJoined con el mismo formato que create/join
   */
  socket.on(
    "rejoinRoom",
    (payload: { roomCode: string; playerId: string; name?: string }) => {
      const { roomCode, playerId } = payload;
      const room = getRoom(roomCode);

      if (!room) {
        socket.emit("errorMessage", {
          message: "La sala ya no existe. Crea una nueva.",
        });
        return;
      }

      const player = room.players.find((p) => p.id === playerId);

      if (!player) {
        socket.emit("errorMessage", {
          message: "No se ha encontrado tu jugador en la sala.",
        });
        return;
      }

      // Actualizamos socketId y lo volvemos a meter en la room
      player.socketId = socket.id;
      socket.join(room.code);

      // Enviamos al jugador TODO el estado de la sala
      socket.emit("roomJoined", {
        roomCode: room.code,
        playerId: player.id,
        player,
        room,
      });

      // Notificamos al resto que este jugador ha vuelto
      socket.to(room.code).emit("playersUpdated", {
        players: room.players,
      });
    }
  );

  socket.on("createRoom", (payload: { name: string }) => {
    try {
      const { name } = payload;
      const { room, player } = createRoom(socket.id, name);

      socket.join(room.code);

      // Enviamos al creador su info de sala
      socket.emit("roomJoined", {
        roomCode: room.code,
        playerId: player.id, // id estable
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
        playerId: player.id, // id estable
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

      // Host = jugador cuyo socketId coincide con este socket
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player || !player.isHost) {
        throw new Error("ONLY_HOST_CAN_START");
      }

      const { room: updatedRoom, roles } = startGame(roomCode);

      // Enviamos rol individual a cada jugador por su socketId
      roles.forEach((r) => {
        if (!r.socketId) return; // por si alguien está desconectado
        io.to(r.socketId).emit("yourRole", {
          isImpostor: r.isImpostor,
          character: r.character,
          roomCode: updatedRoom.code,
        });
      });

      // Estado general de partida
      io.to(updatedRoom.code).emit("gameStarted", {
        roomCode: updatedRoom.code,
        phase: updatedRoom.phase,
        players: updatedRoom.players.map((p) => ({
          id: p.id, // id estable
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

      const player = room.players.find((p) => p.socketId === socket.id);
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
      const room = getRoom(roomCode);
      if (!room) throw new Error("ROOM_NOT_FOUND");

      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player) throw new Error("PLAYER_NOT_FOUND");

      const {
        room: updatedRoom,
        finishedRound,
        currentPlayerId,
        newWord,
      } = submitWord(roomCode, player.id, word); // usamos id estable

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
      const room = getRoom(roomCode);
      if (!room) throw new Error("ROOM_NOT_FOUND");

      const voter = room.players.find((p) => p.socketId === socket.id);
      if (!voter) throw new Error("PLAYER_NOT_FOUND");

      const {
        room: updatedRoom,
        finishedVoting,
        eliminatedPlayer,
        wasImpostor,
        winner,
        isTie,
        tieCandidates,
      } = submitVote(roomCode, voter.id, targetId); // voter.id = id estable

      if (!finishedVoting) {
        // Caso especial: EMPATE → avisamos al front
        if (isTie && tieCandidates) {
          io.to(updatedRoom.code).emit("tieVote", {
            tieCandidates,
          });
        }
        return;
      }

      // Aquí ya ha terminado la votación (sin empate o tras desempate)
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
      console.log("[restartGame received]", { socketId: socket.id, roomCode });

      const room = getRoom(roomCode);
      console.log("[restartGame] room:", room);

      if (!room) throw new Error("ROOM_NOT_FOUND");

      const player = room.players.find((p) => p.socketId === socket.id);
      console.log("[restartGame] player found:", player);

      if (!player || !player.isHost) {
        throw new Error("ONLY_HOST_CAN_RESTART");
      }

      const { room: updatedRoom, roles } = restartGame(roomCode);

      console.log("[restartGame] restartGame OK, new room state:", {
        phase: updatedRoom.phase,
        currentRound: updatedRoom.currentRound,
        players: updatedRoom.players.map((p) => ({
          id: p.id,
          name: p.name,
          isHost: p.isHost,
          alive: p.alive,
        })),
      });

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
      });
    } catch (err: any) {
      console.error("[restartGame ERROR]", err);
      socket.emit("errorMessage", {
        message: err.message || "Error al reiniciar la partida",
      });
    }
  });

  socket.on("endGame", (payload: { roomCode: string }) => {
    try {
      const { roomCode } = payload;
      console.log("[endGame received]", { socketId: socket.id, roomCode });

      const room = getRoom(roomCode);
      console.log("[endGame] room:", room);

      if (!room) throw new Error("ROOM_NOT_FOUND");

      const player = room.players.find((p) => p.socketId === socket.id);
      console.log("[endGame] player found:", player);

      if (!player || !player.isHost) {
        throw new Error("ONLY_HOST_CAN_END_GAME");
      }

      io.to(room.code).emit("roomEnded");
      deleteRoom(roomCode);

      console.log("[endGame] room deleted OK");
    } catch (err: any) {
      console.error("[endGame ERROR]", err);
      socket.emit("errorMessage", {
        message: err.message || "Error al finalizar la partida",
      });
    }
  });

  // Desconexión: delegamos en roomsManager (que ahora solo marca socketId = null)
  socket.on("disconnect", () => {
    removePlayer(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
