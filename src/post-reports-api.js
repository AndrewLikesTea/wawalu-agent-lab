// POST /api/post-reports: one private report about one public Social post
// (#2343). Wired by functions/api/post-reports.js; stored by migration 0013.
//
// Shaped like src/leads.js, the site's other write that needs no account: JSON
// only, an exact key set, the same email normalisation, and a driver error never
// copied into a response. It adds what a report needs and a lead does not: the
// post has to exist, the reason has to be one the form offers (the list lives
// in src/post-report.js, so the radios and this check are one array), and a
// per-connection rate budget.
//
// A report is write-only from outside. There is no read route, the public post
// projection never joins the reports table, and the answer is an id and a
// status — never the email or the note. Nothing here hides, edits or deletes
// the post: review is the Wawalu team's, by hand.

import { normalizeEmail } from "./leads.js";
import { MAX_REPORT_CONTEXT_LENGTH, REPORT_REASONS } from "./post-report.js";

export const REPORT_RATE_LIMIT = 5;
const REQUIRED_KEYS = ["email", "post_id", "reason"];
const ALLOWED_KEYS = [...REQUIRED_KEYS, "context"];

function json(body, status, requestId, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-request-id": requestId,
      ...headers,
    },
  });
}

const failure = (status, code, message, requestId, headers = {}) =>
  json({ error: { code, message, request_id: requestId } }, status, requestId, headers);

// Absent, null or blank is no note. Anything else past the limit is refused,
// not truncated: a stored half-sentence is worse than a refused one.
function normalizeContext(value) {
  if (value === undefined || value === null) return { context: null };
  if (typeof value !== "string") return { invalid: true };
  const context = value.trim();
  if (context.length > MAX_REPORT_CONTEXT_LENGTH) return { invalid: true };
  return { context: context || null };
}

export function createD1PostReportStore(db) {
  return {
    async postExists(id) {
      return Boolean(await db.prepare("SELECT 1 AS found FROM social_posts WHERE id = ?").bind(id).first());
    },
    // ON CONFLICT names the open-report index, so only "this address already has
    // an open report on this post" is ignored; a CHECK failure still raises.
    async save(report) {
      await db.prepare(
        "INSERT INTO social_post_reports (id, post_id, reason, context, reporter_email, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        + " ON CONFLICT (post_id, reporter_email) WHERE status = 'open' DO NOTHING",
      ).bind(report.id, report.post_id, report.reason, report.context, report.reporter_email, report.created_at).run();
      const row = await db.prepare("SELECT id FROM social_post_reports WHERE post_id = ? AND reporter_email = ? AND status = 'open'")
        .bind(report.post_id, report.reporter_email).first();
      return { id: row.id, created: row.id === report.id };
    },
  };
}

export async function handlePostReportRequest(request, {
  store,
  identify = null,
  rateLimit = null,
  requestId = globalThis.crypto?.randomUUID?.() ?? String(Date.now()),
  newId = () => globalThis.crypto.randomUUID(),
  now = () => new Date().toISOString(),
  nowMs = () => Date.now(),
} = {}) {
  if (request.method !== "POST") {
    return failure(405, "method_not_allowed", "Method not allowed.", requestId, { allow: "POST" });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return failure(415, "unsupported_media_type", "Content-Type must be application/json.", requestId);
  }
  let input;
  try {
    input = await request.json();
  } catch {
    return failure(400, "invalid_json", "Request body must be valid JSON.", requestId);
  }
  const isObject = input !== null && typeof input === "object" && !Array.isArray(input);
  const keys = isObject ? Object.keys(input) : [];
  if (!isObject || !keys.every((key) => ALLOWED_KEYS.includes(key)) || !REQUIRED_KEYS.every((key) => keys.includes(key))
    || typeof input.post_id !== "string" || !input.post_id) {
    return failure(400, "invalid_request", "Body contains unsupported or missing fields.", requestId);
  }
  if (!REPORT_REASONS.some((reason) => reason.value === input.reason)) {
    return failure(422, "invalid_reason", "Choose one of the listed reasons.", requestId);
  }
  const email = normalizeEmail(input.email);
  if (!email) return failure(422, "invalid_email", "Enter a valid email address.", requestId);
  const { context, invalid } = normalizeContext(input.context);
  if (invalid) {
    return failure(422, "invalid_context", `Your note must be ${MAX_REPORT_CONTEXT_LENGTH} characters or fewer.`, requestId);
  }

  try {
    const principal = identify && rateLimit ? await identify(request) : null;
    if (principal) {
      const at = nowMs();
      const rate = await rateLimit(`report:${principal.id}`, at);
      if (!rate.allowed) {
        return failure(429, "rate_limited", "Too many reports from this connection. Wait a minute, then try again.", requestId,
          { "retry-after": String(Math.max(1, Math.ceil((rate.resetAt - at) / 1000))) });
      }
    }
    if (!await store.postExists(input.post_id)) {
      return failure(404, "not_found", "This post is not stored on Social, so it cannot be reported.", requestId);
    }
    const saved = await store.save({
      id: newId(), post_id: input.post_id, reason: input.reason, context, reporter_email: email, created_at: now(),
    });
    return json({ id: saved.id, status: "received" }, saved.created ? 201 : 200, requestId);
  } catch {
    // Correlatable without copying a driver message, which can carry bound
    // values — here, a reporter's email — into platform logs.
    console.error("post_report_storage_error", { requestId });
    return failure(500, "storage_error", "We couldn’t send your report. Please try again.", requestId);
  }
}
