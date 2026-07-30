import { renderState } from "./state-ui.js";

// The team now iterates on an external product (paint-lab); the lab repo still
// carries runner and process activity, so the observatory watches both.
const EVENTS_URLS = [
  "https://api.github.com/repos/AndrewLikesTea/paint-lab/events?per_page=30",
  "https://api.github.com/repos/AndrewLikesTea/wawalu-agent-lab/events?per_page=30",
];
const REFRESH_MS = 90_000;
const DEMO_DATA_URL = "/agent-demo-data.json";
export const REPRESENTATIVE_ACTIVITY = [
  {
    persona: "Sam · Manager",
    title: "Scope the observatory fallback",
    detail: "Sam turns the product outcome into a bounded, testable task.",
    phase: "Plan",
  },
  {
    persona: "Mina · Frontend engineer",
    title: "Build resilient loading and error states",
    detail: "Mina implements an accessible interface using synthetic fixtures.",
    phase: "Build",
  },
  {
    persona: "Marcus · Independent reviewer",
    title: "Review the representative experience",
    detail: "Marcus checks privacy, accessibility, correctness, and focused tests.",
    phase: "Review",
  },
  {
    persona: "Wawalu team · Team",
    title: "Publish reviewed repository work",
    detail: "Protected checks remain responsible for delivery after approval.",
    phase: "Deliver",
  },
];
const PERSONAS = {
  manager: { name: "Sam", role: "Manager" },
  staff: { name: "Priya", role: "Staff engineer" },
  frontend: { name: "Mina", role: "Frontend engineer" },
  backend: { name: "Rowan", role: "Backend engineer" },
  infrastructure: { name: "Ellis", role: "Infrastructure engineer" },
  product: { name: "Noor", role: "Product manager" },
  design: { name: "Iris", role: "Product designer" },
  evaluation: { name: "Theo", role: "Evaluation engineer" },
  integrations: { name: "Anya", role: "Integrations engineer" },
  copywriter: { name: "Jude", role: "Copywriter" },
  sales: { name: "Sasha", role: "Sales lead" },
  graphics: { name: "Kai", role: "Graphics engineer" },
  fullstack: { name: "Remy", role: "Full-stack engineer" },
  qa: { name: "Tess", role: "QA engineer" },
  security: { name: "Vera", role: "Security engineer" },
  platform: { name: "Omar", role: "Platform engineer" },
  reviewer: { name: "Marcus", role: "Reviewer" },
  team: { name: "Wawalu team", role: "Team" },
};

export function personaFromRef(ref = "") {
  const match = String(ref).match(/(?:refs\/heads\/)?agent\/([^/]+)/);
  return match?.[1]?.replaceAll("-", " ") ?? "team";
}

export function personaIdentity(role = "team") {
  return PERSONAS[role] ?? { name: role.replaceAll("-", " "), role: "Agent" };
}

function personaByName(name) {
  return Object.entries(PERSONAS).find(([, persona]) => persona.name === name) ?? ["team", PERSONAS.team];
}

function personaBadge(role) {
  const persona = personaIdentity(role);
  return `${persona.name} · ${persona.role}`;
}

export function describeEvent(event) {
  const payload = event?.payload ?? {};
  if (event?.type === "IssueCommentEvent" && payload.comment?.body?.includes("wawalu-review-debate")) {
    const speaker = payload.comment.body.match(/\*\*([^*\n]+)\*\*/)?.[1]?.trim() || "Wawalu team";
    const [role, persona] = personaByName(speaker);
    return {
      persona: personaBadge(role),
      title: payload.issue?.title || `Pull request #${payload.issue?.number ?? ""}`,
      detail: speaker === "Resolution"
        ? `The team resolved its review discussion on pull request #${payload.issue?.number ?? ""}`
        : `${persona.name} joined the review discussion on pull request #${payload.issue?.number ?? ""}`,
      url: payload.comment.html_url || payload.issue?.html_url,
    };
  }
  if (event?.type === "IssueCommentEvent" && payload.comment?.body?.includes("wawalu-peer-review")) {
    const speaker = payload.comment.body.match(/\*\*([^*\n]+)\*\*/)?.[1]?.split(" · ")[0]?.trim() || "Wawalu team";
    const [role, persona] = personaByName(speaker);
    return {
      persona: personaBadge(role), title: payload.issue?.title || "Pull request review",
      detail: `${persona.name} completed a peer review before Marcus’s final gate`,
      url: payload.comment.html_url || payload.issue?.html_url,
    };
  }
  if (event?.type === "IssueCommentEvent" && payload.comment?.body?.includes("wawalu-handoff")) {
    const speaker = payload.comment.body.match(/\*\*([^*\n]+)\*\*/)?.[1]?.split(" · ")[0]?.trim() || "Wawalu team";
    const [role, persona] = personaByName(speaker);
    return {
      persona: personaBadge(role), title: payload.issue?.title || "Dependency handoff",
      detail: `${persona.name} handed off completed work to the next engineer`,
      url: payload.comment.html_url || payload.issue?.html_url,
    };
  }
  if (event?.type === "IssueCommentEvent" && payload.comment?.body?.includes("wawalu-standup")) {
    return {
      persona: personaBadge("manager"), title: "Daily team standup",
      detail: "Sam published today’s priorities, blockers, and handoffs",
      url: payload.comment.html_url || payload.issue?.html_url,
    };
  }
  if (event?.type === "IssueCommentEvent" && payload.comment?.body?.includes("wawalu-agent-state")) {
    const labels = payload.issue?.labels ?? [];
    const personaLabel = labels.find((label) => String(label?.name ?? label).startsWith("persona:"));
    const role = String(personaLabel?.name ?? personaLabel ?? "manager").replace("persona:", "");
    const persona = personaIdentity(role);
    const state = payload.comment.body.match(/Synthetic team · ([^*\n]+)/)?.[1]?.trim() || "updated";
    return {
      persona: personaBadge(role),
      title: payload.issue?.title || `Issue #${payload.issue?.number ?? ""}`,
      detail: `${persona.name}: ${state} on issue #${payload.issue?.number ?? ""}`,
      url: payload.comment.html_url || payload.issue?.html_url,
    };
  }
  if (event?.type === "IssuesEvent" && payload.issue) {
    const labels = payload.issue.labels ?? [];
    const personaLabel = labels.find((label) => String(label?.name ?? label).startsWith("persona:"));
    const role = String(personaLabel?.name ?? personaLabel ?? "manager").replace("persona:", "");
    const persona = personaIdentity(role);
    return {
      persona: personaBadge(role),
      title: payload.issue.title || `Issue #${payload.issue.number ?? ""}`,
      detail: `${persona.name} ${payload.action ?? "updated"} task #${payload.issue.number ?? ""}`,
      url: payload.issue.html_url,
    };
  }
  if (event?.type === "PullRequestEvent") {
    const pull = payload.pull_request ?? {};
    const role = personaFromRef(pull.head?.ref);
    const persona = personaIdentity(role);
    const action = payload.action ?? "updated";
    const detail = action === "opened"
      ? `${persona.name} opened pull request #${pull.number ?? ""}`
      : action === "closed" && pull.merged
        ? `${persona.name}'s pull request #${pull.number ?? ""} was merged`
        : `${persona.name} ${action} pull request #${pull.number ?? ""}`;
    return {
      persona: personaBadge(role),
      title: pull.title || `Pull request #${pull.number ?? ""}`,
      detail,
      url: pull.html_url,
    };
  }
  if (event?.type === "PullRequestReviewEvent") {
    const pull = payload.pull_request ?? {};
    const state = String(payload.review?.state ?? payload.action ?? "reviewed").toLowerCase();
    const action = state === "approved" ? "approved" : state === "changes_requested" ? "requested changes on" : "reviewed";
    return {
      persona: personaBadge("reviewer"),
      title: pull.title || `Pull request #${pull.number ?? ""}`,
      detail: `Marcus ${action} pull request #${pull.number ?? ""}`,
      url: payload.review?.html_url || pull.html_url,
    };
  }
  if (event?.type === "PushEvent") {
    const commits = Array.isArray(payload.commits) ? payload.commits : [];
    const role = personaFromRef(payload.ref);
    const persona = personaIdentity(role);
    return {
      persona: personaBadge(role),
      title: commits[0]?.message || "Pushed repository changes",
      detail: `${persona.name} pushed ${commits.length} ${commits.length === 1 ? "commit" : "commits"}`,
      url: `https://github.com/AndrewLikesTea/wawalu-agent-lab/commits/${encodeURIComponent(String(payload.ref ?? "main").replace("refs/heads/", ""))}`,
    };
  }
  return null;
}

function appendText(parent, tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

// Event URLs come from an external API response; only ever link to
// http(s) destinations so a hostile payload cannot smuggle javascript: URLs.
export function safeActivityUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export function renderEvents(list, events) {
  list.replaceChildren();
  list.setAttribute("aria-busy", "false");
  list.dataset.feed = "live";
  const visible = events.map((event) => ({ event, item: describeEvent(event) })).filter(({ item }) => item);
  if (!visible.length) {
    renderState(list, {
      state: "empty",
      item: true,
      label: "Activity status",
      value: "No public GitHub activity yet.",
      description: "This list fills in once the team publishes repository work.",
      action: { label: "View the repository", href: "https://github.com/AndrewLikesTea/wawalu-agent-lab" },
    });
    return 0;
  }
  for (const { event, item } of visible.slice(0, 16)) {
    const row = document.createElement("li");
    row.className = "activity-item";
    appendText(row, "span", "activity-persona", item.persona);
    const copy = document.createElement("div");
    copy.className = "activity-copy";
    const link = appendText(copy, "a", "", item.title);
    link.href = safeActivityUrl(item.url) || "https://github.com/AndrewLikesTea/wawalu-agent-lab";
    link.rel = "noreferrer";
    appendText(copy, "span", "", item.detail);
    row.append(copy);
    const time = appendText(row, "time", "activity-time", new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
      Math.round((new Date(event.created_at).getTime() - Date.now()) / 60_000), "minute"));
    time.dateTime = event.created_at;
    list.append(row);
  }
  return visible.length;
}

// Why the live feed is not on screen, in the reader's terms. A stalled request
// and an unavailable service are not the same fact, and neither of them is "the
// team has published nothing" — which is what four unlabelled synthetic rows
// looked like before this banner sat above them.
//
// The banner sits at the top of the list, far below the status block, so it
// answers a different question: not "what happened to the request" — the status
// block above already said that — but "what am I looking at in these rows".
// The chip names the term for the rows and, after the separator, the one word
// that tells the reasons apart; the sentence says what the rows stand for. It
// never repeats the status block's sentence and never asks for an action: the
// only control on offer is the button beside the status.
export const ACTIVITY_FALLBACK_REASONS = Object.freeze({
  loading: Object.freeze({
    chip: "Synthetic example · checking",
    detail: "These four steps are the kind of work public GitHub activity reports. Live events replace them when GitHub answers.",
  }),
  unavailable: Object.freeze({
    chip: "Synthetic example · check failed",
    detail: "These four steps are the kind of work public GitHub activity reports. Nothing in this list is live.",
  }),
  empty: Object.freeze({
    chip: "Synthetic example · no events",
    detail: "These four steps are the kind of work public GitHub activity reports. GitHub answered with no events to show.",
  }),
});

function fallbackNote(reason) {
  const copy = ACTIVITY_FALLBACK_REASONS[reason] ?? ACTIVITY_FALLBACK_REASONS.loading;
  const row = document.createElement("li");
  row.className = "activity-fallback";
  row.dataset.reason = reason in ACTIVITY_FALLBACK_REASONS ? reason : "loading";
  const chip = appendText(row, "p", "activity-fallback-chip", copy.chip);
  const shape = document.createElement("span");
  shape.className = "activity-fallback-shape";
  shape.setAttribute("aria-hidden", "true");
  chip.prepend(shape);
  appendText(row, "span", "activity-fallback-detail", copy.detail);
  return row;
}

export function renderRepresentativeActivity(list, { reason = "loading" } = {}) {
  list.replaceChildren();
  list.setAttribute("aria-busy", "false");
  list.setAttribute("aria-label", "Synthetic example activity");
  list.dataset.feed = "representative";
  list.append(fallbackNote(reason));
  for (const item of REPRESENTATIVE_ACTIVITY) {
    const row = document.createElement("li");
    row.className = "activity-item activity-item-representative";
    appendText(row, "span", "activity-persona", item.persona);
    const copy = document.createElement("div");
    copy.className = "activity-copy";
    appendText(copy, "strong", "activity-title", item.title);
    appendText(copy, "span", "", item.detail);
    row.append(copy);
    appendText(row, "span", "activity-phase", item.phase);
    list.append(row);
  }
}

// A request in flight, a feed that answered with nothing, and a request that
// failed are three different facts about the world, and a reader who cannot tell
// them apart cannot tell whether to wait, to look elsewhere, or to retry. So
// each state owns a distinct heading, its own explanatory sentence, and its own
// outline shape. Colour never carries the difference on its own: the chip word,
// the heading, and the icon geometry each say which state this is.
//
// `recovery` is what the one control in this panel is for in each state, held
// in the model rather than read back off its label. Only a failed public
// request is a recovery: asking GitHub again is what could change the answer.
// Loading, live, and "the feed carried nothing" are all successful reads, and
// the same button there is an ordinary refresh, not a way out of a fault.
export const ACTIVITY_STATES = Object.freeze({
  loading: Object.freeze({
    shape: "loading",
    chip: "Checking",
    title: "Checking public GitHub activity",
    detail: "Nothing is needed from you. Until GitHub answers, the steps below are a synthetic example rather than live events.",
    keptDetail: "Nothing is needed from you. The events below are from the last successful update until GitHub answers again.",
    action: "Refresh",
    recovery: "refresh",
  }),
  live: Object.freeze({
    shape: "live",
    chip: "Live",
    title: "Live public GitHub activity",
    detail: "Public GitHub activity is shown below. This list refreshes every 90 seconds.",
    action: "Refresh",
    recovery: "refresh",
  }),
  empty: Object.freeze({
    shape: "empty",
    chip: "No events",
    title: "No recent public GitHub activity",
    detail: "GitHub answered and carried no events this observatory recognises — nothing failed, and nothing is hidden. The steps below are a synthetic example of the work this panel shows when there are events.",
    links: Object.freeze([
      Object.freeze({ label: "Meet the demo personas", href: "#persona-title" }),
      Object.freeze({ label: "Read the published prompt trace", href: "/agent-trace.html" }),
    ]),
    action: "Check for new activity",
    recovery: "refresh",
  }),
  error: Object.freeze({
    shape: "error",
    chip: "Request failed",
    title: "Public GitHub activity could not be loaded",
    detail: "The request for public GitHub activity failed, so nothing below is live. The steps shown are a synthetic example, and the rest of this page is unaffected.",
    keptDetail: "The request for public GitHub activity failed. The events below are from the last successful update, and the rest of this page is unaffected.",
    action: "Retry public GitHub activity",
    recovery: "retry",
  }),
});

// The public feed is read over the network, so every way it can fail is a way a
// second attempt could still succeed. Kept as a predicate rather than inlined so
// the retry rule is stated once and can be asserted directly.
export function isRecoverableActivityState(state) {
  return ACTIVITY_STATES[state]?.recovery === "retry";
}

function liveDetail(count) {
  return `${count} recent public GitHub ${count === 1 ? "event" : "events"} from the lab repositories. This list refreshes every 90 seconds.`;
}

// The status block sits immediately after the panel heading, so this is the
// first thing read after "Recent activity". The refresh control is a real
// button outside the block: it keeps its listener across re-renders and stays
// operable with Enter and Space without a key handler of its own.
export function renderActivityState(root, state, { count = 0, keptEvents = false } = {}) {
  const name = state in ACTIVITY_STATES ? state : "loading";
  const copy = ACTIVITY_STATES[name];
  const control = root.querySelector("#refresh-activity");
  if (control) {
    control.textContent = copy.action;
    control.dataset.state = name;
    // What this control is for right now, so "is a retry on offer?" is a fact
    // about the state rather than a guess at the button's wording.
    control.dataset.recovery = copy.recovery;
    // The sentence that explains the state is the button's description, so a
    // reader who tabs straight to it hears why they are being offered it.
    control.setAttribute("aria-describedby", "activity-state-detail");
  }
  const container = root.querySelector("#activity-status");
  if (!container) return null;
  container.dataset.state = name;
  const icon = document.createElement("span");
  icon.className = "activity-state-icon";
  icon.dataset.shape = copy.shape;
  icon.setAttribute("aria-hidden", "true");
  const body = document.createElement("div");
  body.className = "activity-state-copy";
  appendText(body, "p", "activity-state-chip", copy.chip);
  appendText(body, "h3", "activity-state-title", copy.title);
  const detail = appendText(body, "p", "activity-state-detail", name === "live"
    ? liveDetail(count)
    : (keptEvents && copy.keptDetail) || copy.detail);
  detail.id = "activity-state-detail";
  // Nothing recent to read is not a dead end: point at the two published things
  // that are always there — the persona profiles and the full prompt trace.
  if (copy.links) {
    const links = document.createElement("ul");
    links.className = "activity-state-links";
    for (const link of copy.links) {
      const row = document.createElement("li");
      const anchor = appendText(row, "a", "", link.label);
      anchor.href = link.href;
      links.append(row);
    }
    body.append(links);
  }
  container.replaceChildren(icon, body);
  return container;
}

export async function loadActivity(root = document, fetcher = fetch) {
  const list = root.querySelector("#activity-list");
  const signal = root.querySelector(".signal-card");
  const label = root.querySelector("#connection-label");
  const updated = root.querySelector("#last-updated");
  const hasLiveEvents = Boolean(list.querySelector?.(".activity-item:not(.activity-item-representative)"));
  renderActivityState(root, "loading", { keptEvents: hasLiveEvents });
  if (!hasLiveEvents) {
    renderRepresentativeActivity(list, { reason: "loading" });
    // The hero card is the page-level indicator: connection and freshness. It
    // must not restate the panel's status sentence, so it never repeats the
    // status heading — it says how the check stands and when data last arrived.
    label.textContent = "Checking";
    updated.textContent = "Not updated yet";
  }
  try {
    const responses = await Promise.all(EVENTS_URLS.map(
      (url) => fetcher(url, { headers: { Accept: "application/vnd.github+json" } }),
    ));
    if (!responses.some((response) => response.ok)) throw new Error(`GitHub returned ${responses[0].status}`);
    const payloads = await Promise.all(responses.map((response) => (response.ok ? response.json() : [])));
    const events = payloads
      .flatMap((payload) => (Array.isArray(payload) ? payload : []))
      .sort((a, b) => new Date(b.created_at ?? 0) - new Date(a.created_at ?? 0))
      .slice(0, 30);
    const count = renderEvents(list, events);
    if (count) {
      list.setAttribute("aria-label", "Recent public GitHub events");
      renderActivityState(root, "live", { count });
      label.textContent = "Live signal";
    } else {
      renderRepresentativeActivity(list, { reason: "empty" });
      renderActivityState(root, "empty");
      label.textContent = "Synthetic example shown";
    }
    signal.dataset.connected = "true";
    updated.textContent = `Updated ${new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date())}`;
  } catch {
    renderActivityState(root, "error", { keptEvents: hasLiveEvents });
    signal.dataset.connected = "false";
    label.textContent = "Check failed";
    updated.textContent = "Not updated";
    if (!hasLiveEvents) renderRepresentativeActivity(list, { reason: "unavailable" });
  }
}

// Retry runs the same load the page runs on mount and on its timer: one data
// path, so a retried request cannot reach a different state than a first one.
export function wireActivityControls(root = document, fetcher) {
  const refresh = () => loadActivity(root, fetcher ?? fetch);
  root.querySelector("#refresh-activity")?.addEventListener("click", refresh);
  return refresh;
}

function promptBlock(label, value) {
  const section = document.createElement("section");
  section.className = "prompt-step";
  appendText(section, "p", "prompt-label", label);
  appendText(section, "pre", "prompt-copy", value);
  return section;
}

export function renderPromptTrace(trace, data, { full = false } = {}) {
  trace.replaceChildren();
  trace.setAttribute("aria-busy", "false");
  const heading = document.createElement("div");
  heading.className = "trace-heading";
  appendText(heading, "strong", "", `${data.run.personaName} · ${data.run.personaRole}`);
  appendText(heading, "span", "", `${data.run.scenarioTitle} · ${data.run.worker}`);
  trace.append(heading);
  trace.append(
    promptBlock("1 · Qwen planning prompt", data.run.qwenPlanningPrompt),
    promptBlock(`2 · Qwen handoff to ${data.run.worker}`, data.run.qwenHandoff),
    promptBlock(`3 · Exact ${data.run.worker} worker prompt`, data.run.workerPrompt),
    promptBlock("4 · Marcus / Qwen review", data.run.qwenReview),
  );
  if (full) trace.classList.add("prompt-trace-full");
}

export function renderDemoData(root, data) {
  const personas = root.querySelector("#persona-list");
  const trace = root.querySelector("#prompt-trace");
  personas.replaceChildren();
  personas.setAttribute("aria-busy", "false");
  data.personas.forEach((persona, index) => {
    const row = document.createElement("li");
    appendText(row, "span", "", String(index + 1).padStart(2, "0"));
    const copy = document.createElement("div");
    appendText(copy, "strong", "", `${persona.name} · ${persona.role}`);
    appendText(copy, "small", "", persona.summary);
    const details = document.createElement("details");
    const summary = appendText(details, "summary", "", "View Qwen persona prompt");
    summary.setAttribute("aria-label", `${persona.name} Qwen persona prompt`);
    appendText(details, "pre", "persona-prompt", persona.prompt);
    copy.append(details);
    row.append(copy);
    personas.append(row);
  });

  renderPromptTrace(trace, data);
}

// The personas and the prompt trace come from one published file, and before
// this the two panels said the same thing twice — "Demo personas unavailable" /
// "Published prompt trace unavailable", each followed by the identical sentence
// "Refresh the page to retry the static demo data." Two copies of one fact, and
// the only way out of it was reloading the whole page, which also throws away
// the live activity feed beside them.
//
// Each panel now keeps its heading and carries one compact status block instead:
// a chip word, a state heading, and one sentence of its own. The three states
// are told apart by that word and by the glyph geometry `data-shape` selects
// before they are told apart by colour.
//
// `recovery` is what the panel's control is for, held here rather than read back
// off a label. Only a failed request is a recovery — the file is read over the
// network, so a second attempt could genuinely answer. A file that arrived and
// carried nothing is a successful read, and no button is offered for it: a Retry
// that cannot change the answer is a promise the page cannot keep.
export const DEMO_DATA_STATES = Object.freeze({
  loading: Object.freeze({ shape: "loading", chip: "Checking", role: "status", recovery: "none" }),
  empty: Object.freeze({ shape: "empty", chip: "No records", role: "status", recovery: "none" }),
  error: Object.freeze({ shape: "error", chip: "Request failed", role: "alert", recovery: "retry" }),
});

// One entry per panel: where its status goes, which control belongs to it, which
// container it fills, and its own copy. The sentences are per panel on purpose —
// a reader at the prompt trace should not be told about persona profiles.
export const DEMO_DATA_PANELS = Object.freeze([
  Object.freeze({
    key: "personas",
    status: "#persona-status",
    detailId: "persona-status-detail",
    actions: "#persona-actions",
    control: "#retry-personas",
    content: "#persona-list",
    copy: Object.freeze({
      loading: Object.freeze({
        title: "Loading persona profiles",
        detail: "Nothing is needed from you. The profiles come from a static demo file published with this page.",
      }),
      empty: Object.freeze({
        title: "No persona profiles published",
        detail: "The demo file was read and carried no personas — nothing failed, and nothing is hidden. Everything else on this page is unaffected.",
      }),
      error: Object.freeze({
        title: "Persona profiles could not be loaded",
        detail: "The request for the published demo file failed, so no profiles are listed. Nothing in your browser changed, so trying again is safe.",
      }),
    }),
  }),
  Object.freeze({
    key: "trace",
    status: "#trace-status",
    detailId: "trace-status-detail",
    actions: "#trace-actions",
    control: "#retry-trace",
    content: "#prompt-trace",
    copy: Object.freeze({
      loading: Object.freeze({
        title: "Loading the published prompt trace",
        detail: "Nothing is needed from you. The trace comes from the same static demo file as the personas.",
      }),
      empty: Object.freeze({
        title: "No published prompt trace yet",
        detail: "The demo file was read and carried no run to trace. The complete representative trace is still published on its own page, linked above.",
      }),
      error: Object.freeze({
        title: "The published prompt trace could not be loaded",
        detail: "The request for the published demo file failed, so no prompts are shown. The complete representative trace is still published on its own page, linked above.",
      }),
    }),
  }),
]);

export function isRecoverableDemoDataState(state) {
  return DEMO_DATA_STATES[state]?.recovery === "retry";
}

/**
 * Paint the demo-data status for both panels.
 *
 * `ready` is the one state with no status block: the personas and the prompts
 * are then on screen and are their own answer, so a fourth box saying "loaded"
 * would be clutter on the populated page. The block is hidden rather than
 * removed, so the live region it lives in survives the change and the next
 * failure is announced in the same place.
 */
export function renderDemoDataState(root = document, state = "loading") {
  const name = state === "ready" || DEMO_DATA_STATES[state] ? state : "loading";
  const ready = name === "ready";
  const copy = DEMO_DATA_STATES[name] ?? DEMO_DATA_STATES.loading;
  const painted = [];
  for (const panel of DEMO_DATA_PANELS) {
    const block = root.querySelector(panel.status);
    const actions = root.querySelector(panel.actions);
    const control = root.querySelector(panel.control);
    const content = root.querySelector(panel.content);
    content?.setAttribute("aria-busy", String(name === "loading"));
    if (control) control.dataset.recovery = ready ? "none" : copy.recovery;
    if (actions) actions.hidden = ready ? true : copy.recovery !== "retry";
    if (!block) continue;
    block.hidden = ready;
    block.dataset.state = name;
    if (ready) {
      painted.push(block);
      continue;
    }
    // Only a failed read interrupts. A panel that is still reading, or that read
    // a file with nothing in it, is announced politely where it sits.
    block.setAttribute("role", copy.role);
    const words = panel.copy[name];
    const icon = document.createElement("span");
    icon.className = "activity-state-icon";
    icon.dataset.shape = copy.shape;
    icon.setAttribute("aria-hidden", "true");
    const body = document.createElement("div");
    body.className = "activity-state-copy";
    appendText(body, "p", "activity-state-chip", copy.chip);
    appendText(body, "h3", "activity-state-title", words.title);
    const detail = appendText(body, "p", "activity-state-detail", words.detail);
    // The control's aria-describedby names this sentence, so the id has to
    // survive every repaint of the block it lives in.
    detail.id = panel.detailId;
    block.replaceChildren(icon, body);
    painted.push(block);
  }
  return painted;
}

/**
 * Read the published demo file and paint whatever it turns out to be.
 *
 * A file that answered with no personas or no run is `empty`, not `error`, and
 * it never reaches renderDemoData — reading `data.run` out of a payload that has
 * none is how a missing fixture used to become a thrown error and an "unable to
 * load" panel for a request that in fact succeeded.
 */
export async function refreshDemoData(root = document, fetcher = fetch, { retryPanel = null } = {}) {
  renderDemoDataState(root, "loading");
  try {
    const response = await fetcher(DEMO_DATA_URL);
    if (!response.ok) throw new Error(`Demo data returned ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data?.personas) || !data.personas.length || !data?.run) {
      renderDemoDataState(root, "empty");
    } else {
      renderDemoData(root, data);
      renderDemoDataState(root, "ready");
    }
  } catch {
    renderDemoDataState(root, "error");
  }
  // Pressing Retry hides the button the reader was standing on, so a retried
  // read says where focus goes next: the status block that replaced it, which
  // either explains the second failure or is the panel now holding the data.
  if (retryPanel) {
    const panel = DEMO_DATA_PANELS.find(({ key }) => key === retryPanel);
    const status = panel && root.querySelector(panel.status);
    const landing = status?.hidden ? root.querySelector(panel.content) : status;
    landing?.setAttribute?.("tabindex", "-1");
    landing?.focus?.();
  }
}

// Both controls run the same read, and each sits in the panel whose state it
// recovers: the two panels are at opposite ends of the page, and a reader at one
// of them must not have to go looking for the button.
export function wireDemoDataControls(root = document, fetcher) {
  for (const panel of DEMO_DATA_PANELS) {
    root.querySelector(panel.control)?.addEventListener("click",
      () => refreshDemoData(root, fetcher ?? fetch, { retryPanel: panel.key }));
  }
  return () => refreshDemoData(root, fetcher ?? fetch);
}

if (typeof document !== "undefined" && document.querySelector("#activity-list")) {
  const refresh = wireActivityControls();
  const readDemoData = wireDemoDataControls();
  refresh();
  readDemoData();
  setInterval(refresh, REFRESH_MS);
}
