import nodemailer from "nodemailer";
import { config } from "./config";

export interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailResult {
  sent: boolean;
  /** Populated when sent=false and an SMTP error occurred (not when simply unconfigured). */
  error?: string;
}

/**
 * Sends a transactional email via the configured SMTP server.
 * Never throws — returns { sent: false, error? } on any failure so callers can
 * continue their primary operation and surface a warning to the admin.
 */
export async function sendEmail(opts: SendEmailOptions): Promise<EmailResult> {
  if (!config.email.enabled || !config.email.smtpHost) {
    // Not configured — log to console so the message is visible in server logs.
    console.info(`[Email - not configured] To: ${opts.to} | Subject: ${opts.subject}\n${opts.text}`);
    return { sent: false };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: config.email.smtpHost,
      port: config.email.smtpPort,
      secure: config.email.smtpPort === 465,
      auth: config.email.smtpUser
        ? { user: config.email.smtpUser, pass: config.email.smtpPass }
        : undefined,
    });

    await transporter.sendMail({
      from: `"${config.email.fromName}" <${config.email.fromAddress}>`,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });

    console.info(`[Email] Sent "${opts.subject}" to ${opts.to}`);
    return { sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Email] Failed to send "${opts.subject}" to ${opts.to}: ${message}`);
    return { sent: false, error: message };
  }
}

/**
 * Run at startup when EMAIL_ENABLED=true. Logs warnings for any missing or
 * obviously wrong settings so the operator knows before any user triggers a send.
 */
export function validateEmailConfig(): void {
  if (!config.email.enabled) return;

  const warnings: string[] = [];

  if (!config.email.smtpHost) {
    warnings.push("SMTP_HOST is not set — emails cannot be delivered");
  }
  if (!config.email.smtpUser) {
    warnings.push("SMTP_USER is not set (most SMTP servers require authentication)");
  }
  if (!config.email.smtpPass) {
    warnings.push("SMTP_PASS is not set");
  }
  if (config.email.fromAddress === "noreply@scmsolution.local") {
    warnings.push(
      "EMAIL_FROM is still the placeholder default — update to a real sender address"
    );
  }
  if (config.appBaseUrl === "http://localhost:3000") {
    warnings.push(
      "APP_BASE_URL is set to localhost — password-reset links in emails will be wrong in production"
    );
  }

  if (warnings.length) {
    console.warn("[Email] EMAIL_ENABLED=true but configuration is incomplete:");
    for (const w of warnings) console.warn(`  ⚠  ${w}`);
  } else {
    console.info(
      `[Email] Configured — SMTP ${config.email.smtpHost}:${config.email.smtpPort}, from <${config.email.fromAddress}>`
    );
  }
}

// ─── Email builders ───────────────────────────────────────────────────────────

export function buildWelcomeEmail(
  firstName: string,
  email: string,
  temporaryPassword: string
): SendEmailOptions {
  const loginUrl = `${config.appBaseUrl}/login`;

  const text = [
    `Hello ${firstName},`,
    "",
    "Your StockTrackRx account has been created.",
    "",
    `Login ID:  ${email}`,
    `Password:  ${temporaryPassword}`,
    "",
    "You will be prompted to set a new password on first login.",
    "",
    `Login here: ${loginUrl}`,
    "",
    "If you did not request this account, contact your system administrator.",
  ].join("\n");

  const html = `
<p>Hello ${firstName},</p>
<p>Your <strong>StockTrackRx</strong> account has been created.</p>
<table cellpadding="6" style="border:1px solid #e2e8f0;border-radius:6px;border-collapse:collapse;margin:12px 0">
  <tr style="background:#f8fafc"><td style="color:#64748b;padding:8px 12px">Login ID</td><td style="padding:8px 12px"><strong>${email}</strong></td></tr>
  <tr><td style="color:#64748b;padding:8px 12px">Temporary password</td><td style="padding:8px 12px"><strong style="font-family:monospace">${temporaryPassword}</strong></td></tr>
</table>
<p>You will be prompted to set a new password on first login.</p>
<p><a href="${loginUrl}" style="display:inline-block;background:#0f766e;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">Sign in now</a></p>
<p style="color:#94a3b8;font-size:12px;margin-top:20px">If you did not request this account, please contact your system administrator.</p>
`;

  return {
    to: email,
    subject: "Your StockTrackRx account credentials",
    text,
    html,
  };
}

export function buildPasswordResetEmail(
  firstName: string,
  email: string,
  temporaryPassword: string
): SendEmailOptions {
  const loginUrl = `${config.appBaseUrl}/login`;

  const text = [
    `Hello ${firstName},`,
    "",
    "Your StockTrackRx password has been reset by an administrator.",
    "",
    `Login ID:  ${email}`,
    `New temporary password:  ${temporaryPassword}`,
    "",
    "You will be prompted to set a new password on first login.",
    "",
    `Login here: ${loginUrl}`,
  ].join("\n");

  const html = `
<p>Hello ${firstName},</p>
<p>Your <strong>StockTrackRx</strong> password has been reset by an administrator.</p>
<table cellpadding="6" style="border:1px solid #e2e8f0;border-radius:6px;border-collapse:collapse;margin:12px 0">
  <tr style="background:#f8fafc"><td style="color:#64748b;padding:8px 12px">Login ID</td><td style="padding:8px 12px"><strong>${email}</strong></td></tr>
  <tr><td style="color:#64748b;padding:8px 12px">New temporary password</td><td style="padding:8px 12px"><strong style="font-family:monospace">${temporaryPassword}</strong></td></tr>
</table>
<p>You will be prompted to set a new password on first login.</p>
<p><a href="${loginUrl}" style="display:inline-block;background:#0f766e;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">Sign in now</a></p>
`;

  return {
    to: email,
    subject: "Your StockTrackRx password has been reset",
    text,
    html,
  };
}

export function buildForgotPasswordEmail(
  email: string,
  resetUrl: string,
  expiresAt: Date
): SendEmailOptions {
  const expiryStr = expiresAt.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });

  const text = [
    "Hello,",
    "",
    "A password reset was requested for your StockTrackRx account.",
    "",
    `Reset link (expires at ${expiryStr}):`,
    resetUrl,
    "",
    "If you did not request this, you can safely ignore this email.",
    "Your password will not change unless you follow the link above.",
  ].join("\n");

  const html = `
<p>Hello,</p>
<p>A password reset was requested for your <strong>StockTrackRx</strong> account.</p>
<p style="margin:20px 0">
  <a href="${resetUrl}" style="display:inline-block;background:#0f766e;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">Reset my password</a>
</p>
<p style="color:#64748b;font-size:13px">This link expires at <strong>${expiryStr}</strong>.</p>
<p style="color:#64748b;font-size:13px">If you did not request a password reset, you can safely ignore this email. Your password will not change.</p>
<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0"/>
<p style="color:#94a3b8;font-size:11px;word-break:break-all">If the button above doesn't work, copy this URL into your browser:<br>${resetUrl}</p>
`;

  return {
    to: email,
    subject: "Reset your StockTrackRx password",
    text,
    html,
  };
}
