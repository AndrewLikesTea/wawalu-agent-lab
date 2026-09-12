// A forwarded brief is read far from this page, so every address in it is
// production's. Never location.origin: a brief copied from a preview or from
// localhost must still point at labs.wawalu.org.
export const SHIPLOG_ORIGIN = "https://labs.wawalu.org";
// The homepage footer's panel: an authored follow-up form about Shiplog itself
// (follow_up_homepage), open on a cold load and never inside a disclosure. Tab
// from the panel reaches its email field first, then its submit button.
export const BRIEF_FOLLOW_UP_URL = `${SHIPLOG_ORIGIN}/#site-footer-panel`;
export const BRIEF_FOLLOW_UP_SENTENCE = "To ask about availability and pricing, send the Wawalu team that operates Shiplog a follow-up request:";

// The one text both the clipboard and the manual-copy box receive, so the two
// cannot drift. `recordHref` is the brief's own deployment link, made absolute.
export function buildShiplogEvaluationBrief({ paragraphs, recordHref, pageHref }) {
  const page = new URL(pageHref, SHIPLOG_ORIGIN);
  return [...paragraphs,
    `Verification: ${new URL(recordHref, SHIPLOG_ORIGIN).href}`,
    `${BRIEF_FOLLOW_UP_SENTENCE} ${BRIEF_FOLLOW_UP_URL}`,
    `Page: ${new URL(`${page.pathname}${page.search}${page.hash}`, SHIPLOG_ORIGIN).href}`,
  ].join("\n\n");
}

// Copy the rendered brief so shared wording stays in step with the page.
export function bindShiplogEvaluationBrief(doc = globalThis.document,
  clipboard = globalThis.navigator?.clipboard, location = globalThis.location) {
  const brief = doc?.getElementById("shiplog-evaluation-brief-text");
  const button = doc?.getElementById("copy-shiplog-evaluation-brief");
  const status = doc?.getElementById("shiplog-evaluation-brief-status");
  const fallback = doc?.getElementById("shiplog-evaluation-brief-fallback");
  const manual = doc?.getElementById("shiplog-evaluation-brief-manual");
  const record = brief?.querySelector("a");
  if (!record || !button || !status || !fallback || !manual) return false;

  // Only the newest press may speak. Two presses race, and a slow first copy
  // settling after a refused second one would otherwise report success for a
  // clipboard that is still empty. The button is NOT disabled while a copy is in
  // flight: disabling a focused control blurs it, and a keyboard buyer who
  // pressed Enter would lose their place on the page mid-copy.
  let press = 0;
  button.addEventListener("click", async () => {
    const current = ++press;
    status.textContent = "";
    const payload = buildShiplogEvaluationBrief({
      paragraphs: Array.from(brief.querySelectorAll("h2, p"),
        (node) => node.textContent.replace(/\s+/g, " ").trim()),
      recordHref: record.getAttribute("href"),
      pageHref: location.href,
    });
    try {
      await clipboard.writeText(payload);
      if (current !== press) return;
      fallback.hidden = true;
      status.textContent = "Shiplog evaluation brief and page link copied.";
    } catch {
      if (current !== press) return;
      manual.value = payload;
      fallback.hidden = false;
      status.textContent = "Could not copy the Shiplog evaluation brief. Copy it manually from the text box below, which includes the page URL.";
      manual.focus();
      manual.select();
    }
  });
  return true;
}

if (typeof document !== "undefined") bindShiplogEvaluationBrief();
