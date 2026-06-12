import { Router, Request, Response } from "express";
import {
  getAllTargets,
  getLatestStatus,
  getHistory,
  getTargetById,
  createTarget,
  deleteTarget,
  getUptime,
  getIncidents,
} from "./db";
import { checkTarget } from "./checker";
import { requireApiKey, writeLimiter } from "./middleware";
import { getActiveMaintenanceWindow, getAllWindows } from "./maintenance";

const router = Router();

router.get("/targets", (_req: Request, res: Response) => {
  res.json({ success: true, data: getAllTargets() });
});

router.get("/status", (_req: Request, res: Response) => {
  res.json({ success: true, data: getLatestStatus() });
});

router.get("/history/:id", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ success: false, error: "Invalid target id" });
    return;
  }
  const target = getTargetById(id);
  if (!target) {
    res.status(404).json({ success: false, error: "Target not found" });
    return;
  }
  res.json({ success: true, data: getHistory(id) });
});

router.get("/uptime/:id", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ success: false, error: "Invalid target id" });
    return;
  }
  const target = getTargetById(id);
  if (!target) {
    res.status(404).json({ success: false, error: "Target not found" });
    return;
  }
  res.json({ success: true, data: getUptime(id) });
});

router.get("/incidents", (_req: Request, res: Response) => {
  res.json({ success: true, data: getIncidents() });
});

router.get("/maintenance", (_req: Request, res: Response) => {
  const active = getActiveMaintenanceWindow();
  res.json({
    success: true,
    data: {
      active: active !== null,
      current: active ?? null,
      windows: getAllWindows(),
    },
  });
});

router.post("/targets", writeLimiter, requireApiKey, (req: Request, res: Response) => {
  const { name, url } = req.body;

  if (!name || typeof name !== "string" || name.trim() === "") {
    res.status(400).json({ success: false, error: "Name is required" });
    return;
  }
  if (!url || typeof url !== "string" || !url.startsWith("http")) {
    res.status(400).json({ success: false, error: "Valid URL is required" });
    return;
  }

  try {
    createTarget(name.trim(), url.trim());

    // Fire-and-forget immediate check so the new target doesn't stay PENDING
    const newTarget = getAllTargets().find((t) => t.url === url.trim());
    if (newTarget) {
      checkTarget(newTarget).catch((err) =>
        console.error(`[Checker] Immediate check failed for ${newTarget.name}:`, err)
      );
    }

    res.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("UNIQUE")) {
      res.status(409).json({ success: false, error: "URL already exists" });
    } else {
      res.status(500).json({ success: false, error: message });
    }
  }
});

router.delete("/targets/:id", writeLimiter, requireApiKey, (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ success: false, error: "Invalid target id" });
    return;
  }
  const target = getTargetById(id);
  if (!target) {
    res.status(404).json({ success: false, error: "Target not found" });
    return;
  }
  deleteTarget(id);
  res.json({ success: true });
});

export default router;
