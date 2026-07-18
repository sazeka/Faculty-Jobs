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

// Branded landing page shared by /confirm and /unsubscribe (success and
// error states) — same visual language as the hub pages (generate-hub-pages.js)
// so a subscriber landing here from an email link sees a page that matches
// the rest of the site rather than a bare unstyled string.
function renderPage({ heading, message, isError = false }) {
  const BASE_URL = "https://www.facultyatlas.org";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${heading} | Faculty Atlas</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Newsreader:ital,opsz,wght@0,6..72,300..700;1,6..72,300..700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    :root { --bg:#f3f3f1; --paper:#fbfbfa; --ink:#1d2128; --ink2:#454b55; --ink3:#8a8f99; --accent:#2b3442; --rule:#e2e2df; --status:${isError ? "#b3261e" : "#0F766E"}; }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:var(--bg); color:var(--ink); font-family:'Newsreader',serif; font-size:17px; line-height:1.6; min-height:100vh; display:flex; flex-direction:column; }
    a { color:inherit; }
    header { display:flex; align-items:center; padding:18px 7vw; border-bottom:1px solid var(--rule); background:var(--paper); }
    .brand { display:flex; align-items:center; gap:12px; text-decoration:none; }
    .brand .wm { font-family:'Instrument Serif',serif; font-size:24px; color:var(--ink); }
    main { flex:1; display:flex; align-items:center; justify-content:center; padding:48px 7vw; }
    .card { max-width:480px; width:100%; background:var(--paper); border:1px solid var(--rule); border-radius:8px; padding:40px; text-align:center; }
    .status-label { font-family:'JetBrains Mono',monospace; font-size:12px; letter-spacing:0.08em; color:var(--status); text-transform:uppercase; margin-bottom:12px; }
    h1 { font-family:'Instrument Serif',serif; font-weight:400; font-size:clamp(26px,4vw,34px); line-height:1.15; letter-spacing:-0.5px; margin-bottom:16px; }
    .msg { font-size:16px; color:var(--ink2); margin-bottom:28px; }
    .cta { display:inline-block; font-family:'JetBrains Mono',monospace; font-size:13px; letter-spacing:0.06em; text-transform:uppercase; text-decoration:none; color:#fff; background:var(--accent); padding:12px 22px; border-radius:4px; }
    footer { border-top:1px solid var(--rule); padding:24px 7vw; font-family:'JetBrains Mono',monospace; font-size:12px; color:var(--ink3); text-align:center; }
  </style>
</head>
<body>
  <header>
    <a class="brand" href="${BASE_URL}/">
      <svg width="26" height="26" viewBox="0 0 64 64"><rect x="20" y="18" width="24" height="5" rx="2.5" fill="#1D2A2B"/><rect x="19" y="27" width="26" height="5" rx="2.5" fill="#355659"/><rect x="18" y="36" width="28" height="5" rx="2.5" fill="#0F766E"/><rect x="17" y="45" width="30" height="5" rx="2.5" fill="#C45C38"/><circle cx="32" cy="12" r="5" fill="#C45C38"/></svg>
      <span class="wm">Faculty Atlas</span>
    </a>
  </header>
  <main>
    <div class="card">
      <div class="status-label">${isError ? "Action needed" : "Success"}</div>
      <h1>${heading}</h1>
      <div class="msg">${message}</div>
      <a class="cta" href="${BASE_URL}/">Browse Faculty Atlas</a>
    </div>
  </main>
  <footer>Faculty Atlas — open faculty positions across North America, charted.</footer>
</body>
</html>
`;
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
      subject: "Confirm your Faculty Atlas job alert subscription",
      htmlBody: `
        <div style="font-family:Georgia,'Times New Roman',serif;color:#1d2128;max-width:520px;margin:0 auto;padding:32px 24px;">
          <div style="font-size:20px;font-weight:600;letter-spacing:0.02em;margin-bottom:24px;">Faculty Atlas</div>
          <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">A request was received to subscribe this email address to job alerts from Faculty Atlas, notifying you when new faculty postings match your saved search criteria.</p>
          <p style="font-size:15px;line-height:1.6;margin:0 0 24px;">Please confirm this subscription to begin receiving alerts:</p>
          <p style="margin:0 0 24px;">
            <a href="${escHtml(confirmUrl)}" style="display:inline-block;background:#2b3442;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:4px;font-size:14px;letter-spacing:0.02em;">Confirm Subscription</a>
          </p>
          <p style="font-size:13px;line-height:1.6;color:#666666;margin:0 0 8px;">This link will expire in 24 hours. If you did not request this subscription, no further action is required — your address will not be added unless the request above is confirmed.</p>
          <p style="font-size:12px;color:#999999;margin:32px 0 0;border-top:1px solid #e2e2df;padding-top:16px;">Faculty Atlas — A directory of open faculty positions across North American higher education.</p>
        </div>
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
    return html(
      renderPage({
        heading: "Link Expired",
        message: "This confirmation link is invalid or has expired. Please subscribe again from the site.",
        isError: true,
      }),
      { status: 400 }
    );
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

  return html(
    renderPage({
      heading: "Subscription Confirmed",
      message: "You're all set. You'll receive an email whenever new postings match your saved search. You can unsubscribe at any time from the link included in every alert email.",
    })
  );
}

async function handleUnsubscribe(request, env) {
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!token) {
    return html(
      renderPage({ heading: "Invalid Link", message: "This unsubscribe link is missing its token.", isError: true }),
      { status: 400 }
    );
  }

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
        return html(
          renderPage({ heading: "Unsubscribed", message: "You won't receive any further alerts for this search. Sorry to see you go." })
        );
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return html(
    renderPage({ heading: "Invalid Link", message: "This unsubscribe link is invalid or has already been used.", isError: true }),
    { status: 400 }
  );
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
