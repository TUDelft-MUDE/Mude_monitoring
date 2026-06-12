import { useEffect, useState } from "react";
import { fetchStatus, fetchUptime, StatusEntry, UptimeEntry } from "./api";

const REFRESH_INTERVAL = 60_000;

const StatusPage = () => {
  const [statuses, setStatuses] = useState<StatusEntry[]>([]);
  const [uptimeMap, setUptimeMap] = useState<Record<number, UptimeEntry>>({});
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const data = await fetchStatus();
    setStatuses(data);
    setLastUpdated(new Date());
    setLoading(false);

    const entries = await Promise.all(
      data.map((s) => fetchUptime(s.id).then((u) => ({ id: s.id, uptime: u })))
    );
    setUptimeMap(
      entries.reduce<Record<number, UptimeEntry>>((acc, { id, uptime }) => {
        return { ...acc, [id]: uptime };
      }, {})
    );
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  const allUp = statuses.length > 0 && statuses.every((s) => s.is_up === 1);
  const anyDown = statuses.some((s) => s.is_up === 0);

  const overallColor = anyDown ? "#ef4444" : allUp ? "#22c55e" : "#f59e0b";
  const overallText = anyDown
    ? "Some systems are experiencing issues"
    : allUp
    ? "All systems operational"
    : "Checking systems…";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#020817",
        color: "#e2e8f0",
        fontFamily: "system-ui, sans-serif",
        padding: "48px 24px",
        maxWidth: 720,
        margin: "0 auto",
      }}
    >
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: "0 0 8px" }}>
          MUDE Platform Status
        </h1>
        <p style={{ color: "#64748b", fontSize: 14, margin: "0 0 24px" }}>
          TU Delft — MUDE course infrastructure
        </p>
        {!loading && (
          <div
            style={{
              display: "inline-block",
              background: overallColor + "20",
              border: `1px solid ${overallColor}`,
              borderRadius: 8,
              padding: "10px 24px",
              color: overallColor,
              fontWeight: 700,
              fontSize: 15,
            }}
          >
            {overallText}
          </div>
        )}
      </div>

      {/* Service list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {statuses.map((entry) => {
          const isUp = entry.is_up === 1;
          const hasData = entry.checked_at !== null;
          const uptime = uptimeMap[entry.id];

          return (
            <div
              key={entry.id}
              style={{
                background: "#0f172a",
                border: "1px solid #1e293b",
                borderRadius: 8,
                padding: "16px 20px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{entry.name}</div>
                <div style={{ fontSize: 12, color: "#475569", marginTop: 2, wordBreak: "break-all" }}>
                  {entry.url}
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                {uptime && (
                  <div style={{ fontSize: 12, color: "#64748b", textAlign: "right" }}>
                    <div>24h: {uptime.uptime_24h !== null ? `${uptime.uptime_24h}%` : "—"}</div>
                    <div>7d: {uptime.uptime_7d !== null ? `${uptime.uptime_7d}%` : "—"}</div>
                  </div>
                )}
                <span
                  style={{
                    padding: "3px 12px",
                    borderRadius: 12,
                    fontSize: 13,
                    fontWeight: 700,
                    background: !hasData ? "#334155" : isUp ? "#16a34a" : "#dc2626",
                    color: "#fff",
                  }}
                >
                  {!hasData ? "PENDING" : isUp ? "UP" : "DOWN"}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ textAlign: "center", marginTop: 40, color: "#334155", fontSize: 13 }}>
        {lastUpdated && (
          <span>Last updated: {lastUpdated.toLocaleTimeString("en-GB")} · refreshes every 60s</span>
        )}
      </div>
    </div>
  );
};

export default StatusPage;
