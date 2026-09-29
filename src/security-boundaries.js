// What this public demonstration reaches, what it cannot, and where a reader
// checks both without taking our word for it.
//
// EVERY SENTENCE HERE IS TRACEABLE, AND NOTHING ELSE MAY BE ADDED.
// The five nouns in DEMO_BOUNDARIES are the product charter's own constraint
// ("No Wawalu production database, cookies, credentials, or internal APIs")
// plus its stated outcome ("Operate without access to Wawalu customer or
// telemetry data"). The storage pair is behaviour this site ships: decisions
// and releases live in this browser's own storage under src/app.js, and a
// Social post is written to this site's public posts API and read back by
// every visitor. NOTHING about encryption, retention, certification,
// compliance or a customer deployment belongs in this file: none of it is in
// the charter and none of it is visible in what ships, so a sentence claiming
// it would be a sentence nobody can check.
//
// ONE SOURCE, TWO SURFACES. The section in index.html is authored markup so a
// visitor whose script never ran still reads the boundaries — a trust claim
// that arrives with hydration is one a scanning reader never gets — and the
// plain text a manager receives is built here from the same constants. The two
// are held byte-for-byte equal by tests/homepage-security-boundaries.test.js,
// so a wording change on one side fails until it lands on both.

import { copyText } from "./share-link.js";
import { SHIPLOG_ORIGIN } from "./shiplog-evaluation-brief.js";
import { HEALTH_URL } from "./deployment-status-view.js";
import { REPOSITORY_URL } from "./repository-url.js";

export const SECURITY_BOUNDARY_TITLE = "Security and data boundaries";

export const SECURITY_BOUNDARY_LEAD = "Read what this demonstration can and cannot reach before you send anyone an email address. Nothing below is a certification, and none of it is a claim about a deployment of your own.";

export const DEMO_BOUNDARY_LEAD = "The public Shiplog demonstration on this site does not access any of these:";

// Five items, in the charter's own words, scannable as a list rather than
// buried in a sentence: a reader checking a boundary is looking for one of
// them, not reading a paragraph.
export const DEMO_BOUNDARIES = Object.freeze([
  "Wawalu customer data",
  "Wawalu production databases",
  "Cookies",
  "Credentials",
  "Internal APIs",
]);

// The sentence most easily written wrong, so it is written once, here.
// Records you enter are browser-local; a published Social post is neither
// local nor private, and this copy may never imply that it is. The second
// sentence is the consequence the Social composer already states beside its
// own publish control, said again where a buyer is reading about boundaries.
export const STORAGE_DISTINCTION = Object.freeze([
  "Decisions and releases you record here stay in this browser. Recording one sends it nowhere, no account holds it, and clearing this browser’s storage removes it.",
  "Posts published through Social are the opposite, on purpose: a published post is sent to this site’s public posts API and kept there, and anyone who visits Shiplog can read it, its image, and the display name it was published with. A published post is not private, is not browser-only, and cannot be edited or deleted after publishing.",
]);

export const SECURITY_EVIDENCE_LEAD = "Both of these can be inspected independently, without asking us:";

// The addresses are production's, composed from the constants the rest of the
// site already publishes rather than retyped. `/healthz` is the path every
// module reads (HEALTH_URL), made absolute here for the same reason the
// evaluation brief absolutises its links: this text is written to leave the
// page, and a relative path in a forwarded email points at nothing.
export const SECURITY_EVIDENCE = Object.freeze([
  Object.freeze({
    id: "security-boundaries-charter",
    label: "Read the product charter these boundaries are taken from, in the public repository",
    href: `${REPOSITORY_URL}/blob/main/PRODUCT.md`,
  }),
  Object.freeze({
    id: "security-boundaries-health",
    label: "Open the health endpoint this deployment answers",
    href: new URL(HEALTH_URL, SHIPLOG_ORIGIN).href,
  }),
]);

export const SECURITY_BOUNDARY_PAGE = `${SHIPLOG_ORIGIN}/`;

export const SECURITY_COPY_LABEL = "Copy the security and data boundaries";
export const SECURITY_COPY_LEAD = "Plain text for forwarding, carrying the same boundaries and the same two evidence links as the section above.";
export const SECURITY_COPY_DONE = "Security and data boundaries copied, with both evidence links.";
export const SECURITY_COPY_FAILED = "Could not copy the security and data boundaries. Copy them from the text box below, which carries both evidence links.";

export const SECURITY_BOUNDARY_IDS = Object.freeze({
  section: "security-boundaries",
  title: "security-boundaries-title",
  actions: "security-boundaries-actions",
  button: "copy-security-boundaries",
  status: "security-boundaries-status",
  fallback: "security-boundaries-fallback",
  manual: "security-boundaries-manual",
});

/**
 * The one text the clipboard and the manual-copy box both receive.
 *
 * Authored input only: no DOM text, no location, no storage and no record of a
 * visitor's goes into it, so a copy made on a preview build says exactly what a
 * copy made on labs.wawalu.org says.
 */
export function buildSecurityBoundaryText({
  title = SECURITY_BOUNDARY_TITLE,
  lead = SECURITY_BOUNDARY_LEAD,
  boundaryLead = DEMO_BOUNDARY_LEAD,
  boundaries = DEMO_BOUNDARIES,
  storage = STORAGE_DISTINCTION,
  evidenceLead = SECURITY_EVIDENCE_LEAD,
  evidence = SECURITY_EVIDENCE,
  page = SECURITY_BOUNDARY_PAGE,
} = {}) {
  return [
    title,
    lead,
    [boundaryLead, ...boundaries.map((item) => `- ${item}`)].join("\n"),
    ...storage,
    [evidenceLead, ...evidence.map((link) => `- ${link.label}: ${link.href}`)].join("\n"),
    `Page: ${page}`,
  ].join("\n\n");
}

export const SECURITY_BOUNDARY_TEXT = buildSecurityBoundaryText();

function el(doc, tagName, className, text) {
  const node = doc.createElement(tagName);
  if (className) node.setAttribute("class", className);
  if (text) node.append(doc.createTextNode(text));
  return node;
}

/**
 * Draw the copy control, rather than shipping it in the markup.
 *
 * The homepage's print control is drawn for the same reason: a button that
 * needs a module to do anything is a dead control on a page whose script never
 * ran, and a dead control is worse than none. The boundaries themselves are
 * authored in the document and are readable either way — only the copy is
 * withdrawn when nothing can perform it.
 */
export function renderSecurityCopyControl(doc) {
  const wrapper = el(doc, "div", "share-control");
  const lead = el(doc, "p", "hint", SECURITY_COPY_LEAD);
  lead.id = `${SECURITY_BOUNDARY_IDS.button}-lead`;
  const button = el(doc, "button", "share-button", SECURITY_COPY_LABEL);
  button.id = SECURITY_BOUNDARY_IDS.button;
  button.setAttribute("type", "button");
  button.setAttribute("aria-describedby", `${SECURITY_BOUNDARY_IDS.button}-lead`);
  const status = el(doc, "span", "share-status");
  status.id = SECURITY_BOUNDARY_IDS.status;
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  wrapper.append(lead, button, status);
  return { wrapper, button, status };
}

// The route out of a refused clipboard: the same text, selectable by hand. It
// is built on the failure rather than shipped hidden, because a textarea in the
// markup is a tab stop a visitor pays for on every load to cover a case most of
// them never meet.
function renderFallback(doc, text) {
  const wrapper = el(doc, "div", null);
  wrapper.id = SECURITY_BOUNDARY_IDS.fallback;
  const label = el(doc, "label", null, "Security and data boundaries for manual copying");
  label.setAttribute("for", SECURITY_BOUNDARY_IDS.manual);
  const manual = doc.createElement("textarea");
  manual.id = SECURITY_BOUNDARY_IDS.manual;
  manual.setAttribute("rows", "14");
  manual.setAttribute("readonly", "");
  manual.value = text;
  wrapper.append(label, manual);
  return { wrapper, manual };
}

/**
 * Wire the section's copy control, and report whether there was one to wire.
 *
 * A refused or missing clipboard is an answer, not a crash: `copyText` states
 * `false` for an absent API and for a rejected write alike, because the
 * reader's clipboard is empty either way, and the status line says so instead
 * of claiming a copy that did not happen.
 */
export function bindSecurityBoundaries(doc = globalThis.document,
  clipboard = globalThis.navigator?.clipboard) {
  const actions = doc?.getElementById(SECURITY_BOUNDARY_IDS.actions);
  if (!actions) return false;

  const { wrapper, button, status } = renderSecurityCopyControl(doc);
  actions.replaceChildren(wrapper);
  let fallback = null;

  // Only the newest press may speak: two presses race, and a slow first write
  // settling after a refused second one would report success for an empty
  // clipboard. The button is never disabled while a write is in flight —
  // disabling a focused control blurs it, and a keyboard reader who pressed
  // Enter would lose their place on the page mid-copy.
  let press = 0;
  button.addEventListener("click", async () => {
    const current = ++press;
    status.textContent = "";
    const copied = await copyText(clipboard, SECURITY_BOUNDARY_TEXT);
    if (current !== press) return;
    status.textContent = copied ? SECURITY_COPY_DONE : SECURITY_COPY_FAILED;
    if (copied) {
      fallback?.wrapper.remove();
      fallback = null;
      return;
    }
    if (!fallback) {
      fallback = renderFallback(doc, SECURITY_BOUNDARY_TEXT);
      wrapper.append(fallback.wrapper);
    }
    fallback.manual.value = SECURITY_BOUNDARY_TEXT;
    fallback.manual.focus();
    if (typeof fallback.manual.select === "function") fallback.manual.select();
  });
  return true;
}

if (typeof document !== "undefined") bindSecurityBoundaries();
