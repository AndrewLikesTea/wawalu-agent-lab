export async function mountReportPage(root = document, { fetcher = globalThis.fetch, search = globalThis.window?.location?.search ?? globalThis.location?.search ?? '', uuid = () => globalThis.crypto.randomUUID() } = {}) {
  const id = new URLSearchParams(search).get('id');
  const selected = root.querySelector('#selected-post');
  const form = root.querySelector('#report-form');
  const status = root.querySelector('#report-status');
  const submit = root.querySelector('#report-submit');
  const retry = root.querySelector('#load-retry');
  const reasons = [...root.querySelectorAll('input[name="reason"]')];
  const [context, email] = ['context', 'email'].map(key => root.querySelector(`#report-${key}`));
  let pending = false;
  let done = false;
  let submissionId;
  let sent;
  const lock = locked => {
    reasons.forEach(radio => { radio.disabled = locked; });
    context.readOnly = email.readOnly = locked;
  };
  // "Something else" is unreviewable without words; the server refuses it too.
  reasons.forEach(radio => radio.addEventListener('change', () => {
    if (radio.value === 'other') context.setAttribute('required', '');
    else context.removeAttribute('required');
  }));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending || done || form.hidden || !form.reportValidity()) return;
    const reason = reasons.find(radio => radio.checked)?.value;
    if (!reason) { status.textContent = 'Choose a reason for the report.'; return; }
    const draft = JSON.stringify({ post_id: id, reason, context: context.value, email: email.value });
    // Same entries reuse the ID so a lost receipt cannot duplicate the report;
    // changed entries are a new report, which the server would refuse under the old ID.
    if (draft !== sent) { submissionId = uuid(); sent = draft; }
    pending = true;
    submit.disabled = true;
    lock(true);
    status.textContent = 'Sending report…';
    let message;
    try {
      const response = await fetcher('/api/post-reports', {
        method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'omit',
        body: JSON.stringify({ ...JSON.parse(draft), submission_id: submissionId }),
      });
      const payload = await response.json().catch(() => ({}));
      done = response.ok && payload.accepted === true;
      message = payload.error?.message;
    } catch { /* Connection lost: whether the report arrived is unknown, so retry. */ }
    pending = false;
    submit.disabled = done;
    lock(false);
    if (done) {
      form.hidden = true;
      status.textContent = 'Report received. The Wawalu team will review this post. It has not been removed, and not every report leads to removal.';
      status.focus();
    } else {
      status.textContent = `${message || 'We could not confirm your report was received.'} Your entries are still here. Select Retry report.`;
      submit.textContent = 'Retry report';
    }
  });
  const load = async () => {
    if (!id) return;
    retry.hidden = true;
    selected.textContent = 'Loading selected post…';
    try {
      const seed = id.startsWith('seed-');
      const response = await fetcher(seed ? '/social-demo-data.json' : `/api/social-posts/${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('The selected post could not be loaded.');
      const payload = await response.json();
      const post = seed ? payload.posts.find(post => post.id === id) : payload.post;
      if (!post || post.id !== id) throw new Error('The selected post is unavailable.');
      selected.textContent = `You are reporting this post by ${post.author}: “${post.content ?? post.body}”`;
      form.hidden = false;
    } catch {
      selected.textContent = 'The selected post could not be loaded. Retry, or choose a post from Social or People.';
      retry.hidden = false;
    }
  };
  retry.addEventListener('click', load);
  await load();
}
if (typeof document !== 'undefined' && document.querySelector('#report-form')) mountReportPage();
