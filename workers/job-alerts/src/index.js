/**
 * Faculty Atlas job-alerts Worker.
 *
 * Holds subscriber state in KV (never in the public git repo — see the plan
 * doc for why) and exposes:
 *   POST /subscribe            — public, from the site's alert form
 *   GET  /confirm?token=...    — public, clicked from the confirmation email
 *   GET  /unsubscribe?token=.. — public, clicked from a digest email
 *   GET  /internal/subscribers — bearer-auth'd, read by the send-job-alerts GitHub Action
 *   POST /internal/mark-sent   — bearer-auth'd, called after a successful digest send
 *
 * KV key scheme:
 *   pending:<token>        -> { email, filters, createdAt }               (24h TTL)
 *   active:<sha256(email)> -> { email, filters, confirmedAt, unsubscribeToken, lastNotifiedJobIds }
 *   ratelimit:<ip>         -> count                                       (1h TTL)
 */

const PENDING_TTL_SECONDS = 24 * 60 * 60;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
const RATE_LIMIT_MAX_PER_WINDOW = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get("Origin") || "";
  const headers = { Vary: "Origin" };
  if (allowed.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
  }
  return headers;
}

function json(data, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function html(body, { status = 200, headers = {} } = {}) {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...headers } });
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

// Strip filter fields that are meaningless server-side: savedOnly is the
// visitor's personal local saved-jobs list; newOnly means "since my last
// visit" locally — for a mailed digest, "new" instead means "new since the
// last time we emailed this subscriber", tracked via lastNotifiedJobIds.
function sanitizeFilters(filters) {
  const f = filters && typeof filters === "object" ? filters : {};
  const { savedOnly, newOnly, ...rest } = f;
  return rest;
}

async function sendEmail(env, { to, subject, htmlBody }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: env.FROM_EMAIL, to, subject, html: htmlBody }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend send failed (${res.status}): ${body}`);
  }
}

function escHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

async function handleSubscribe(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = String(body?.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return json({ error: "Enter a valid email address" }, { status: 400 });
  }

  // Basic per-IP rate limit to slow down signup abuse.
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const rlKey = `ratelimit:${ip}`;
  const rlCount = Number((await env.ALERTS_KV.get(rlKey)) || "0");
  if (rlCount >= RATE_LIMIT_MAX_PER_WINDOW) {
    return json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }
  await env.ALERTS_KV.put(rlKey, String(rlCount + 1), { expirationTtl: RATE_LIMIT_WINDOW_SECONDS });

  const filters = sanitizeFilters(body?.filters);
  const token = randomToken();
  await env.ALERTS_KV.put(
    `pending:${token}`,
    JSON.stringify({ email, filters, createdAt: new Date().toISOString() }),
    { expirationTtl: PENDING_TTL_SECONDS }
  );

  const origin = new URL(request.url).origin;
  const confirmUrl = `${origin}/confirm?token=${token}`;

  try {
    await sendEmail(env, {
      to: email,
      subject: "Confirm your Faculty Atlas job alert",
      htmlBody: `
        <p>Someone (hopefully you) asked to subscribe this address to a Faculty Atlas job alert.</p>
        <p><a href="${escHtml(confirmUrl)}">Click here to confirm and start receiving alerts</a>.</p>
        <p>If this wasn't you, just ignore this email — nothing happens until it's confirmed, and this request expires in 24 hours.</p>
      `,
    });
  } catch (err) {
    return json({ error: "Could not send confirmation email. Try again shortly." }, { status: 502 });
  }

  return json({ ok: true, message: "Check your inbox to confirm." });
}

async function handleConfirm(request, env) {
  const token = new URL(request.url).searchParams.get("token") || "";
  const pendingRaw = token ? await env.ALERTS_KV.get(`pending:${token}`) : null;
  if (!pendingRaw) {
    return html("<p>This confirmation link is invalid or has expired. Please subscribe again.</p>", { status: 400 });
  }

  const pending = JSON.parse(pendingRaw);
  const subscriberId = await sha256Hex(pending.email);
  const activeKey = `active:${subscriberId}`;
  const existingRaw = await env.ALERTS_KV.get(activeKey);
  const existing = existingRaw ? JSON.parse(existingRaw) : null;

  const record = {
    email: pending.email,
    filters: pending.filters,
    confirmedAt: new Date().toISOString(),
    unsubscribeToken: existing?.unsubscribeToken || randomToken(),
    lastNotifiedJobIds: existing?.lastNotifiedJobIds || [],
  };

  await env.ALERTS_KV.put(activeKey, JSON.stringify(record));
  await env.ALERTS_KV.delete(`pending:${token}`);

  return html("<p>You're subscribed. You'll get an email when new postings match your saved search. You can unsubscribe anytime from the link in any alert email.</p>");
}

async function handleUnsubscribe(request, env) {
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!token) return html("<p>Missing unsubscribe token.</p>", { status: 400 });

  // No index from unsubscribeToken -> key, so scan active subscribers.
  // Fine at this scale (KV list is paginated at 1000 keys/call).
  let cursor;
  do {
    const page = await env.ALERTS_KV.list({ prefix: "active:", cursor });
    for (const { name } of page.keys) {
      const raw = await env.ALERTS_KV.get(name);
      if (!raw) continue;
      const record = JSON.parse(raw);
      if (record.unsubscribeToken === token) {
        await env.ALERTS_KV.delete(name);
        return html("<p>You've been unsubscribed. Sorry to see you go.</p>");
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return html("<p>This unsubscribe link is invalid or already used.</p>", { status: 400 });
}

function requireInternalAuth(request, env) {
  const auth = request.headers.get("Authorization") || "";
  return auth === `Bearer ${env.ALERTS_INTERNAL_SECRET}`;
}

async function handleListSubscribers(request, env) {
  if (!requireInternalAuth(request, env)) return json({ error: "Unauthorized" }, { status: 401 });

  const subscribers = [];
  let cursor;
  do {
    const page = await env.ALERTS_KV.list({ prefix: "active:", cursor });
    for (const { name } of page.keys) {
      const raw = await env.ALERTS_KV.get(name);
      if (!raw) continue;
      subscribers.push({ id: name.slice("active:".length), ...JSON.parse(raw) });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return json({ subscribers });
}

async function handleMarkSent(request, env) {
  if (!requireInternalAuth(request, env)) return json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates = Array.isArray(body?.updates) ? body.updates : [];
  for (const { id, lastNotifiedJobIds } of updates) {
    const key = `active:${id}`;
    const raw = await env.ALERTS_KV.get(key);
    if (!raw) continue;
    const record = JSON.parse(raw);
    record.lastNotifiedJobIds = Array.isArray(lastNotifiedJobIds) ? lastNotifiedJobIds : record.lastNotifiedJobIds;
    await env.ALERTS_KV.put(key, JSON.stringify(record));
  }

  return json({ ok: true, updated: updates.length });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    let response;
    if (url.pathname === "/subscribe" && request.method === "POST") {
      response = await handleSubscribe(request, env);
    } else if (url.pathname === "/confirm" && request.method === "GET") {
      response = await handleConfirm(request, env);
    } else if (url.pathname === "/unsubscribe" && request.method === "GET") {
      response = await handleUnsubscribe(request, env);
    } else if (url.pathname === "/internal/subscribers" && request.method === "GET") {
      response = await handleListSubscribers(request, env);
    } else if (url.pathname === "/internal/mark-sent" && request.method === "POST") {
      response = await handleMarkSent(request, env);
    } else {
      response = json({ error: "Not found" }, { status: 404 });
    }

    for (const [k, v] of Object.entries(cors)) response.headers.set(k, v);
    return response;
  },
};
