import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server }       from "socket.io";
import mongoose         from "mongoose";
import cors             from "cors";
import helmet           from "helmet";
import compression      from "compression";
import morgan           from "morgan";
import rateLimit        from "express-rate-limit";

import { initSocket }  from "./services/socket.js";
import authRoutes      from "./routes/auth.js";
import chatsRoutes     from "./routes/chats.js";
import paymentRoutes   from "./routes/payment.js";
import { logger }      from "./utils/logger.js";
import path from "path";
import { fileURLToPath } from "url";
const app        = express();
const httpServer = createServer(app);
 

// ── Middleware ────────────────────────────────────────────────────────────────
// Serve Flutter/Web UI
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use("/", express.static(path.join(__dirname, "public/web")));
app.use(helmet());
app.use(compression());
app.use(cors({ origin: "*" }));
app.use(morgan("tiny", { stream: { write: m => logger.info(m.trim()) } }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });
app.use("/api", limiter);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/auth",    authRoutes);
app.use("/api/chats",   chatsRoutes);
app.use("/api/payment", paymentRoutes);

app.get("/health", (_, res) => res.json({ ok: true, uptime: process.uptime() }));

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(500).json({ error: "Internal server error" });
});

// ── Socket.io ─────────────────────────────────────────────────────────────────
const io = new Server(httpServer, {
  cors:              { origin: "*" },
  pingTimeout:       60000,
  pingInterval:      25000,
  maxHttpBufferSize: 5e6,   // 5MB (for images)
  transports:        ["websocket", "polling"],
});
initSocket(io);

// ── MongoDB ───────────────────────────────────────────────────────────────────
async function start() {
  try {
    await mongoose.connect(process.env.MONGO_URI, { maxPoolSize: 20 });
    logger.info("✅ MongoDB connected");

    const PORT = process.env.PORT || 3000;
    httpServer.listen(PORT, () => logger.info(`🚀 Server on port ${PORT}`));
  } catch (err) {
    logger.error(`Startup failed: ${err.message}`);
    process.exit(1);
  }
}

process.on("SIGTERM", async () => { await mongoose.disconnect(); process.exit(0); });
start();
