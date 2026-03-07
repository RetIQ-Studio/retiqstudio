// RetIQ Worker — v4.0-beta
// Cloudflare Worker handling licensing, payments, and regulatory monitoring.

const ALLOWED_ORIGINS = new Set([
  "https://retirementiq.app",
  "https://www.retirementiq.app",
  "https://retiqstudio.com",
  "https://www.retiqstudio.com",
  "https://retiq.pages.dev",
  "https://retiqstudio.pages.dev",
]);

const TRIAL_DAYS = 7;
const MAX_TRIALS_PER_IP = 100;
const MAX_RECOVERY_PER_EMAIL_PER_HOUR = 3;
const APPROVAL_TTL = 72 * 3600; // 72 hours in seconds

// ──────────────────────────────────────────────────────────────
// Regulatory Monitor — source definitions
// ──────────────────────────────────────────────────────────────

const MONITOR_SOURCES = {
  federal_tax: {
    name: "Federal Tax Brackets",
    section: "federal",
    landingUrl:
      "https://www.irs.gov/newsroom/irs-provides-tax-inflation-adjustments-for-tax-year-{year}",
    fallbackUrls: ["https://www.irs.gov/newsroom"],
    publishMonth: 10,
  },
  ss: {
    name: "Social Security",
    section: "ss",
    landingUrl:
      "https://www.ssa.gov/news/press/factsheets/colafacts{year}.htm",
    fallbackUrls: [
      "https://www.ssa.gov/oact/cola/cbb.html",
      "https://www.ssa.gov/oact/cola/piaformula.html",
    ],
    publishMonth: 10,
  },
  irmaa: {
    name: "Medicare IRMAA",
    section: "irmaa",
    landingUrl:
      "https://www.cms.gov/newsroom/fact-sheets/{year}-medicare-parts-b-premiums-and-deductibles",
    fallbackUrls: [
      "https://www.medicare.gov/basics/costs/medicare-costs/part-b-costs",
    ],
    publishMonth: 9,
  },
  aca_fpl: {
    name: "ACA / Federal Poverty Level",
    section: "aca",
    landingUrl: "https://aspe.hhs.gov/{year}-poverty-guidelines",
    fallbackUrls: [
      "https://aspe.hhs.gov/topics/poverty-economic-mobility/poverty-guidelines",
    ],
    publishMonth: 1,
  },
  contribution_limits: {
    name: "Retirement Contribution Limits",
    section: "retirement_accounts",
    landingUrl:
      "https://www.irs.gov/retirement-plans/plan-participant-employee/retirement-topics-401k-and-profit-sharing-plan-contribution-limits",
    fallbackUrls: [],
    publishMonth: 11,
  },
};

// ──────────────────────────────────────────────────────────────
// Claude extraction prompts (one per source)
// ──────────────────────────────────────────────────────────────

function getExtractionPrompt(sourceId, targetYear) {
  const prompts = {
    federal_tax: `You are a tax data extraction specialist. Extract the exact federal income tax bracket thresholds and standard deduction amounts for tax year ${targetYear} from the provided IRS text.
Return a JSON object with exactly this structure:
{
  "brackets_mfj": [
    { "min": 0, "max": <number>, "rate": <decimal> },
    ...7 brackets total, last bracket max must be null (representing infinity)
  ],
  "brackets_single": [ ...same 7-bracket structure... ],
  "std_deduction_mfj": <number>,
  "std_deduction_single": <number>,
  "senior_std_deduction_mfj": <number>,
  "senior_std_deduction_single": <number>,
  "cg_0_threshold_single": <number>,
  "cg_0_threshold_mfj": <number>,
  "cg_15_threshold_single": <number>,
  "cg_15_threshold_mfj": <number>,
  "niit_threshold_single": 200000,
  "niit_threshold_mfj": 250000,
  "niit_rate": 0.038
}
Rules:
- All dollar amounts are integers (no cents for thresholds).
- Tax rates are decimals (0.10 not 10).
- The last bracket in each array must have "max": null.
- NIIT thresholds are NOT inflation-adjusted (statutory $200K/$250K). Always use the values shown above.
- If you cannot find tax year ${targetYear} data in the text, respond with: {"no_update": true}
- Return ONLY valid JSON. No markdown, no explanation.`,

    ss: `You are a Social Security data extraction specialist. Extract the exact Social Security figures for ${targetYear} from the provided SSA text.
Return a JSON object with exactly this structure:
{
  "bend_point_1": <number>,
  "bend_point_2": <number>,
  "wage_base": <number>,
  "earnings_test_under_fra": <number>,
  "earnings_test_fra_year": <number>,
  "earnings_test_under_fra_rate": 0.50,
  "earnings_test_fra_year_rate": 0.3333333333333333,
  "base_year": ${targetYear},
  "growth_rate": 0.03
}
Rules:
- Bend points are MONTHLY dollar amounts from the PIA formula.
- Wage base is the annual contribution and benefit base (OASDI tax cap).
- The earnings test rates are statutory (0.50 and 1/3) — always use the values shown.
- growth_rate is always 0.03 (model assumption, not extracted).
- If you cannot find ${targetYear} data, respond with: {"no_update": true}
- Return ONLY valid JSON.`,

    irmaa: `You are a Medicare premium data extraction specialist. Extract the ${targetYear} Medicare Part B and Part D IRMAA premium amounts from the provided CMS text.
Return a JSON object with exactly this structure:
{
  "brackets_mfj": [
    { "magi": 0, "partB": <annual_amount>, "partD": <annual_amount> },
    ...6 tiers total
  ],
  "brackets_single": [ ...same 6-tier structure... ]
}
Rules:
- CMS announces MONTHLY premiums. You MUST multiply by 12 to get annual amounts.
- The first tier (magi: 0) always has partD: 0 (no surcharge at base level).
- MFJ thresholds are typically 2x single thresholds (except the top tier).
- All amounts should be numbers with up to 2 decimal places.
- If you cannot find ${targetYear} data, respond with: {"no_update": true}
- Return ONLY valid JSON.`,

    aca_fpl: `You are a Federal Poverty Level data extraction specialist. Extract the ${targetYear} HHS poverty guidelines from the provided text.
Return a JSON object:
{
  "fpl_base": { "1": <number>, "2": <number>, "3": <number>, "4": <number> },
  "fpl_additional": <number>
}
Rules:
- Use the 48 contiguous states + DC guidelines (not Alaska or Hawaii).
- fpl_base contains the poverty guideline for household sizes 1 through 4.
- fpl_additional is the per-person increment for each additional household member beyond the table.
- If you cannot find ${targetYear} data, respond with: {"no_update": true}
- Return ONLY valid JSON.`,

    contribution_limits: `You are a retirement plan contribution limit extraction specialist. Extract the ${targetYear} 401(k) and IRA limits from the provided IRS text.
Return a JSON object:
{
  "contribution_401k": <number>,
  "contribution_ira": <number>,
  "catchup_401k_standard": <number>,
  "catchup_401k_secure2": <number>,
  "catchup_ira": <number>,
  "qcd_limit": <number>
}
Rules:
- contribution_401k is the elective deferral limit (402(g)).
- catchup_401k_standard is for ages 50-59 and 64+ (standard catch-up).
- catchup_401k_secure2 is the SECURE 2.0 enhanced catch-up for ages 60-63 only.
- catchup_ira is the IRA catch-up for age 50+.
- qcd_limit is the qualified charitable distribution annual limit.
- If you cannot find ${targetYear} data, respond with: {"no_update": true}
- Return ONLY valid JSON.`,
  };
  return prompts[sourceId] || null;
}

// ──────────────────────────────────────────────────────────────
// Utility helpers
// ──────────────────────────────────────────────────────────────

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return {};
  const allowOrigin = ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://retirementiq.app";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Secret",
  };
}

function jsonResponse(obj, request, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(request) },
  });
}

async function hmacSign(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function hmacVerify(secret, message, signature) {
  const expected = await hmacSign(secret, message);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

function makeLicense() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const chunk = (n) =>
    Array.from(
      { length: n },
      () => alphabet[Math.floor(Math.random() * alphabet.length)]
    ).join("");
  return `RTIQ-${chunk(4)}-${chunk(4)}-${chunk(4)}`;
}

async function indexLicenseByEmail(env, email, license) {
  if (!email) return;
  const emailKey = `email:${email}`;
  const existing = await env.LICENSES.get(emailKey);
  const list = existing ? JSON.parse(existing) : [];
  list.push(license);
  await env.LICENSES.put(emailKey, JSON.stringify(list));
}

function randomToken(len = 16) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function stripToText(html) {
  let text = html;
  text = text.replace(
    /<(script|style|nav|footer|header)[^>]*>[\s\S]*?<\/\1>/gi,
    " "
  );
  text = text.replace(/<[^>]+>/g, " ");
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  return text.length > 30000 ? text.slice(0, 30000) : text;
}

// ──────────────────────────────────────────────────────────────
// Claude API + page fetching
// ──────────────────────────────────────────────────────────────

async function callClaudeAPI(env, systemPrompt, userContent) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }
  const result = await response.json();
  return result.content[0].text;
}

async function fetchSourcePage(url) {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "RetIQ-Monitor/1.0 (regulatory-data-check)" },
    });
    if (response.status === 404) return { status: "not_found", url };
    if (!response.ok)
      return { status: "http_error", code: response.status, url };
    const html = await response.text();
    return { status: "ok", html, url };
  } catch (err) {
    return { status: "fetch_error", error: String(err), url };
  }
}

async function resolveSourceUrl(source, targetYear) {
  const primaryUrl = source.landingUrl.replace(/\{year\}/g, targetYear);
  try {
    const head = await fetch(primaryUrl, {
      method: "HEAD",
      headers: { "User-Agent": "RetIQ-Monitor/1.0" },
    });
    if (head.ok) return primaryUrl;
  } catch {}
  for (const fb of source.fallbackUrls) {
    const fbUrl = fb.replace(/\{year\}/g, targetYear);
    try {
      const head = await fetch(fbUrl, {
        method: "HEAD",
        headers: { "User-Agent": "RetIQ-Monitor/1.0" },
      });
      if (head.ok) return fbUrl;
    } catch {}
  }
  return null;
}

async function hashContent(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

async function extractValuesWithClaude(env, sourceId, pageText, targetYear) {
  const systemPrompt = getExtractionPrompt(sourceId, targetYear);
  if (!systemPrompt)
    throw new Error(`No extraction prompt for source: ${sourceId}`);
  const userContent = `Here is the text from a government source page. Extract the tax year ${targetYear} data:\n${pageText}`;
  const responseText = await callClaudeAPI(env, systemPrompt, userContent);
  let jsonStr = responseText.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr
      .replace(/^```(?:json)?\n?/, "")
      .replace(/\n?```$/, "");
  }
  const parsed = JSON.parse(jsonStr);
  if (parsed.no_update) return { success: false, reason: "no_update" };
  return { success: true, data: parsed };
}

// ──────────────────────────────────────────────────────────────
// Email (Resend)
// ──────────────────────────────────────────────────────────────

async function sendEmail(env, to, subject, text, html) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.RESEND_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "RetirementIQ <noreply@retirementiq.app>",
      to: [to],
      subject,
      text,
      html,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.log("Resend error:", JSON.stringify(err));
    return false;
  }
  return true;
}

// ──────────────────────────────────────────────────────────────
// Worker entry point
// ──────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request) });
    }

    // Stripe
    if (url.pathname === "/create-checkout-session" && request.method === "POST")
      return createCheckoutSession(request, env);
    if (url.pathname === "/stripe-webhook" && request.method === "POST")
      return handleWebhook(request, env);
    if (url.pathname === "/verify-session" && request.method === "GET")
      return verifySession(url.searchParams.get("session_id"), request, env);
    if (url.pathname === "/redeem-session" && request.method === "GET")
      return redeemSession(url.searchParams.get("session_id"), request, env);

    // Licensing
    if (url.pathname === "/validate-license" && request.method === "GET")
      return validateLicense(url.searchParams.get("license"), request, env);
    if (url.pathname === "/start-trial" && request.method === "POST")
      return startTrial(request, env);
    if (url.pathname === "/verify-token" && request.method === "POST")
      return verifyToken(request, env);
    if (url.pathname === "/recover-license" && request.method === "POST")
      return recoverLicense(request, env);
    if (url.pathname === "/reset-trial-ip" && request.method === "POST")
      return resetTrialIp(request, env);

    // Regulatory data (v4.0)
    if (url.pathname === "/regs-current" && request.method === "GET")
      return getRegsCurrent(request, env);
    if (url.pathname === "/regs-current" && request.method === "PUT")
      return putRegsCurrent(request, env);
    if (url.pathname === "/regs-approve" && request.method === "GET")
      return handleRegsApprove(url, request, env);
    if (url.pathname === "/regs-monitor-trigger" && request.method === "POST")
      return triggerMonitor(request, env);
    if (url.pathname === "/regs-monitor-status" && request.method === "GET")
      return getMonitorStatus(request, env);
    if (url.pathname === "/regs-proposed" && request.method === "GET")
      return getRegsProposed(request, env);
    if (url.pathname === "/regs-proposed" && request.method === "DELETE")
      return deleteRegsProposed(request, env);

    return new Response("Not found", {
      status: 404,
      headers: corsHeaders(request),
    });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runMonitoringPipeline(env));
  },
};

// ──────────────────────────────────────────────────────────────
// Trial system
// ──────────────────────────────────────────────────────────────

async function startTrial(request, env) {
  if (!env.TRIAL_SECRET) {
    return jsonResponse({ error: "trial_not_configured" }, request, 500);
  }
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const kvKey = `trial_ip:${ip}`;
  const existing = await env.LICENSES.get(kvKey);
  const count = existing ? parseInt(existing, 10) : 0;
  if (count >= MAX_TRIALS_PER_IP) {
    return jsonResponse(
      {
        error: "trial_limit_reached",
        message:
          "Trial limit reached for this network. Please purchase RetIQ Pro to continue.",
      },
      request,
      429
    );
  }
  await env.LICENSES.put(kvKey, String(count + 1), {
    expirationTtl: 60 * 60 * 24 * 365,
  });
  const issuedAt = Date.now();
  const payload = btoa(JSON.stringify({ issuedAt, ip }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const sig = await hmacSign(env.TRIAL_SECRET, payload);
  const token = `${payload}.${sig}`;
  return jsonResponse(
    { token, issuedAt, expiresAt: issuedAt + TRIAL_DAYS * 86400 * 1000 },
    request
  );
}

async function verifyToken(request, env) {
  if (!env.TRIAL_SECRET) {
    return jsonResponse(
      { valid: false, reason: "trial_not_configured" },
      request,
      500
    );
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      { valid: false, reason: "bad_request" },
      request,
      400
    );
  }
  const token = body?.token;
  if (!token || typeof token !== "string") {
    return jsonResponse(
      { valid: false, reason: "missing_token" },
      request,
      400
    );
  }
  const parts = token.split(".");
  if (parts.length !== 2) {
    return jsonResponse(
      { valid: false, reason: "malformed_token" },
      request,
      400
    );
  }
  const [payload, sig] = parts;
  const ok = await hmacVerify(env.TRIAL_SECRET, payload, sig);
  if (!ok) {
    return jsonResponse(
      { valid: false, reason: "invalid_signature" },
      request
    );
  }
  let data;
  try {
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    data = JSON.parse(atob(b64));
  } catch {
    return jsonResponse(
      { valid: false, reason: "malformed_payload" },
      request,
      400
    );
  }
  const elapsed = Date.now() - data.issuedAt;
  const limitMs = TRIAL_DAYS * 86400 * 1000;
  const daysLeft = Math.max(0, Math.ceil((limitMs - elapsed) / 86400 / 1000));
  if (elapsed > limitMs) {
    return jsonResponse(
      { valid: false, reason: "expired", daysLeft: 0 },
      request
    );
  }
  return jsonResponse(
    { valid: true, daysLeft, issuedAt: data.issuedAt },
    request
  );
}

// ──────────────────────────────────────────────────────────────
// Stripe checkout + webhooks
// ──────────────────────────────────────────────────────────────

async function createCheckoutSession(request, env) {
  try {
    let useEarlyPrice = false;
    try {
      const body = await request.clone().json();
      const token = body?.token;
      if (token && env.TRIAL_SECRET && env.STRIPE_PRICE_ID_EARLY) {
        const parts = token.split(".");
        if (parts.length === 2) {
          const [payload, sig] = parts;
          const ok = await hmacVerify(env.TRIAL_SECRET, payload, sig);
          if (ok) {
            const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
            const data = JSON.parse(atob(b64));
            const elapsed = Date.now() - data.issuedAt;
            if (elapsed <= TRIAL_DAYS * 86400 * 1000) {
              useEarlyPrice = true;
            }
          }
        }
      }
    } catch {}

    const priceId =
      useEarlyPrice && env.STRIPE_PRICE_ID_EARLY
        ? env.STRIPE_PRICE_ID_EARLY
        : env.STRIPE_PRICE_ID;

    const stripeBody = new URLSearchParams({
      mode: "payment",
      allow_promotion_codes: "true",
      success_url:
        "https://retirementiq.app/app/success.html?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://retirementiq.app/",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
    });

    const stripeRes = await fetch(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: stripeBody,
      }
    );
    const data = await stripeRes.json();
    if (!stripeRes.ok) {
      return jsonResponse(
        { error: "stripe_error", detail: data?.error?.message ?? data },
        request,
        500
      );
    }
    return jsonResponse({ url: data.url }, request);
  } catch (err) {
    return jsonResponse(
      { error: "internal_error", detail: String(err) },
      request,
      500
    );
  }
}

async function handleWebhook(request, env) {
  const rawBody = await request.text();
  const sig = request.headers.get("stripe-signature");

  const verify = await fetch(
    "https://api.stripe.com/v1/webhook_endpoints/signature_verify",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        payload: rawBody,
        sig_header: sig ?? "",
        secret: env.STRIPE_WEBHOOK_SECRET,
      }),
    }
  );
  if (!verify.ok) return new Response("Webhook signature invalid", { status: 400 });

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const existing = await env.LICENSES.get(`sess:${session.id}`);
    if (existing) {
      console.log("License already issued for session:", session.id);
      return new Response("ok");
    }
    const license = makeLicense();
    const email = session.customer_details?.email?.toLowerCase() ?? null;
    const record = {
      status: "active",
      created_at: new Date().toISOString(),
      session_id: session.id,
      customer_email: email,
    };
    await env.LICENSES.put(`lic:${license}`, JSON.stringify(record));
    await env.LICENSES.put(`sess:${session.id}`, license);
    await indexLicenseByEmail(env, email, license);
    console.log("Issued license:", license);
  }
  return new Response("ok");
}

async function verifySession(sessionId, request, env) {
  if (!sessionId) {
    return jsonResponse(
      { paid: false, error: "missing_session_id" },
      request,
      400
    );
  }
  const res = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${sessionId}`,
    { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } }
  );
  const session = await res.json();
  if (!res.ok) {
    return jsonResponse(
      {
        paid: false,
        error: "stripe_error",
        detail: session?.error?.message ?? session,
      },
      request,
      500
    );
  }
  return jsonResponse({ paid: session.payment_status === "paid" }, request);
}

async function redeemSession(sessionId, request, env) {
  if (!sessionId) {
    return jsonResponse({ error: "missing_session_id" }, request, 400);
  }
  const existing = await env.LICENSES.get(`sess:${sessionId}`);
  if (existing) return jsonResponse({ license: existing }, request);

  const res = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${sessionId}`,
    { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } }
  );
  const session = await res.json();
  if (!res.ok) {
    return jsonResponse(
      {
        error: "stripe_error",
        detail: session?.error?.message ?? session,
      },
      request,
      500
    );
  }
  if (session.payment_status !== "paid") {
    return jsonResponse({ error: "not_paid" }, request, 402);
  }
  const license = makeLicense();
  const email = session.customer_details?.email?.toLowerCase() ?? null;
  const record = {
    status: "active",
    created_at: new Date().toISOString(),
    session_id: sessionId,
    customer_email: email,
    issued_via: "redeem-session",
  };
  await env.LICENSES.put(`lic:${license}`, JSON.stringify(record));
  await env.LICENSES.put(`sess:${sessionId}`, license);
  await indexLicenseByEmail(env, email, license);
  return jsonResponse({ license }, request);
}

// ──────────────────────────────────────────────────────────────
// License validation + recovery
// ──────────────────────────────────────────────────────────────

async function validateLicense(license, request, env) {
  if (!license) {
    return jsonResponse(
      { valid: false, reason: "missing_license" },
      request,
      400
    );
  }
  const normalized = license.trim().toUpperCase();
  const recordRaw = await env.LICENSES.get(`lic:${normalized}`);
  if (!recordRaw) {
    return jsonResponse(
      { valid: false, reason: "not_found" },
      request,
      404
    );
  }
  let record;
  try {
    record = JSON.parse(recordRaw);
  } catch {
    return jsonResponse(
      { valid: false, reason: "corrupt_record" },
      request,
      500
    );
  }
  if (record.status !== "active") {
    return jsonResponse(
      { valid: false, reason: record.status },
      request,
      403
    );
  }
  return jsonResponse({ valid: true }, request);
}

async function recoverLicense(request, env) {
  if (!env.RESEND_API_KEY) {
    return jsonResponse({ error: "recovery_not_configured" }, request, 500);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "bad_request" }, request, 400);
  }
  const email = body?.email?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return jsonResponse({ error: "invalid_email" }, request, 400);
  }

  // Rate limiting
  const rateKey = `recovery_rate:${email}`;
  const rateRaw = await env.LICENSES.get(rateKey);
  const rateCount = rateRaw ? parseInt(rateRaw, 10) : 0;
  if (rateCount >= MAX_RECOVERY_PER_EMAIL_PER_HOUR) {
    return jsonResponse(
      {
        error: "rate_limited",
        message: "Too many recovery requests. Please try again in an hour.",
      },
      request,
      429
    );
  }
  await env.LICENSES.put(rateKey, String(rateCount + 1), {
    expirationTtl: 3600,
  });

  // Find active licenses for this email
  const emailKey = `email:${email}`;
  const licensesRaw = await env.LICENSES.get(emailKey);
  const licenses = licensesRaw ? JSON.parse(licensesRaw) : [];
  const activeLicenses = [];
  for (const lic of licenses) {
    const recordRaw = await env.LICENSES.get(`lic:${lic}`);
    if (recordRaw) {
      try {
        const record = JSON.parse(recordRaw);
        if (record.status === "active") activeLicenses.push(lic);
      } catch {}
    }
  }

  // Always return generic message (don't leak whether email exists)
  const genericMessage =
    "If a license exists for this email address, it has been sent. Please check your inbox and spam folder.";
  if (activeLicenses.length === 0) {
    console.log("Recovery requested for unknown email:", email);
    return jsonResponse({ ok: true, message: genericMessage }, request);
  }

  const plural = activeLicenses.length > 1 ? "s" : "";
  const licenseDisplay = activeLicenses.map((l) => "  " + l).join("\n");
  const licenseHtml = activeLicenses
    .map(
      (l) =>
        '<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:14px 18px;margin:12px 0;font-family:monospace;font-size:18px;font-weight:bold;color:#0369a1;letter-spacing:1px;text-align:center;">' +
        l +
        "</div>"
    )
    .join("");

  const emailPayload = {
    from: "RetirementIQ <noreply@retirementiq.app>",
    to: [email],
    subject: "Your RetirementIQ License Key",
    text: [
      "Hello,",
      "",
      "You requested a license key recovery for RetirementIQ.",
      "",
      `Your active license key${plural}:`,
      "",
      licenseDisplay,
      "",
      "To activate: open RetirementIQ, click Activate in the header, and enter your license key.",
      "",
      "If you did not request this, you can safely ignore this email.",
      "",
      "-- RetirementIQ",
      "https://retirementiq.app",
    ].join("\n"),
    html: [
      '<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;">',
      '<h2 style="color:#0f172a;margin-bottom:4px;">RetirementIQ</h2>',
      '<p style="color:#64748b;font-size:14px;margin-top:0;">License Key Recovery</p>',
      '<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;">',
      `<p style="color:#334155;line-height:1.6;">You requested a license key recovery. Your active license key${plural}:</p>`,
      licenseHtml,
      '<p style="color:#334155;line-height:1.6;">To activate: open <a href="https://retirementiq.app/app/" style="color:#2563eb;">RetirementIQ</a>, click <strong>Activate</strong> in the header, and enter your license key.</p>',
      '<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;">',
      '<p style="color:#94a3b8;font-size:12px;">If you did not request this, you can safely ignore this email.</p>',
      "</div>",
    ].join(""),
  };

  try {
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.RESEND_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailPayload),
    });
    if (!resendRes.ok) {
      const errData = await resendRes.json();
      console.log("Resend error:", JSON.stringify(errData));
      return jsonResponse({ error: "email_send_failed" }, request, 500);
    }
    console.log(
      "Recovery email sent to:",
      email,
      "licenses:",
      activeLicenses.length
    );
    return jsonResponse({ ok: true, message: genericMessage }, request);
  } catch (err) {
    console.log("Resend fetch error:", String(err));
    return jsonResponse({ error: "email_send_failed" }, request, 500);
  }
}

// ──────────────────────────────────────────────────────────────
// Admin — trial IP reset
// ──────────────────────────────────────────────────────────────

async function resetTrialIp(request, env) {
  const authHeader = request.headers.get("X-Admin-Secret");
  if (!authHeader || authHeader !== env.ADMIN_SECRET) {
    return jsonResponse({ error: "unauthorized" }, request, 401);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "bad_request" }, request, 400);
  }
  const ip = body?.ip;
  if (!ip) return jsonResponse({ error: "missing_ip" }, request, 400);
  await env.LICENSES.delete(`trial_ip:${ip}`);
  return jsonResponse({ ok: true, reset: ip }, request);
}

// ──────────────────────────────────────────────────────────────
// Regulatory data — CRUD
// ──────────────────────────────────────────────────────────────

async function getRegsCurrent(request, env) {
  const data = await env.REGS.get("current", { type: "text" });
  if (!data) {
    return jsonResponse({ error: "no_regs_data" }, request, 404);
  }
  return new Response(data, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300", // 5-minute edge cache
      ...corsHeaders(request),
    },
  });
}

async function putRegsCurrent(request, env) {
  const authHeader = request.headers.get("X-Admin-Secret");
  if (!authHeader || authHeader !== env.ADMIN_SECRET) {
    return jsonResponse({ error: "unauthorized" }, request, 401);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, request, 400);
  }
  if (!body.version) {
    return jsonResponse({ error: "missing_version" }, request, 400);
  }
  if (
    !body.federal &&
    !body.ss &&
    !body.irmaa &&
    !body.aca &&
    !body.retirement_accounts
  ) {
    return jsonResponse({ error: "missing_data_sections" }, request, 400);
  }
  await env.REGS.put("current", JSON.stringify(body));
  console.log("REGS updated to version:", body.version);
  return jsonResponse({ ok: true, version: body.version }, request);
}

// ──────────────────────────────────────────────────────────────
// Sanity checks — validate extracted values before approval
// ──────────────────────────────────────────────────────────────

const EXPECTED_FEDERAL_RATES = [0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37];

function runSanityChecks(currentRegs, proposedRegs) {
  const failures = [];
  const fail = (rule, msg) => failures.push({ rule, message: msg });

  // Version must be a 4-digit year, greater than current
  const pVer = parseInt(proposedRegs.version, 10);
  const cVer = parseInt(currentRegs.version, 10);
  if (isNaN(pVer) || String(pVer).length !== 4) {
    fail(
      "version",
      `Version must be a 4-digit year, got: ${proposedRegs.version}`
    );
  } else if (pVer <= cVer) {
    fail(
      "version",
      `Proposed version ${pVer} must be > current version ${cVer}`
    );
  }

  // Federal tax brackets — structure + rates
  for (const key of ["brackets_mfj", "brackets_single"]) {
    const brackets = proposedRegs.federal?.[key];
    if (!Array.isArray(brackets) || brackets.length !== 7) {
      fail(
        "bracket_structure",
        `federal.${key} must have exactly 7 brackets, got ${brackets?.length ?? "missing"}`
      );
      continue;
    }
    const rates = brackets.map((b) => b.rate);
    for (let i = 0; i < EXPECTED_FEDERAL_RATES.length; i++) {
      if (Math.abs(rates[i] - EXPECTED_FEDERAL_RATES[i]) > 0.001) {
        fail(
          "bracket_rates",
          `federal.${key}[${i}].rate expected ${EXPECTED_FEDERAL_RATES[i]}, got ${rates[i]}`
        );
      }
    }
    for (let i = 1; i < brackets.length; i++) {
      if (brackets[i].min !== brackets[i - 1].max) {
        fail(
          "bracket_ordering",
          `federal.${key}[${i}].min (${brackets[i].min}) ≠ [${i - 1}].max (${brackets[i - 1].max})`
        );
      }
    }
    if (brackets[6].max !== null) {
      fail(
        "bracket_structure",
        `federal.${key}[6].max must be null (Infinity), got ${brackets[6].max}`
      );
    }
  }

  // IRMAA brackets — structure + ordering
  for (const key of ["brackets_mfj", "brackets_single"]) {
    const brackets = proposedRegs.irmaa?.[key];
    if (!Array.isArray(brackets) || brackets.length !== 6) {
      fail(
        "bracket_structure",
        `irmaa.${key} must have 6 tiers, got ${brackets?.length ?? "missing"}`
      );
      continue;
    }
    for (let i = 1; i < brackets.length; i++) {
      if (brackets[i].magi < brackets[i - 1].magi) {
        fail(
          "bracket_ordering",
          `irmaa.${key}[${i}].magi (${brackets[i].magi}) < [${i - 1}].magi (${brackets[i - 1].magi})`
        );
      }
    }
    if (brackets[0].partD !== 0) {
      fail(
        "bracket_structure",
        `irmaa.${key}[0].partD must be 0, got ${brackets[0].partD}`
      );
    }
  }

  // ACA tiers
  for (const key of ["pct_enhanced", "pct_original"]) {
    const tiers = proposedRegs.aca?.[key];
    if (tiers && (!Array.isArray(tiers) || tiers.length !== 6)) {
      fail(
        "bracket_structure",
        `aca.${key} must have 6 tiers, got ${tiers?.length ?? "missing"}`
      );
    }
  }

  // Statutory constants (must not change)
  if (proposedRegs.federal) {
    if (proposedRegs.federal.niit_threshold_single !== 200000) {
      fail(
        "statutory",
        `NIIT single threshold must be 200000, got ${proposedRegs.federal.niit_threshold_single}`
      );
    }
    if (proposedRegs.federal.niit_threshold_mfj !== 250000) {
      fail(
        "statutory",
        `NIIT MFJ threshold must be 250000, got ${proposedRegs.federal.niit_threshold_mfj}`
      );
    }
    if (Math.abs(proposedRegs.federal.niit_rate - 0.038) > 0.0001) {
      fail(
        "statutory",
        `NIIT rate must be 0.038, got ${proposedRegs.federal.niit_rate}`
      );
    }
  }
  if (proposedRegs.ss) {
    if (
      Math.abs(proposedRegs.ss.earnings_test_under_fra_rate - 0.5) > 0.001
    ) {
      fail(
        "statutory",
        `SS under-FRA test rate must be 0.50, got ${proposedRegs.ss.earnings_test_under_fra_rate}`
      );
    }
    if (
      Math.abs(proposedRegs.ss.earnings_test_fra_year_rate - 1 / 3) > 0.001
    ) {
      fail(
        "statutory",
        `SS FRA-year test rate must be 1/3, got ${proposedRegs.ss.earnings_test_fra_year_rate}`
      );
    }
  }

  // Cross-field: MFJ/Single std deduction ratio ≈ 2.0
  if (proposedRegs.federal) {
    const ratio =
      proposedRegs.federal.std_deduction_mfj /
      proposedRegs.federal.std_deduction_single;
    if (ratio < 1.8 || ratio > 2.2) {
      fail(
        "cross_field",
        `MFJ/Single std deduction ratio ${ratio.toFixed(2)} should be ~2.0`
      );
    }
  }
  if (proposedRegs.ss) {
    if (
      proposedRegs.ss.earnings_test_fra_year <=
      proposedRegs.ss.earnings_test_under_fra
    ) {
      fail(
        "cross_field",
        `SS fra_year limit (${proposedRegs.ss.earnings_test_fra_year}) must > under_fra (${proposedRegs.ss.earnings_test_under_fra})`
      );
    }
  }

  // Range checks: no scalar should change more than ±30%
  const scalarChecks = [
    ["federal", "std_deduction_mfj"],
    ["federal", "std_deduction_single"],
    ["federal", "senior_std_deduction_mfj"],
    ["federal", "senior_std_deduction_single"],
    ["federal", "cg_0_threshold_single"],
    ["federal", "cg_0_threshold_mfj"],
    ["federal", "cg_15_threshold_single"],
    ["federal", "cg_15_threshold_mfj"],
    ["ss", "bend_point_1"],
    ["ss", "bend_point_2"],
    ["ss", "wage_base"],
    ["ss", "earnings_test_under_fra"],
    ["ss", "earnings_test_fra_year"],
    ["retirement_accounts", "contribution_401k"],
    ["retirement_accounts", "contribution_ira"],
    ["retirement_accounts", "catchup_401k_standard"],
    ["retirement_accounts", "catchup_401k_secure2"],
    ["retirement_accounts", "catchup_ira"],
    ["retirement_accounts", "qcd_limit"],
  ];
  for (const [section, field] of scalarChecks) {
    const cVal = currentRegs[section]?.[field];
    const pVal = proposedRegs[section]?.[field];
    if (typeof cVal === "number" && typeof pVal === "number" && cVal > 0) {
      const pctChange = Math.abs(pVal - cVal) / cVal;
      if (pctChange > 0.3) {
        fail(
          "range",
          `${section}.${field}: ${cVal} → ${pVal} (${(pctChange * 100).toFixed(1)}% change exceeds ±30%)`
        );
      }
    }
  }

  // Presence: all sections that exist in current must exist in proposed
  for (const section of [
    "federal",
    "ss",
    "irmaa",
    "aca",
    "retirement_accounts",
  ]) {
    if (currentRegs[section] && !proposedRegs[section]) {
      fail("presence", `Missing section: ${section}`);
    }
  }

  return { passed: failures.length === 0, failures };
}

// ──────────────────────────────────────────────────────────────
// Approval workflow — email + one-click approve page
// ──────────────────────────────────────────────────────────────

async function generateApprovalUrl(env, approvalId, timestamp) {
  const message = `approve:${approvalId}:${timestamp}`;
  const sig = await hmacSign(env.ADMIN_SECRET, message);
  return `https://retiq-worker.bortvin.workers.dev/regs-approve?id=${approvalId}&t=${timestamp}&sig=${sig}`;
}

function buildDiff(currentRegs, proposedRegs) {
  const changes = [];

  function compareSection(section, cObj, pObj, path) {
    if (!cObj || !pObj) return;
    for (const key of Object.keys(pObj)) {
      const cVal = cObj[key];
      const pVal = pObj[key];
      const fullKey = `${path}.${key}`;

      if (Array.isArray(pVal)) {
        if (!Array.isArray(cVal) || cVal.length !== pVal.length) {
          changes.push({
            key: fullKey,
            from: JSON.stringify(cVal),
            to: JSON.stringify(pVal),
            pctChange: null,
          });
          continue;
        }
        for (let i = 0; i < pVal.length; i++) {
          if (typeof pVal[i] === "object" && pVal[i] !== null) {
            for (const subKey of Object.keys(pVal[i])) {
              const cv = cVal[i]?.[subKey];
              const pv = pVal[i][subKey];
              if (cv !== pv) {
                const pct =
                  typeof cv === "number" &&
                  typeof pv === "number" &&
                  cv !== 0
                    ? (((pv - cv) / Math.abs(cv)) * 100).toFixed(1) + "%"
                    : null;
                changes.push({
                  key: `${fullKey}[${i}].${subKey}`,
                  from: cv,
                  to: pv,
                  pctChange: pct,
                });
              }
            }
          }
        }
      } else if (typeof pVal === "object" && pVal !== null) {
        compareSection(section, cVal, pVal, fullKey);
      } else if (cVal !== pVal) {
        const pct =
          typeof cVal === "number" &&
          typeof pVal === "number" &&
          cVal !== 0
            ? (((pVal - cVal) / Math.abs(cVal)) * 100).toFixed(1) + "%"
            : null;
        changes.push({ key: fullKey, from: cVal, to: pVal, pctChange: pct });
      }
    }
  }

  for (const section of [
    "federal",
    "ss",
    "irmaa",
    "aca",
    "retirement_accounts",
  ]) {
    compareSection(
      section,
      currentRegs[section],
      proposedRegs[section],
      section
    );
  }
  for (const key of ["version", "effectiveDate", "publishedDate"]) {
    if (currentRegs[key] !== proposedRegs[key]) {
      changes.push({
        key,
        from: currentRegs[key],
        to: proposedRegs[key],
        pctChange: null,
      });
    }
  }
  return changes;
}

async function sendApprovalEmail(
  env,
  currentRegs,
  proposedRegs,
  approveUrl,
  sanityResult
) {
  const diff = buildDiff(currentRegs, proposedRegs);

  const diffRows = diff
    .map((d) => {
      const pctBadge = d.pctChange
        ? ` <span style="color:#6b7280;font-size:12px;">(${d.pctChange})</span>`
        : "";
      return `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-family:monospace;font-size:13px;">${d.key}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;color:#dc2626;text-align:right;">${d.from ?? "\u2014"}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;color:#16a34a;text-align:right;">${d.to ?? "\u2014"}${pctBadge}</td>
    </tr>`;
    })
    .join("");

  const sanityBadge = sanityResult.passed
    ? '<span style="background:#dcfce7;color:#166534;padding:4px 10px;border-radius:4px;font-weight:bold;">\u2713 All sanity checks passed</span>'
    : `<span style="background:#fef2f2;color:#991b1b;padding:4px 10px;border-radius:4px;font-weight:bold;">\u26A0 ${sanityResult.failures.length} sanity check(s) failed</span>`;

  const failureList =
    sanityResult.failures.length > 0
      ? `<div style="margin:12px 0;padding:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;">
        <p style="margin:0 0 8px;font-weight:bold;color:#991b1b;">Sanity Check Failures:</p>
        <ul style="margin:0;padding-left:20px;color:#991b1b;">${sanityResult.failures
          .map(
            (f) =>
              `<li style="margin:4px 0;"><strong>[${f.rule}]</strong> ${f.message}</li>`
          )
          .join("")}</ul>
      </div>`
      : "";

  const changedSources = new Set(diff.map((d) => d.key.split(".")[0]));
  const sourceList = [...changedSources]
    .map((s) => {
      const src = Object.values(MONITOR_SOURCES).find(
        (m) => m.section === s
      );
      return src ? src.name : s;
    })
    .join(", ");

  const html = `<div style="font-family:system-ui,sans-serif;max-width:640px;margin:0 auto;padding:24px;">
    <h2 style="color:#0f172a;margin-bottom:4px;">RetIQ Regulatory Update</h2>
    <p style="color:#64748b;font-size:14px;margin-top:0;">Version ${currentRegs.version} \u2192 ${proposedRegs.version}</p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;">
    <p style="color:#334155;">A regulatory update has been detected and extracted. Changed sources: <strong>${sourceList || "None"}</strong></p>
    ${sanityBadge}
    ${failureList}
    <h3 style="color:#0f172a;margin-top:24px;">Changes (${diff.length} fields)</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr style="background:#f8fafc;">
        <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #e5e7eb;">Field</th>
        <th style="padding:8px 10px;text-align:right;border-bottom:2px solid #e5e7eb;">Current</th>
        <th style="padding:8px 10px;text-align:right;border-bottom:2px solid #e5e7eb;">Proposed</th>
      </tr>
      ${diffRows}
    </table>
    <div style="text-align:center;margin:30px 0;">
      <a href="${approveUrl}" style="display:inline-block;background:#2563eb;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px;">
        Approve and Publish
      </a>
    </div>
    <p style="color:#94a3b8;font-size:12px;text-align:center;">
      This link expires in 72 hours and can only be used once.
    </p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;">
    <p style="color:#94a3b8;font-size:12px;">RetIQ Monitoring Pipeline v4.0-beta</p>
  </div>`;

  const text =
    `RetIQ Regulatory Update: ${currentRegs.version} \u2192 ${proposedRegs.version}\nChanged sources: ${sourceList}\nSanity checks: ${sanityResult.passed ? "PASSED" : `FAILED (${sanityResult.failures.length} issues)`}\nChanges:\n` +
    diff
      .map(
        (d) =>
          `  ${d.key}: ${d.from} \u2192 ${d.to}${d.pctChange ? ` (${d.pctChange})` : ""}`
      )
      .join("\n") +
    `\nApprove: ${approveUrl}\nThis link expires in 72 hours.`;

  return sendEmail(
    env,
    env.ADMIN_EMAIL,
    `RetIQ REGS Update: ${proposedRegs.version} ready for approval`,
    text,
    html
  );
}

async function sendAlertEmail(env, subject, details) {
  const html = `<div style="font-family:system-ui,sans-serif;max-width:640px;margin:0 auto;padding:24px;">
    <h2 style="color:#991b1b;">RetIQ Monitor Alert</h2>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;">
    <pre style="background:#fef2f2;padding:16px;border-radius:8px;overflow-x:auto;font-size:13px;">${details}</pre>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;">
    <p style="color:#94a3b8;font-size:12px;">RetIQ Monitoring Pipeline v4.0-beta</p>
  </div>`;
  return sendEmail(env, env.ADMIN_EMAIL, subject, details, html);
}

async function handleRegsApprove(url, request, env) {
  const id = url.searchParams.get("id");
  const t = url.searchParams.get("t");
  const sig = url.searchParams.get("sig");

  if (!id || !t || !sig) {
    return new Response(
      approvalPage(
        "Missing Parameters",
        "The approval link is incomplete.",
        false
      ),
      { status: 400, headers: { "Content-Type": "text/html" } }
    );
  }

  const message = `approve:${id}:${t}`;
  const valid = await hmacVerify(env.ADMIN_SECRET, message, sig);
  if (!valid) {
    return new Response(
      approvalPage(
        "Invalid Signature",
        "This approval link has an invalid signature.",
        false
      ),
      { status: 403, headers: { "Content-Type": "text/html" } }
    );
  }

  const timestamp = parseInt(t, 10);
  if (Date.now() - timestamp > APPROVAL_TTL * 1000) {
    return new Response(
      approvalPage(
        "Link Expired",
        "This approval link has expired (72-hour limit).",
        false
      ),
      { status: 410, headers: { "Content-Type": "text/html" } }
    );
  }

  const approvalKey = `approval:${id}`;
  const used = await env.REGS.get(approvalKey);
  if (used) {
    return new Response(
      approvalPage(
        "Already Used",
        "This approval link has already been used.",
        false
      ),
      { status: 409, headers: { "Content-Type": "text/html" } }
    );
  }

  const proposedRaw = await env.REGS.get("proposed");
  if (!proposedRaw) {
    return new Response(
      approvalPage(
        "No Proposal Found",
        "There is no pending regulatory update to approve.",
        false
      ),
      { status: 404, headers: { "Content-Type": "text/html" } }
    );
  }

  // Mark approval as used, promote proposed → current
  await env.REGS.put(
    approvalKey,
    JSON.stringify({ usedAt: new Date().toISOString() }),
    { expirationTtl: APPROVAL_TTL }
  );
  await env.REGS.put("current", proposedRaw);
  await env.REGS.delete("proposed");

  const stateRaw = await env.REGS.get("monitor:state");
  if (stateRaw) {
    const state = JSON.parse(stateRaw);
    state.status = "published";
    state.publishedAt = new Date().toISOString();
    await env.REGS.put("monitor:state", JSON.stringify(state));
  }

  const proposed = JSON.parse(proposedRaw);
  console.log("REGS approved and published, version:", proposed.version);
  return new Response(
    approvalPage(
      "Update Published!",
      `REGS version ${proposed.version} is now live.`,
      true
    ),
    { status: 200, headers: { "Content-Type": "text/html" } }
  );
}

function approvalPage(title, message, success) {
  const color = success ? "#16a34a" : "#dc2626";
  const icon = success ? "\u2713" : "\u2717";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>RetIQ \u2014 ${title}</title></head><body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;">
    <div style="text-align:center;max-width:400px;padding:40px;">
      <div style="font-size:48px;color:${color};margin-bottom:16px;">${icon}</div>
      <h1 style="color:#0f172a;margin-bottom:8px;">${title}</h1>
      <p style="color:#64748b;line-height:1.6;">${message}</p>
      <p style="color:#94a3b8;font-size:12px;margin-top:24px;">RetIQ Monitoring Pipeline v4.0-beta</p>
    </div></body></html>`;
}

// ──────────────────────────────────────────────────────────────
// Monitoring pipeline — runs on cron or manual trigger
// ──────────────────────────────────────────────────────────────

async function runMonitoringPipeline(env, options = {}) {
  const runId = randomToken(8);
  const startTime = new Date().toISOString();
  console.log(`[monitor:${runId}] Pipeline starting at ${startTime}`);

  try {
    const stateRaw = await env.REGS.get("monitor:state");
    const state = stateRaw ? JSON.parse(stateRaw) : {};

    if (state.status === "pending_approval" && !options.force) {
      console.log(
        `[monitor:${runId}] Skipping — pending proposal exists (use force to override)`
      );
      return { status: "skipped", reason: "pending_approval" };
    }

    const currentRaw = await env.REGS.get("current");
    if (!currentRaw) {
      console.log(
        `[monitor:${runId}] No current REGS in KV — nothing to compare against`
      );
      return { status: "error", reason: "no_current_regs" };
    }
    const currentRegs = JSON.parse(currentRaw);
    const targetYear = String(parseInt(currentRegs.version, 10) + 1);
    console.log(
      `[monitor:${runId}] Current version: ${currentRegs.version}, looking for: ${targetYear}`
    );

    const results = {};
    let anyNewValues = false;
    const mergedSections = {};

    for (const [sourceId, source] of Object.entries(MONITOR_SOURCES)) {
      console.log(
        `[monitor:${runId}] Processing source: ${sourceId} (${source.name})`
      );
      try {
        const sourceStateRaw = await env.REGS.get(
          `monitor:source:${sourceId}`
        );
        const sourceState = sourceStateRaw ? JSON.parse(sourceStateRaw) : {};

        const resolvedUrl = await resolveSourceUrl(source, targetYear);
        if (!resolvedUrl) {
          console.log(
            `[monitor:${runId}] ${sourceId}: No reachable URL found (${targetYear} data not yet published?)`
          );
          results[sourceId] = { status: "no_url", url: null };
          continue;
        }

        const page = await fetchSourcePage(resolvedUrl);
        if (page.status !== "ok") {
          console.log(
            `[monitor:${runId}] ${sourceId}: Fetch failed — ${page.status}`
          );
          results[sourceId] = { status: page.status, url: resolvedUrl };
          continue;
        }

        const pageText = stripToText(page.html);
        const pageHash = await hashContent(pageText);

        if (sourceState.lastHash === pageHash && !options.force) {
          console.log(
            `[monitor:${runId}] ${sourceId}: Page unchanged (hash match)`
          );
          results[sourceId] = { status: "unchanged", url: resolvedUrl };
          continue;
        }

        console.log(
          `[monitor:${runId}] ${sourceId}: Page changed, running Claude extraction...`
        );
        const extraction = await extractValuesWithClaude(
          env,
          sourceId,
          pageText,
          targetYear
        );
        if (!extraction.success) {
          console.log(
            `[monitor:${runId}] ${sourceId}: No ${targetYear} data found on page`
          );
          results[sourceId] = {
            status: "no_data",
            reason: extraction.reason,
            url: resolvedUrl,
          };
        } else {
          console.log(
            `[monitor:${runId}] ${sourceId}: Extracted ${Object.keys(extraction.data).length} fields`
          );
          results[sourceId] = {
            status: "extracted",
            url: resolvedUrl,
            fieldCount: Object.keys(extraction.data).length,
          };
          mergedSections[source.section] = extraction.data;
          anyNewValues = true;
        }

        await env.REGS.put(
          `monitor:source:${sourceId}`,
          JSON.stringify({
            lastHash: pageHash,
            lastUrl: resolvedUrl,
            lastCheck: new Date().toISOString(),
            lastStatus: results[sourceId].status,
          })
        );
      } catch (err) {
        console.log(
          `[monitor:${runId}] ${sourceId}: Error — ${err.message}`
        );
        results[sourceId] = { status: "error", error: err.message };
      }
    }

    if (!anyNewValues) {
      console.log(
        `[monitor:${runId}] No new values found for ${targetYear}`
      );
      const newState = {
        ...state,
        status: "no_changes",
        lastRun: startTime,
        lastRunId: runId,
        targetYear,
        results,
      };
      await env.REGS.put("monitor:state", JSON.stringify(newState));
      return { status: "no_changes", results };
    }

    // Build proposed REGS by merging extracted sections into current
    const proposedRegs = JSON.parse(currentRaw);
    proposedRegs.version = targetYear;
    proposedRegs.effectiveDate = `${targetYear}-01-01`;
    proposedRegs.publishedDate = new Date().toISOString().slice(0, 10);
    for (const [section, data] of Object.entries(mergedSections)) {
      proposedRegs[section] = { ...proposedRegs[section], ...data };
    }

    const changedSources = Object.entries(results)
      .filter(([, r]) => r.status === "extracted")
      .map(([id]) => MONITOR_SOURCES[id]?.name || id);

    proposedRegs.sources = {};
    for (const [sourceId, result] of Object.entries(results)) {
      if (result.status === "extracted") {
        proposedRegs.sources[sourceId] = `Extracted from ${result.url} on ${new Date().toISOString().slice(0, 10)}`;
      } else if (currentRegs.sources?.[sourceId]) {
        proposedRegs.sources[sourceId] = currentRegs.sources[sourceId];
      }
    }

    // Run sanity checks
    const sanityResult = runSanityChecks(currentRegs, proposedRegs);
    console.log(
      `[monitor:${runId}] Sanity checks: ${sanityResult.passed ? "PASSED" : `FAILED (${sanityResult.failures.length})`}`
    );

    if (!sanityResult.passed) {
      await env.REGS.put("proposed", JSON.stringify(proposedRegs), {
        expirationTtl: APPROVAL_TTL,
      });
      const failDetails = sanityResult.failures
        .map((f) => `[${f.rule}] ${f.message}`)
        .join("\n");
      await sendAlertEmail(
        env,
        `RetIQ Monitor: Sanity checks FAILED for ${targetYear}`,
        `The monitoring pipeline extracted new values for ${targetYear} but sanity checks failed.\nChanged sources: ${changedSources.join(", ")}\nFailures:\n${failDetails}\n\nThe proposed REGS have been stored for manual review.\nUse GET /regs-proposed to inspect, DELETE /regs-proposed to discard,\nor POST /regs-monitor-trigger with force=true after fixing.`
      );
      const newState = {
        status: "sanity_failed",
        lastRun: startTime,
        lastRunId: runId,
        targetYear,
        results,
        sanityFailures: sanityResult.failures.length,
      };
      await env.REGS.put("monitor:state", JSON.stringify(newState));
      return { status: "sanity_failed", failures: sanityResult.failures };
    }

    // Store proposal and send approval email
    await env.REGS.put("proposed", JSON.stringify(proposedRegs), {
      expirationTtl: APPROVAL_TTL,
    });
    const approvalId = randomToken(16);
    const approveUrl = await generateApprovalUrl(env, approvalId, Date.now());
    await sendApprovalEmail(
      env,
      currentRegs,
      proposedRegs,
      approveUrl,
      sanityResult
    );

    const newState = {
      status: "pending_approval",
      lastRun: startTime,
      lastRunId: runId,
      targetYear,
      results,
      approvalId,
    };
    await env.REGS.put("monitor:state", JSON.stringify(newState));
    console.log(
      `[monitor:${runId}] Approval email sent for version ${targetYear}`
    );
    return { status: "pending_approval", targetYear };
  } catch (err) {
    console.log(`[monitor:${runId}] Pipeline error: ${err.message}`);
    try {
      await sendAlertEmail(
        env,
        "RetIQ Monitor: Pipeline Error",
        `Error: ${err.message}\nStack: ${err.stack}`
      );
    } catch {}
    return { status: "error", error: err.message };
  }
}

// ──────────────────────────────────────────────────────────────
// Admin — monitor trigger + status + proposed REGS
// ──────────────────────────────────────────────────────────────

async function triggerMonitor(request, env) {
  const authHeader = request.headers.get("X-Admin-Secret");
  if (!authHeader || authHeader !== env.ADMIN_SECRET) {
    return jsonResponse({ error: "unauthorized" }, request, 401);
  }
  let body = {};
  try {
    body = await request.json();
  } catch {}
  const result = await runMonitoringPipeline(env, {
    force: body.force === true,
  });
  return jsonResponse(result, request);
}

async function getMonitorStatus(request, env) {
  const authHeader = request.headers.get("X-Admin-Secret");
  if (!authHeader || authHeader !== env.ADMIN_SECRET) {
    return jsonResponse({ error: "unauthorized" }, request, 401);
  }
  const stateRaw = await env.REGS.get("monitor:state");
  if (!stateRaw) {
    return jsonResponse(
      { status: "never_run", message: "Pipeline has not been triggered yet." },
      request
    );
  }
  return new Response(stateRaw, {
    headers: { "Content-Type": "application/json", ...corsHeaders(request) },
  });
}

async function getRegsProposed(request, env) {
  const authHeader = request.headers.get("X-Admin-Secret");
  if (!authHeader || authHeader !== env.ADMIN_SECRET) {
    return jsonResponse({ error: "unauthorized" }, request, 401);
  }
  const proposedRaw = await env.REGS.get("proposed");
  if (!proposedRaw) {
    return jsonResponse(
      { error: "no_proposed_regs", message: "No pending proposal." },
      request,
      404
    );
  }
  return new Response(proposedRaw, {
    headers: { "Content-Type": "application/json", ...corsHeaders(request) },
  });
}

async function deleteRegsProposed(request, env) {
  const authHeader = request.headers.get("X-Admin-Secret");
  if (!authHeader || authHeader !== env.ADMIN_SECRET) {
    return jsonResponse({ error: "unauthorized" }, request, 401);
  }
  await env.REGS.delete("proposed");
  const stateRaw = await env.REGS.get("monitor:state");
  if (stateRaw) {
    const state = JSON.parse(stateRaw);
    state.status = "rejected";
    state.rejectedAt = new Date().toISOString();
    await env.REGS.put("monitor:state", JSON.stringify(state));
  }
  return jsonResponse({ ok: true, message: "Proposed REGS discarded." }, request);
}
