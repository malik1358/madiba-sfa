export function parseEmailList(value) {
  return String(value || "")
    .split(/[,\n;]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry));
}

export function isLikelyEmail(value) {
  return parseEmailList(value).length === 1;
}

export function isDeliverableEmail(value) {
  const email = parseEmailList(value)[0] || "";
  if (!email) return false;
  const host = email.split("@")[1] || "";
  return Boolean(host) && !host.endsWith(".local") && host !== "localhost";
}

export function normalizeDeliverableEmail(value) {
  const email = parseEmailList(value)[0] || "";
  return isDeliverableEmail(email) ? email : "";
}

export function getMailerConfig(env = process.env) {
  const host = String(env.SMTP_HOST || "").trim();
  const port = Number(env.SMTP_PORT || 587);
  const user = String(env.SMTP_USER || "").trim();
  const pass = String(env.SMTP_PASS || "").trim();
  const from = String(env.SMTP_FROM || env.DAILY_VISIT_REPORT_FROM || user).trim();
  const resendKey = String(env.RESEND_API_KEY || "").trim();

  return {
    host,
    port: Number.isFinite(port) ? port : 587,
    user,
    pass,
    from,
    resendKey,
    secure: Number(port) === 465,
  };
}

export function isEmailConfigured(config = getMailerConfig()) {
  if (!config.from) return false;
  if (config.resendKey) return true;
  return Boolean(config.host);
}

function bufferToBase64(content) {
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(content)) {
    return content.toString("base64");
  }
  if (content instanceof ArrayBuffer) {
    return Buffer.from(content).toString("base64");
  }
  if (ArrayBuffer.isView(content)) {
    return Buffer.from(content.buffer, content.byteOffset, content.byteLength).toString("base64");
  }
  return Buffer.from(String(content || ""), "utf8").toString("base64");
}

function toNodeBuffer(content) {
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(content)) return content;
  if (content instanceof ArrayBuffer) return Buffer.from(content);
  if (ArrayBuffer.isView(content)) {
    return Buffer.from(content.buffer, content.byteOffset, content.byteLength);
  }
  return Buffer.from(String(content || ""), "utf8");
}

export function normalizeEmailAttachments(attachments = []) {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .map((entry) => {
      const filename = String(entry?.filename || entry?.fileName || "").trim();
      if (!filename || entry?.content == null) return null;
      const contentType = String(entry.contentType || entry.content_type || "application/octet-stream").trim()
        || "application/octet-stream";
      return {
        filename,
        content: entry.content,
        contentType,
      };
    })
    .filter(Boolean);
}

async function sendWithResend(config, message) {
  const attachments = normalizeEmailAttachments(message.attachments).map((entry) => ({
    filename: entry.filename,
    content: bufferToBase64(entry.content),
    content_type: entry.contentType,
  }));

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.from,
      to: message.to,
      cc: message.cc?.length ? message.cc : undefined,
      subject: message.subject,
      html: message.html,
      text: message.text,
      ...(attachments.length ? { attachments } : {}),
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `Resend failed with HTTP ${response.status}`);
  }

  return { provider: "resend", id: payload?.id || null };
}

async function sendWithSmtp(config, message) {
  const mod = await import("nodemailer");
  const nodemailer = mod.default || mod;
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.pass } : undefined,
  });

  const attachments = normalizeEmailAttachments(message.attachments).map((entry) => ({
    filename: entry.filename,
    content: toNodeBuffer(entry.content),
    contentType: entry.contentType,
  }));

  const info = await transporter.sendMail({
    from: config.from,
    to: message.to.join(", "),
    cc: message.cc?.length ? message.cc.join(", ") : undefined,
    subject: message.subject,
    html: message.html,
    text: message.text,
    ...(attachments.length ? { attachments } : {}),
  });

  return { provider: "smtp", id: info?.messageId || null };
}

export async function sendEmail(message, env = process.env) {
  const config = getMailerConfig(env);
  if (!isEmailConfigured(config)) {
    throw new Error("Email is not configured. Set SMTP_HOST and SMTP_FROM, or RESEND_API_KEY and SMTP_FROM.");
  }

  const to = parseEmailList(Array.isArray(message.to) ? message.to.join(",") : message.to);
  const cc = parseEmailList(Array.isArray(message.cc) ? message.cc.join(",") : message.cc)
    .filter((email) => !to.includes(email));

  if (!to.length) {
    throw new Error("No email recipients.");
  }

  const payload = {
    to,
    cc,
    subject: String(message.subject || "").trim(),
    html: String(message.html || ""),
    text: String(message.text || ""),
    attachments: normalizeEmailAttachments(message.attachments),
  };

  if (config.resendKey) {
    return sendWithResend(config, payload);
  }

  return sendWithSmtp(config, payload);
}
