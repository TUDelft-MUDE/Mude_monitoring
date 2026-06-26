import nodemailer, { Transporter } from "nodemailer";
import fs from "fs";
import path from "path";

type AlertType = "DOWN" | "UP";

// Alert recipients live in backend/recipients.txt — one email per line, with
// blank lines and #-comments ignored. This lets a non-technical maintainer add
// or remove recipients straight from GitHub without ever touching .env. If the
// file is missing or empty we fall back to the ALERT_EMAIL_TO env var.
const RECIPIENTS_FILE = path.join(__dirname, "../recipients.txt");

// Split on newlines or commas, then keep only real addresses (drops comments,
// blanks, and stray text). Works for both the file and the comma-separated env.
const parseRecipients = (raw: string | undefined): string[] =>
  (raw ?? "")
    .split(/[\n,]/)
    .map((addr) => addr.trim())
    .filter((addr) => addr.length > 0 && !addr.startsWith("#") && addr.includes("@"));

const getRecipients = (): string[] => {
  try {
    const fromFile = parseRecipients(fs.readFileSync(RECIPIENTS_FILE, "utf-8"));
    if (fromFile.length > 0) return fromFile;
  } catch {
    // recipients.txt absent — fall back to the env var below
  }
  return parseRecipients(process.env.ALERT_EMAIL_TO);
};

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

  const recipients = getRecipients();
  if (recipients.length === 0) {
    console.warn(
      "[Email] No recipients (backend/recipients.txt empty and ALERT_EMAIL_TO unset) — skipping email alert"
    );
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
