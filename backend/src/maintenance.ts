import fs from "fs";
import path from "path";

type MaintenanceWindow = {
  description: string;
  days: number[];   // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  start: string;    // "HH:MM"
  end: string;      // "HH:MM"
  timezone?: string; // e.g. "Europe/Amsterdam"
};

export type ActiveWindow = MaintenanceWindow & { active: true };

// Read maintenance.json at runtime (consistent with targets.json / alerts.json)
const loadWindows = (): MaintenanceWindow[] => {
  const file = path.join(__dirname, "../maintenance.json");
  try {
    const config = JSON.parse(fs.readFileSync(file, "utf-8"));
    return (config.windows ?? []) as MaintenanceWindow[];
  } catch (err) {
    console.error("[Maintenance] Failed to read maintenance.json:", err);
    return [];
  }
};

export const getActiveMaintenanceWindow = (): MaintenanceWindow | null => {
  const now = new Date();

  const active = loadWindows().find((w) => {
    const tz = w.timezone ?? "UTC";
    const localDate = new Date(now.toLocaleString("en-US", { timeZone: tz }));
    const day = localDate.getDay();
    const hh = String(localDate.getHours()).padStart(2, "0");
    const mm = String(localDate.getMinutes()).padStart(2, "0");
    const timeStr = `${hh}:${mm}`;

    if (!w.days.includes(day)) return false;
    return timeStr >= w.start && timeStr <= w.end;
  });

  return active ?? null;
};

export const getAllWindows = (): MaintenanceWindow[] => loadWindows();
