
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;
const players = {};

app.use(express.static("public"));

app.get("/api/status", (req, res) => {
  res.json({
    game: "Turk Sohbet",
    online: Object.keys(players).length,
    status: "online"
  });
});

io.on("connection", (socket) => {
  console.log("Oyuncu bağlandı:", socket.id);

  players[socket.id] = {
    id: socket.id,
    name: "Oyuncu",
    x: 0,
    y: 0,
    z: 0,
    rotation: 0
  };

  socket.emit("welcome", {
    id: socket.id,
    players: players
  });

  socket.broadcast.emit("playerJoined", players[socket.id]);

  socket.on("setName", (name) => {
    if (typeof name !== "string") return;

    const cleanName = name.trim().slice(0, 18);
    if (!cleanName) return;

    players[socket.id].name = cleanName;
    io.emit("playerUpdated", players[socket.id]);
  });

  socket.on("move", (data) => {
    if (!players[socket.id]) return;
    if (!data || typeof data !== "object") return;

    const x = Number(data.x);
    const y = Number(data.y);
    const z = Number(data.z);
    const rotation = Number(data.rotation);

    if (![x, y, z, rotation].every(Number.isFinite)) return;

    players[socket.id].x = Math.max(-500, Math.min(500, x));
    players[socket.id].y = Math.max(-50, Math.min(100, y));
    players[socket.id].z = Math.max(-500, Math.min(500, z));
    players[socket.id].rotation = rotation;

    socket.broadcast.emit("playerMoved", players[socket.id]);
  });

  socket.on("chat", (message) => {
    if (typeof message !== "string") return;

    const cleanMessage = message.trim().slice(0, 250);
    if (!cleanMessage || !players[socket.id]) return;

    io.emit("chatMessage", {
      id: socket.id,
      name: players[socket.id].name,
      message: cleanMessage,
      time: Date.now()
    });
  });

  socket.on("disconnect", () => {
    delete players[socket.id];
    io.emit("playerLeft", socket.id);
    console.log("Oyuncu ayrıldı:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Turk Sohbet sunucusu çalışıyor: ${PORT}`);
});
