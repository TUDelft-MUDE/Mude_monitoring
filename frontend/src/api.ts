const BASE = "/api";

export const getApiKey = (): string => localStorage.getItem("apiKey") ?? "";
export const setApiKey = (key: string): void => localStorage.setItem("apiKey", key);

const authHeaders = (): Record<string, string> => {
  const key = getApiKey();
  return key ? { "X-Api-Key": key } : {};
};

export type Target = {
  id: number;
  name: string;
  url: string;
};

export type StatusEntry = {
  id: number;
  name: string;
  url: string;
  status_code: number | null;
  response_time_ms: number | null;
  is_up: 0 | 1 | null;
  checked_at: string | null;
};

export type HistoryEntry = {
  status_code: number | null;
  response_time_ms: number;
  is_up: 0 | 1;
  checked_at: string;
};

export const fetchStatus = async (): Promise<StatusEntry[]> => {
  const res = await fetch(`${BASE}/status`);
  const json = await res.json();
  return json.data;
};

export const fetchHistory = async (id: number): Promise<HistoryEntry[]> => {
  const res = await fetch(`${BASE}/history/${id}`);
  const json = await res.json();
  return json.data;
};

export const addTarget = async (name: string, url: string): Promise<void> => {
  const res = await fetch(`${BASE}/targets`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ name, url }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
};

export const removeTarget = async (id: number): Promise<void> => {
  const res = await fetch(`${BASE}/targets/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
};

export type UptimeEntry = {
  uptime_24h: number | null;
  uptime_7d: number | null;
};

export type Incident = {
  target_id: number;
  target_name: string;
  started_at: string;
  resolved_at: string | null;
  duration_minutes: number | null;
};

export const fetchUptime = async (id: number): Promise<UptimeEntry> => {
  const res = await fetch(`${BASE}/uptime/${id}`);
  const json = await res.json();
  return json.data;
};

export const fetchIncidents = async (): Promise<Incident[]> => {
  const res = await fetch(`${BASE}/incidents`);
  const json = await res.json();
  return json.data;
};

export type MaintenanceStatus = {
  active: boolean;
  current: { description: string; days: number[]; start: string; end: string; timezone?: string } | null;
};

export const fetchMaintenance = async (): Promise<MaintenanceStatus> => {
  const res = await fetch(`${BASE}/maintenance`);
  const json = await res.json();
  return json.data;
};
