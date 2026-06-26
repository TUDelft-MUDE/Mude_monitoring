import cron from "node-cron";
import { getAllTargets, insertCheck, getLastTwoChecks } from "./db";
import { getActiveMaintenanceWindow } from "./maintenance";
import { sendEmailAlert } from "./email";

type Target = { id: number; name: string; url: string };

const sendTeamsAlert = async (
  name: string,
  url: string,
  type: "DOWN" | "UP"
): Promise<void> => {
  const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
  if (!webhookUrl) return;

  const isDown = type === "DOWN";
  const color = isDown ? "FF0000" : "00C851";
  const title = isDown ? `🔴 ${name} is DOWN` : `🟢 ${name} recovered (UP)`;
  const dashboardUrl = process.env.PUBLIC_URL || "http://localhost:3000";

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        "@type": "MessageCard",
        "@context": "https://schema.org/extensions",
        themeColor: color,
        summary: title,
        sections: [
          {
            activityTitle: title,
            facts: [
              { name: "Service", value: name },
              { name: "URL", value: url },
              { name: "Time", value: new Date().toISOString() },
            ],
          },
        ],
        potentialAction: [
          {
            "@type": "OpenUri",
            name: "Open Dashboard",
            targets: [{ os: "default", uri: dashboardUrl }],
          },
        ],
      }),
    });
  } catch (err) {
    console.error(`[Teams] Failed to send ${type} alert for ${name}:`, err);
  }
};

const sendAlert = async (
  name: string,
  url: string,
  type: "DOWN" | "UP"
): Promise<void> => {
  const window = getActiveMaintenanceWindow();
  if (window) {
    console.log(
      `[Checker] Maintenance window "${window.description}" active — alert suppressed for ${name}`
    );
    return;
  }
  // Each channel no-ops when its own config is missing, so email and Teams
  // can be enabled independently.
  await Promise.all([
    sendEmailAlert(name, url, type),
    sendTeamsAlert(name, url, type),
  ]);
};

export const checkTarget = async (target: Target): Promise<void> => {
  const start = Date.now();
  try {
    const response = await fetch(target.url, { signal: AbortSignal.timeout(10000) });
    const responseTimeMs = Date.now() - start;
    insertCheck(target.id, response.status, responseTimeMs, response.ok);
    console.log(`[${target.name}] ${response.status} - ${responseTimeMs}ms`);
  } catch {
    const responseTimeMs = Date.now() - start;
    insertCheck(target.id, null, responseTimeMs, false);
    console.log(`[${target.name}] DOWN - ${responseTimeMs}ms`);
  }

  const lastTwo = getLastTwoChecks(target.id);
  const current = lastTwo[0];
  const previous = lastTwo[1];

  const justWentDown =
    current?.is_up === 0 &&
    (previous === undefined || previous.is_up === 1);

  const justRecovered =
    current?.is_up === 1 && previous?.is_up === 0;

  if (justWentDown) {
    console.log(`[${target.name}] Transition UP -> DOWN, sending alert`);
    await sendAlert(target.name, target.url, "DOWN");
  } else if (justRecovered) {
    console.log(`[${target.name}] Transition DOWN -> UP, sending recovery alert`);
    await sendAlert(target.name, target.url, "UP");
  }
};

const runChecks = async (): Promise<void> => {
  const targets = getAllTargets() as Target[];
  await Promise.all(targets.map(checkTarget));
};

export const startChecker = (): void => {
  runChecks();
  cron.schedule("*/5 * * * *", runChecks);
  console.log("Checker started — polling every 5 minutes");
};
