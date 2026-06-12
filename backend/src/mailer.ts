import nodemailer, { Transporter } from "nodemailer";
import fs from "fs";
import path from "path";

// ── SMTP transport ───────────────────────────────────────────────────
// Configured entirely via environment variables so the same image runs
// against a university SMTP relay or a Gmail/app-password account.
//
//   SMTP_HOST   smtp.gmail.com / smtp.tudelft.nl / ...
//   SMTP_PORT   587 (STARTTLS) or 465 (implicit TLS)
//   SMTP_USER   login user (optional for an open relay inside the campus)
//   SMTP_PASS   login password / app password (optional)
//   SMTP_FROM   From: address shown to recipients
//
// If SMTP_HOST is not set, email alerts are disabled (dev mode).

let transporter: Transporter | null = null;

const getTransporter = (): Transporter | null => {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  if (transporter) return transporter;

  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // implicit TLS on 465, STARTTLS otherwise
    auth: user && pass ? { user, pass } : undefined,
  });

  return transporter;
};

// Recipients live in alerts.json — a plain list of addresses. Unlike SNS,
// there is no confirmation step: whatever is listed simply receives mail.
const getRecipients = (): string[] => {
  const alertsFile = path.join(__dirname, "../alerts.json");
  try {
    const list: string[] = JSON.parse(fs.readFileSync(alertsFile, "utf-8"));
    return list.filter((e) => typeof e === "string" && e.includes("@"));
  } catch (err) {
    console.error("[Mailer] Failed to read alerts.json:", err);
    return [];
  }
};

export const sendEmailAlert = async (
  name: string,
  url: string,
  type: "DOWN" | "UP"
): Promise<void> => {
  const tx = getTransporter();
  if (!tx) {
    console.log("[Mailer] SMTP_HOST not set — email alert skipped");
    return;
  }

  const recipients = getRecipients();
  if (recipients.length === 0) {
    console.log("[Mailer] No recipients in alerts.json — email alert skipped");
    return;
  }

  const isDown = type === "DOWN";
  const dashboardUrl = process.env.PUBLIC_URL || "http://localhost:3000";
  const subject = isDown
    ? `[MUDE Monitor] ${name} is DOWN`
    : `[MUDE Monitor] ${name} recovered (UP)`;
  const text = [
    isDown ? "Platform DOWN detected" : "Platform recovery detected",
    ``,
    `Service : ${name}`,
    `URL     : ${url}`,
    `Status  : ${type}`,
    `Time    : ${new Date().toISOString()}`,
    ``,
    `Dashboard: ${dashboardUrl}`,
  ].join("\n");

  try {
    await tx.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER || "mude-monitor@localhost",
      to: recipients.join(", "),
      subject,
      text,
    });
    console.log(`[Mailer] Sent ${type} alert for ${name} to ${recipients.length} recipient(s)`);
  } catch (err) {
    console.error(`[Mailer] Failed to send ${type} alert for ${name}:`, err);
  }
};

// Verify SMTP connectivity on startup so misconfiguration is obvious in logs.
export const verifyMailer = async (): Promise<void> => {
  const tx = getTransporter();
  if (!tx) {
    console.log("[Mailer] SMTP_HOST not set — email alerts disabled");
    return;
  }
  try {
    await tx.verify();
    console.log(`[Mailer] SMTP ready (${process.env.SMTP_HOST}) — recipients: ${getRecipients().join(", ")}`);
  } catch (err) {
    console.error("[Mailer] SMTP verification failed:", err);
  }
};
