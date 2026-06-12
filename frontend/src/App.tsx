import { useEffect, useState } from "react";
import {
  fetchStatus,
  fetchHistory,
  fetchUptime,
  fetchIncidents,
  fetchMaintenance,
  addTarget,
  removeTarget,
  getApiKey,
  setApiKey,
  StatusEntry,
  HistoryEntry,
  UptimeEntry,
  Incident,
  MaintenanceStatus,
} from "./api";
import StatusCard from "./components/StatusCard";
import UptimeChart from "./components/UptimeChart";

const REFRESH_INTERVAL = 30_000;

const App = () => {
  const [statuses, setStatuses] = useState<StatusEntry[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [uptimeMap, setUptimeMap] = useState<Record<number, UptimeEntry>>({});
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceStatus | null>(null);

  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);

  const [apiKey, setApiKeyState] = useState<string>(getApiKey);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKeyInput, setShowKeyInput] = useState(false);

  const loadStatus = async () => {
    const data = await fetchStatus();
    setStatuses(data);
    setLastUpdated(new Date());
    if (selectedId === null && data.length > 0) {
      setSelectedId(data[0].id);
    }
    const entries = await Promise.all(
      data.map((s) => fetchUptime(s.id).then((u) => ({ id: s.id, uptime: u })))
    );
    setUptimeMap(
      entries.reduce<Record<number, UptimeEntry>>((acc, { id, uptime }) => {
        return { ...acc, [id]: uptime };
      }, {})
    );
    const incidentData = await fetchIncidents();
    setIncidents(incidentData);
    const maintenanceData = await fetchMaintenance();
    setMaintenance(maintenanceData);
  };

  const loadHistory = async (id: number) => {
    const data = await fetchHistory(id);
    setHistory(data);
  };

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedId !== null) {
      loadHistory(selectedId);
    }
  }, [selectedId]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = newName.trim();
    const trimmedUrl = newUrl.trim();

    if (!trimmedName) {
      setFormError("Name is required.");
      return;
    }
    if (!trimmedUrl.startsWith("http")) {
      setFormError("URL must start with http:// or https://");
      return;
    }

    setFormLoading(true);
    try {
      await addTarget(trimmedName, trimmedUrl);
      setNewName("");
      setNewUrl("");
      await loadStatus();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to add target.");
    } finally {
      setFormLoading(false);
    }
  };

  const handleSaveApiKey = () => {
    setApiKey(apiKeyInput.trim());
    setApiKeyState(apiKeyInput.trim());
    setApiKeyInput("");
    setShowKeyInput(false);
  };

  const handleDelete = async (id: number) => {
    try {
      await removeTarget(id);
      if (selectedId === id) {
        setSelectedId(null);
        setHistory([]);
      }
      await loadStatus();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to remove target.");
    }
  };

  const selectedTarget = statuses.find((s) => s.id === selectedId);
  const upCount = statuses.filter((s) => s.is_up === 1).length;
  const downCount = statuses.filter((s) => s.is_up === 0).length;

  return (
    <div style={{ minHeight: "100vh", background: "#020817", color: "#e2e8f0", fontFamily: "system-ui, sans-serif" }}>

      {/* ── Top bar ─────────────────────────────────────────── */}
      <header style={{
        background: "#0a1628",
        borderBottom: "1px solid #1e293b",
        padding: "0 32px",
        height: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0, whiteSpace: "nowrap" }}>
            MUDE Platform Monitor
          </h1>
          {/* Status pills */}
          <div style={{ display: "flex", gap: 8 }}>
            {upCount > 0 && (
              <span style={{ background: "#14532d", color: "#4ade80", borderRadius: 20, padding: "3px 12px", fontSize: 13, fontWeight: 600 }}>
                ● {upCount} UP
              </span>
            )}
            {downCount > 0 && (
              <span style={{ background: "#450a0a", color: "#f87171", borderRadius: 20, padding: "3px 12px", fontSize: 13, fontWeight: 600 }}>
                ● {downCount} DOWN
              </span>
            )}
            {maintenance?.active && (
              <span
                title={`Maintenance: ${maintenance.current?.description} — alerts suppressed`}
                style={{ background: "#422006", color: "#fb923c", borderRadius: 20, padding: "3px 12px", fontSize: 13, fontWeight: 600 }}
              >
                🔧 Maintenance
              </span>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {lastUpdated && (
            <span style={{ color: "#475569", fontSize: 13 }}>
              Updated {lastUpdated.toLocaleTimeString("en-GB")}
            </span>
          )}
          {/* API key */}
          {showKeyInput ? (
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="password"
                placeholder="Enter API key"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveApiKey()}
                autoFocus
                style={{
                  background: "#1e293b", border: "1px solid #334155", borderRadius: 6,
                  color: "#e2e8f0", fontSize: 13, padding: "5px 10px", outline: "none", width: 160,
                }}
              />
              <button onClick={handleSaveApiKey} style={btnStyle("#3b82f6")}>Save</button>
              <button onClick={() => setShowKeyInput(false)} style={btnStyle("transparent", "#475569")}>Cancel</button>
            </div>
          ) : (
            <button
              onClick={() => setShowKeyInput(true)}
              title={apiKey ? "API key is set — click to change" : "No API key set"}
              style={btnStyle("transparent", apiKey ? "#22c55e" : "#475569")}
            >
              {apiKey ? "🔒 Key set" : "🔓 Set API key"}
            </button>
          )}
        </div>
      </header>

      {/* ── Main content ────────────────────────────────────── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 0,
        height: "calc(100vh - 60px)",
      }}>

        {/* ── Left column: service cards + add form ─────────── */}
        <div style={{
          borderRight: "1px solid #1e293b",
          overflowY: "auto",
          padding: "24px 28px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}>
          <p style={{ margin: 0, color: "#475569", fontSize: 13 }}>
            Click a service to view its response time history.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {statuses.map((entry) => (
              <StatusCard
                key={entry.id}
                entry={entry}
                selected={entry.id === selectedId}
                onClick={() => setSelectedId(entry.id)}
                onDelete={handleDelete}
                uptime={uptimeMap[entry.id] ?? null}
              />
            ))}
          </div>

          {/* Add target form */}
          <form
            onSubmit={handleAdd}
            style={{
              background: "#0f172a",
              border: "1px solid #1e293b",
              borderRadius: 8,
              padding: "18px 20px",
              marginTop: 4,
            }}
          >
            <p style={{ margin: "0 0 12px", fontWeight: 600, fontSize: 14, color: "#94a3b8" }}>
              Add Monitoring Target
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                type="text"
                placeholder="Name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                style={inputStyle}
              />
              <input
                type="text"
                placeholder="https://example.com"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                style={inputStyle}
              />
              <button
                type="submit"
                disabled={formLoading}
                style={{
                  background: formLoading ? "#334155" : "#3b82f6",
                  border: "none", borderRadius: 6, color: "#fff",
                  cursor: formLoading ? "not-allowed" : "pointer",
                  fontSize: 14, fontWeight: 600, padding: "9px",
                }}
              >
                {formLoading ? "Adding…" : "Add"}
              </button>
            </div>
            {formError && (
              <p style={{ color: "#ef4444", fontSize: 13, marginTop: 8, marginBottom: 0 }}>
                {formError}
              </p>
            )}
          </form>
        </div>

        {/* ── Right column: chart + incidents ───────────────── */}
        <div style={{ overflowY: "auto", padding: "24px 28px", display: "flex", flexDirection: "column", gap: 24 }}>

          {/* Chart */}
          <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, padding: 24 }}>
            {selectedTarget ? (
              <UptimeChart name={selectedTarget.name} history={history} />
            ) : (
              <div style={{ color: "#475569", textAlign: "center", padding: 40, fontSize: 14 }}>
                Select a service to view history
              </div>
            )}
          </div>

          {/* Incident history */}
          <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, padding: 24 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 16px", color: "#e2e8f0" }}>
              Incident History
            </h2>
            {incidents.length === 0 ? (
              <p style={{ color: "#475569", fontSize: 14, margin: 0 }}>No incidents recorded.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ color: "#64748b", textAlign: "left" }}>
                    <th style={{ padding: "6px 12px 10px 0", fontWeight: 600 }}>Service</th>
                    <th style={{ padding: "6px 12px 10px", fontWeight: 600 }}>Started</th>
                    <th style={{ padding: "6px 12px 10px", fontWeight: 600 }}>Resolved</th>
                    <th style={{ padding: "6px 0 10px 12px", fontWeight: 600 }}>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {incidents.map((inc, i) => (
                    <tr
                      key={i}
                      style={{ borderTop: "1px solid #1e293b", color: inc.resolved_at ? "#94a3b8" : "#f87171" }}
                    >
                      <td style={{ padding: "8px 12px 8px 0", fontWeight: 500, color: "#e2e8f0" }}>
                        {inc.target_name}
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        {new Date(inc.started_at + "Z").toLocaleString("en-GB")}
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        {inc.resolved_at
                          ? new Date(inc.resolved_at + "Z").toLocaleString("en-GB")
                          : <span style={{ color: "#f87171", fontWeight: 600 }}>Ongoing</span>}
                      </td>
                      <td style={{ padding: "8px 0 8px 12px" }}>
                        {inc.duration_minutes !== null
                          ? inc.duration_minutes < 60
                            ? `${inc.duration_minutes}m`
                            : `${Math.floor(inc.duration_minutes / 60)}h ${inc.duration_minutes % 60}m`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Shared style helpers ───────────────────────────────────
const inputStyle: React.CSSProperties = {
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 6,
  color: "#e2e8f0",
  fontSize: 14,
  padding: "8px 12px",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const btnStyle = (bg: string, borderColor?: string): React.CSSProperties => ({
  background: bg,
  border: `1px solid ${borderColor ?? bg}`,
  borderRadius: 6,
  color: borderColor ?? "#fff",
  cursor: "pointer",
  fontSize: 13,
  padding: "5px 12px",
});

export default App;
