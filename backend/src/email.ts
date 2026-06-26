import nodemailer, { Transporter } from "nodemailer";

type AlertType = "DOWN" | "UP";

// Parse a comma-separated recipient list into trimmed, non-empty addresses.
const parseRecipients = (raw: string | undefined): string[] =>
  (raw ?? "")
    .split(",")
    .map((addr) => addr.trim())
    .filter((addr) => addr.length > 0);

// Lazily build and cache the SMTP transporter so missing config never crashes
// the checker — email alerts simply stay disabled until SMTP_HOST is provided.
let cachedTransporter: Transporter | null | undefined;

const getTransporter = (): Transporter | null => {
  if (cachedTransporter !== undefined) return cachedTransporter;

  const host = process.env.SMTP_HOST;
  if (!host) {
    console.warn("[Email] SMTP_HOST not set — email alerts disabled");
    cachedTransporter = null;
    return cachedTransporter;
  }

  const port = Number(process.env.SMTP_PORT ?? "25");
  const secure = process.env.SMTP_SECURE === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    // Campus relays often accept unauthenticated mail from an on-host sender;
    // only attach credentials when both are supplied.
    auth: user && pass ? { user, pass } : undefined,
  });

  return cachedTransporter;
};

export const sendEmailAlert = async (
  name: string,
  url: string,
  type: AlertType
): Promise<void> => {
  const transporter = getTransporter();
  if (!transporter) return;

  const recipients = parseRecipients(process.env.ALERT_EMAIL_TO);
  if (recipients.length === 0) {
    console.warn("[Email] ALERT_EMAIL_TO not set — skipping email alert");
    return;
  }

  const from = process.env.ALERT_EMAIL_FROM ?? "mude-monitor@tudelft.nl";
  const dashboardUrl = process.env.PUBLIC_URL ?? "http://localhost:3000";
  const isDown = type === "DOWN";
  const subject = isDown
    ? `[MUDE Monitor] DOWN: ${name}`
    : `[MUDE Monitor] RECOVERED: ${name}`;
  const statusLine = isDown ? "is DOWN" : "has RECOVERED (UP)";

  const text = [
    `${name} ${statusLine}.`,
    "",
    `URL:  ${url}`,
    `Time: ${new Date().toISOString()}`,
    "",
    `Dashboard: ${dashboardUrl}`,
  ].join("\n");

  try {
    await transporter.sendMail({ from, to: recipients, subject, text });
    console.log(
      `[Email] Sent ${type} alert for ${name} to ${recipients.length} recipient(s)`
    );
  } catch (err) {
    console.error(`[Email] Failed to send ${type} alert for ${name}:`, err);
  }
};
