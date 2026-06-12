import { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";

export const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many write requests, please slow down." },
});

export const requireApiKey = (req: Request, res: Response, next: NextFunction): void => {
  const configuredKey = process.env.API_KEY;
  if (!configuredKey) {
    // No key configured — skip auth (dev mode)
    next();
    return;
  }
  const provided = req.headers["x-api-key"];
  if (provided !== configuredKey) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }
  next();
};
