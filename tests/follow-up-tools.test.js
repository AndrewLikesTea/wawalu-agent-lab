import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, textOf, typeText, pressEnter } from './support/browser.js';
import { waitFor } from './support/page-module.js';
import { createTestD1 } from './support/d1-sqlite.js';
import { onRequest } from '../functions/api/leads.js';
import { initSiteFooter } from '../src/site-footer.js';
import { FOLLOW_UP_TOOLS, TOOL_DISCLOSURE, toolInvitation } from '../src/follow-up-tools.js';
import { FOLLOW_UP_INTENTS, FOLLOW_UP_USE, FOLLOW_UP_REPLY } from '../src/lead-capture.js';
import { FOLLOW_UP_TOPICS } from '../src/leads.js';
import { initAskAboutShiplog, initAskAboutShiplogActions } from '../src/ask-about-shiplog.js';
const post = (db, body) => onRequest({ request: new Request('https://example.com/api/leads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), env: { DB: db } });
for (const [file, tool, purpose] of [['social.html','social','follow_up_social'], ['profile.html','people','follow_up_people'], ['agents.html','agents','follow_up_agents']]) {
  test(`${file}: both selections reach storage and the receipt; Shiplog options survive switching`, async () => {
    const db = await createTestD1();
    const page = await loadPage(new URL('../src/'+file, import.meta.url));
    const doc = page.document;
    const get = id => doc.getElementById('site-footer-'+id);
    const calls = [];
    try {
      initSiteFooter(doc, (url, options) => { const body = JSON.parse(options.body); calls.push(body); return post(db, body); });
      initAskAboutShiplog(doc);
      initAskAboutShiplogActions(doc);
      for (const text of [TOOL_DISCLOSURE, FOLLOW_UP_USE, FOLLOW_UP_REPLY]) assert.ok(textOf(get('panel')).includes(text));
      for (const label of Object.values(FOLLOW_UP_INTENTS)) assert.ok(textOf(get('intent')).includes(label));
      for (const selection of [tool, 'shiplog']) {
        get('tool-'+selection).click();
        assert.ok(textOf(get('tool-selection')).includes(FOLLOW_UP_TOOLS[selection]));
        if (selection !== 'shiplog') assert.equal(textOf(doc.querySelector('.site-footer-invitation')), toolInvitation(tool));
        if (selection === 'shiplog') doc.getElementById('ask-about-shiplog-demo').click();
        assert.equal(get('intent').hidden, selection !== 'shiplog');
        get('email').value = ''; get('email').focus(); typeText(doc, 'visitor@example.com'); pressEnter(doc);
        await waitFor(() => get('form').dataset.state === 'success', 'request saved');
        assert.equal(calls.at(-1).tool, selection);
        assert.equal(calls.at(-1).intent, selection === 'shiplog' ? 'demo' : 'question');
        assert.ok(textOf(get('confirmation')).includes(`Request about: ${FOLLOW_UP_TOOLS[selection]}.`));
        get('again').click();
      }
      assert.equal(db.raw.prepare('SELECT tool FROM lead_submissions').get().tool, 'shiplog');
      assert.equal(db.raw.prepare('SELECT tool FROM tool_interest_requests').get().tool, tool);
      get('tool-'+tool).click();
      doc.getElementById('ask-about-shiplog-pilot').click();
      assert.equal(get('tool-shiplog').checked, true);
      assert.equal(get('intent').hidden, false);
      get('tool-'+tool).click();
      doc.getElementById('ask-about-shiplog').click();
      assert.equal(get('tool-shiplog').checked, true);
      assert.equal(get('intent').hidden, false);
      for (const intent of Object.keys(FOLLOW_UP_INTENTS)) {
        assert.equal((await post(db, { email: 'visitor@example.com', purpose, topic: FOLLOW_UP_TOPICS[purpose], tool: 'shiplog', intent })).status, 200);
      }
      for (const extra of [{tool:'unknown',intent:'question'}, {tool,intent:'pilot'}, {tool:null,intent:'question'}]) {
        assert.equal((await post(db, { email:'bad@example.com', purpose, topic:FOLLOW_UP_TOPICS[purpose], ...extra })).status, 422);
      }
    } finally { page.restore(); db.close(); }
  });
}

test('tool receipt requires a matching stored selection, and missing migration fails honestly', async () => {
  const { postLeadEmail, CONTACT_COPY } = await import('../src/lead-capture.js');
  for (const tool of [undefined, 'people']) {
    await assert.rejects(postLeadEmail(async () => new Response(JSON.stringify({ captured:true, created:true, tool })),
      'visitor@example.com', 'follow_up_social', CONTACT_COPY, FOLLOW_UP_TOPICS.follow_up_social, null, 'question', 'social'),
    error => error.reason === 'unconfirmed');
  }
  const { MIGRATIONS } = await import('./support/d1-sqlite.js');
  const db = await createTestD1({ migrations: MIGRATIONS.filter(name => !name.startsWith('0015')) });
  try {
    const response = await post(db, { email:'visitor@example.com', purpose:'follow_up_social', topic:FOLLOW_UP_TOPICS.follow_up_social, tool:'social', intent:'question' });
    assert.equal(response.status, 500);
    assert.equal((await response.json()).error.code, 'storage_error');
  } finally { db.close(); }
});
