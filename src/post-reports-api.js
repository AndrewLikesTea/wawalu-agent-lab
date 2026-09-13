import seed from './social-demo-data.json' with { type: 'json' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Stored as-is so reports can be counted by reason; src/report-post.html offers exactly these.
export const REPORT_REASONS = ['harmful', 'sensitive', 'mistaken', 'impersonation', 'other'];
export function validateReport(input) {
  const values = {};
  const errors = [];
  for (const [key, max, required] of [['post_id', 100, true], ['context', 2000, false], ['email', 254, true]]) {
    const value = input?.[key] ?? (required ? null : '');
    if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) errors.push(`${key} must contain ${required ? '1' : '0'}–${max} characters.`);
    else values[key] = value.trim();
  }
  if (!REPORT_REASONS.includes(input?.reason)) errors.push(`reason must be one of: ${REPORT_REASONS.join(', ')}.`);
  else if (input.reason === 'other' && values.context === '') errors.push('Describe the problem under Context when the reason is Something else.');
  else values.reason = input.reason;
  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) errors.push('Enter a valid email for follow-up.');
  if (!UUID.test(input?.submission_id ?? '')) errors.push('A valid submission ID is required. Reload the report page.');
  else values.submission_id = input.submission_id;
  return { values, errors };
}

export function createD1ReportStore(db) {
  return {
    async save(row) {
      // Atomic uniqueness handles simultaneous requests and a lost success response.
      await db.prepare(`INSERT INTO post_reports (submission_id,post_id,reason,context,email,created_at)
        VALUES (?,?,?,?,?,?) ON CONFLICT(submission_id) DO NOTHING`)
        .bind(row.submission_id, row.post_id, row.reason, row.context, row.email, row.created_at).run();
      const saved = await db.prepare('SELECT post_id,reason,context,email FROM post_reports WHERE submission_id = ?').bind(row.submission_id).first();
      return ['post_id', 'reason', 'context', 'email'].every(key => saved?.[key] === row[key]);
    },
  };
}

export async function handleReportRequest(request, { posts, reports, now = () => new Date().toISOString() }) {
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', allow: 'POST' } });
  if (request.method !== 'POST') return reply(405, { error: { message: 'Only report submission is available.' } });
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return reply(403, { error: { message: 'Submit from the Wawalu report page.' } });
  if (!request.headers.get('content-type')?.startsWith('application/json')) return reply(415, { error: { message: 'Send JSON.' } });
  let input;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).length > 16000) return reply(413, { error: { message: 'Report is too large. Shorten the context and retry.' } });
    input = JSON.parse(body);
  } catch { return reply(400, { error: { message: 'Invalid JSON.' } }); }
  const { values, errors } = validateReport(input);
  if (errors.length) return reply(422, { error: { message: errors.join(' ') } });
  try {
    if (!seed.posts.some(post => post.id === values.post_id) && !await posts.get(values.post_id)) return reply(404, { error: { message: 'This post is no longer available. Your report has not been submitted.' } });
    if (!await reports.save({ ...values, created_at: now() })) return reply(409, { error: { message: 'This report was already received with different entries.' } });
    return reply(200, { accepted: true });
  } catch {
    // Never log storage exceptions: they may include private bound values.
    console.error('post_report_storage_unavailable');
    return reply(503, { error: { message: 'We could not confirm your report was received.' } });
  }
}
