import initSqlJs, { Database } from "sql.js";
import path from "path";
import fs from "fs";

const DB_DIR = process.env.DB_PATH
  ? path.dirname(process.env.DB_PATH)
  : path.join(__dirname, "../../data");

const DB_FILE = process.env.DB_PATH || path.join(DB_DIR, "monitoring.db");

let db: Database;

const save = () => {
  const data = db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
};

export const initDb = async (): Promise<void> => {
  const SQL = await initSqlJs();

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  const fileBuffer = fs.existsSync(DB_FILE) ? fs.readFileSync(DB_FILE) : null;
  db = fileBuffer ? new SQL.Database(fileBuffer) : new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS targets (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url  TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS checks (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      target_id        INTEGER NOT NULL,
      status_code      INTEGER,
      response_time_ms INTEGER NOT NULL,
      is_up            INTEGER NOT NULL,
      checked_at       TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (target_id) REFERENCES targets(id)
    );
  `);

  // Seed default targets from targets.json (INSERT OR IGNORE — never delete UI-added targets)
  const targetsFile = path.join(__dirname, "../targets.json");
  const targets: { name: string; url: string }[] = JSON.parse(
    fs.readFileSync(targetsFile, "utf-8")
  );

  const insert = db.prepare(
    "INSERT OR IGNORE INTO targets (name, url) VALUES (?, ?)"
  );
  for (const target of targets) {
    insert.run([target.name, target.url]);
  }
  insert.free();

  save();
};

const query = <T>(sql: string, params: (string | number | null)[] = []): T[] => {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows: T[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return rows;
};

export type Target = { id: number; name: string; url: string };

export const getAllTargets = (): Target[] => query<Target>("SELECT * FROM targets");

export const insertCheck = (
  targetId: number,
  statusCode: number | null,
  responseTimeMs: number,
  isUp: boolean
): void => {
  db.run(
    "INSERT INTO checks (target_id, status_code, response_time_ms, is_up) VALUES (?, ?, ?, ?)",
    [targetId, statusCode, responseTimeMs, isUp ? 1 : 0]
  );
  save();
};

export const getLatestStatus = () =>
  query(
    `SELECT t.id, t.name, t.url, c.status_code, c.response_time_ms, c.is_up, c.checked_at
     FROM targets t
     LEFT JOIN checks c ON c.id = (
       SELECT id FROM checks WHERE target_id = t.id ORDER BY checked_at DESC LIMIT 1
     )`
  );

export const getHistory = (targetId: number) =>
  query(
    `SELECT status_code, response_time_ms, is_up, checked_at
     FROM checks
     WHERE target_id = ?
       AND checked_at >= datetime('now', '-24 hours')
     ORDER BY checked_at ASC`,
    [targetId]
  );

export const getTargetById = (id: number) =>
  query("SELECT * FROM targets WHERE id = ?", [id])[0] ?? null;

export const createTarget = (name: string, url: string): void => {
  db.run("INSERT INTO targets (name, url) VALUES (?, ?)", [name, url]);
  save();
};

export const deleteTarget = (id: number): void => {
  db.run("DELETE FROM checks WHERE target_id = ?", [id]);
  db.run("DELETE FROM targets WHERE id = ?", [id]);
  save();
};

export const getLastTwoChecks = (targetId: number) =>
  query<{ is_up: number }>(
    `SELECT is_up FROM checks WHERE target_id = ? ORDER BY checked_at DESC LIMIT 2`,
    [targetId]
  );

export type UptimeResult = { uptime_24h: number | null; uptime_7d: number | null };

export type Incident = {
  target_id: number;
  target_name: string;
  started_at: string;
  resolved_at: string | null;
  duration_minutes: number | null;
};

export const getIncidents = (): Incident[] => {
  type CheckRow = {
    target_id: number;
    target_name: string;
    is_up: number;
    checked_at: string;
  };

  const rows = query<CheckRow>(
    `SELECT c.target_id, t.name AS target_name, c.is_up, c.checked_at
     FROM checks c
     JOIN targets t ON c.target_id = t.id
     ORDER BY c.target_id, c.checked_at ASC`
  );

  const incidents: Incident[] = [];
  const open: Record<number, { target_name: string; started_at: string }> = {};

  for (const { target_id, target_name, is_up, checked_at } of rows) {
    if (is_up === 0 && !open[target_id]) {
      open[target_id] = { target_name, started_at: checked_at };
    } else if (is_up === 1 && open[target_id]) {
      const { started_at } = open[target_id];
      const duration_minutes = Math.round(
        (new Date(checked_at + "Z").getTime() - new Date(started_at + "Z").getTime()) / 60_000
      );
      incidents.push({ target_id, target_name, started_at, resolved_at: checked_at, duration_minutes });
      delete open[target_id];
    }
  }

  // Ongoing incidents (still DOWN)
  for (const [id, { target_name, started_at }] of Object.entries(open)) {
    incidents.push({
      target_id: Number(id),
      target_name,
      started_at,
      resolved_at: null,
      duration_minutes: null,
    });
  }

  return incidents.sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
  );
};

export const getUptime = (targetId: number): UptimeResult => {
  const row = query<UptimeResult>(
    `SELECT
       ROUND(100.0 * SUM(CASE WHEN checked_at >= datetime('now', '-24 hours') AND is_up = 1 THEN 1 ELSE 0 END)
             / NULLIF(SUM(CASE WHEN checked_at >= datetime('now', '-24 hours') THEN 1 ELSE 0 END), 0), 1) AS uptime_24h,
       ROUND(100.0 * SUM(CASE WHEN checked_at >= datetime('now', '-7 days') AND is_up = 1 THEN 1 ELSE 0 END)
             / NULLIF(SUM(CASE WHEN checked_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END), 0), 1) AS uptime_7d
     FROM checks
     WHERE target_id = ?`,
    [targetId]
  );
  return row[0] ?? { uptime_24h: null, uptime_7d: null };
};
