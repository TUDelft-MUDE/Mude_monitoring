import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { initDb } from "./db";
import router from "./routes";
import { startChecker } from "./checker";

const PORT = process.env.PORT || 3001;

// ── CORS ──────────────────────────────────────────────────────────
const rawOrigins = process.env.ALLOWED_ORIGINS || "http://localhost:3000";
const allowedOrigins = rawOrigins.split(",").map((o) => o.trim());

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
};

// ── Global rate limit ─────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many requests, please try again later." },
});

// ── Server ────────────────────────────────────────────────────────
const main = async () => {
  await initDb();

  const app = express();
  app.use(cors(corsOptions));
  app.use(express.json());
  app.use(globalLimiter);
  app.use("/api", router);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.listen(PORT, () => {
    console.log(`Backend running on port ${PORT}`);
    startChecker();
  });
};

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
