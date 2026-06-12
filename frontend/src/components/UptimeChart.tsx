import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { HistoryEntry } from "../api";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

type Props = {
  name: string;
  history: HistoryEntry[];
};

const UptimeChart = ({ name, history }: Props) => {
  if (history.length === 0) {
    return (
      <div style={{ color: "#64748b", textAlign: "center", padding: 32 }}>
        No history data yet. Check back in a few minutes.
      </div>
    );
  }

  const labels = history.map((h) =>
    new Date(h.checked_at + "Z").toLocaleTimeString("en-GB")
  );

  const data = {
    labels,
    datasets: [
      {
        label: "Response Time (ms)",
        data: history.map((h) => h.response_time_ms),
        borderColor: "#4f8ef7",
        backgroundColor: "rgba(79,142,247,0.1)",
        tension: 0.3,
        pointRadius: 3,
        pointBackgroundColor: history.map((h) =>
          h.is_up ? "#22c55e" : "#ef4444"
        ),
      },
    ],
  };

  const options = {
    responsive: true,
    plugins: {
      legend: { display: false },
      title: {
        display: true,
        text: `${name} — Last 24h`,
        color: "#e2e8f0",
      },
    },
    scales: {
      x: { ticks: { color: "#64748b", maxTicksLimit: 8 } },
      y: {
        ticks: { color: "#64748b" },
        title: { display: true, text: "ms", color: "#64748b" },
      },
    },
  };

  return <Line data={data} options={options} />;
};

export default UptimeChart;
