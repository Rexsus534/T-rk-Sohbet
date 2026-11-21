
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL eksik! Render PostgreSQL bağlantısını ekleyin.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false }
});

app.use(express.json({ limit: "10kb" }));
app.use(express.static("public"));

const players = {};
const sessions = new Map();

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(18) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log("Veritabanı hazır.");
}

function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

function validUsername(name) {
  return typeof name === "string" &&
    /^[a-zA-Z0-9_]{3,18}$/.test(name);
}

// KAYIT
app.post("/api/register", async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!validUsername(username)) {
      return res.status(400).json({
        error: "Kullanıcı adı 3-18 karakter olmalı. Harf, rakam ve _ kullanabilirsin."
      });
    }

    if (typeof password !== "string" || password.length < 6 || password.length > 72) {
      return res.status(400).json({
        error: "Şifre en az 6 karakter olmalı."
      });
    }

    const hash = await bcrypt.hash(password, 12);

    await pool.query(
      "INSERT INTO users (username, password_hash) VALUES ($1, $2)",
      [username, hash]
    );

    const token = createToken();
    sessions.set(token, username);

    res.json({ success: true, token, username });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: "Bu kullanıcı adı zaten alınmış."
      });
    }

    console.error(error);
    res.status(500).json({ error: "Kayıt oluşturulamadı." });
  }
});

// GİRİŞ
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!validUsername(username) || typeof password !== "string") {
      return res.status(400).json({ error: "Bilgileri kontrol et." });
    }

    const result = await pool.query(
      "SELECT username, password_hash FROM users WHERE LOWER(username) = LOWER($1)",
      [username]
    );

    if (!result.rows.length) {
      return res.status(401).json({
        error: "Kullanıcı adı veya şifre yanlış."
      });
    }

    const user = result.rows[0];
    const correct = await bcrypt.compare(password, user.password_hash);

    if (!correct) {
      return res.status(401).json({
        error: "Kullanıcı adı veya şifre yanlış."
      });
    }

    const token = createToken();
    sessions.set(token, user.username);

    res.json({
      success: true,
      token,
      username: user.username
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Giriş yapılamadı." });
  }
});

// OTURUM KAPATMA
app.post("/api/logout", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token) sessions.delete(token);
  res.json({ success: true });
});

// SUNUCU DURUMU
app.get("/api/status", (req, res) => {
  res.json({
    game: "Turk Sohbet",
    online: Object.keys(players).length,
    status: "online"
  });
});

// SOCKET KİMLİK DOĞRULAMA
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  const username = sessions.get(token);

  if (!username) {
    return next(new Error("Giriş yapmalısın."));
  }

  socket.username = username;
  next();
});

io.on("connection", (socket) => {
  console.log("Oyuncu bağlandı:", socket.username);

  // Aynı hesapla ikinci giriş yapılırsa eski bağlantıyı kapat.
  for (const id in players) {
    if (players[id].username === socket.username) {
      io.to(id).emit("sessionReplaced");
      io.sockets.sockets.get(id)?.disconnect(true);
    }
  }

  players[socket.id] = {
    id: socket.id,
    name: socket.username,
    x: 0,
    y: 0,
    z: 0,
    rotation: 0
  };

  socket.emit("welcome", {
    id: socket.id,
    players
  });

  socket.broadcast.emit("playerJoined", players[socket.id]);

  socket.on("move", (data) => {
    if (!players[socket.id] || !data) return;

    const values = [
      Number(data.x),
      Number(data.y),
      Number(data.z),
      Number(data.rotation)
    ];

    if (!values.every(Number.isFinite)) return;

    const [x, y, z, rotation] = values;

    players[socket.id].x = Math.max(-500, Math.min(500, x));
    players[socket.id].y = Math.max(-50, Math.min(100, y));
    players[socket.id].z = Math.max(-500, Math.min(500, z));
    players[socket.id].rotation = rotation;

    socket.broadcast.emit("playerMoved", players[socket.id]);
  });

  socket.on("chat", (message) => {
    if (!players[socket.id] || typeof message !== "string") return;

    const clean = message.trim().slice(0, 250);
    if (!clean) return;

    io.emit("chatMessage", {
      id: socket.id,
      name: socket.username,
      message: clean,
      time: Date.now()
    });
  });

  socket.on("disconnect", () => {
    if (!players[socket.id]) return;

    delete players[socket.id];
    io.emit("playerLeft", socket.id);

    console.log("Oyuncu ayrıldı:", socket.username);
  });
});

initializeDatabase()
  .then(() => {
    server.listen(PORT, () => {
      console.log("Türk Sohbet sunucusu çalışıyor:", PORT);
    });
  })
  .catch(error => {
    console.error("Veritabanı başlatılamadı:", error);
    process.exit(1);
  });
