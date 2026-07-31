import { renderState } from "./state-ui.js";

// The team now iterates on an external product (paint-lab); the lab repo still
// carries runner and process activity, so the observatory watches both.
// Exported so the headline figure's verification links can be pinned to the
// exact responses the page requests, rather than drifting from them.
export const EVENTS_URLS = [
  "https://api.github.com/repos/AndrewLikesTea/paint-lab/events?per_page=30",
  "https://api.github.com/repos/AndrewLikesTea/wawalu-agent-lab/events?per_page=30",
];
const REFRESH_MS = 90_000;
const DEMO_DATA_URL = "/agent-demo-data.json";
// The last count that was actually taken from the responses above, published
// with the page as a static same-origin file — the same way every other durable
// value on this site is stored and read. Nothing writes it in the browser:
// scripts/record-merged-count.mjs is the only writer, and it writes only after
// GitHub has answered.
export const RECORDED_COUNT_URL = "/merged-pull-request-count.json";
// This small, code-owned example keeps the observatory useful when its
// published JSON cannot be read. It deliberately contains no fetched activity,
// customer material, private-repository content, or hidden instructions.
export const SYNTHETIC_FALLBACK_DATA = Object.freeze({
  personas: Object.freeze([
    Object.freeze({
      name: "Sam", role: "Manager", summary: "Scopes the outcome and sequences the handoff.",
      prompt: "Synthetic summary: turn the outcome into bounded, testable work and make dependencies explicit.",
    }),
    Object.freeze({
      name: "Mina", role: "Frontend engineer", summary: "Builds the accessible, responsive product surface.",
      prompt: "Synthetic summary: implement the smallest resilient interface and verify its interaction states.",
    }),
    Object.freeze({
      name: "Tess", role: "QA engineer", summary: "Turns user-visible failure modes into repeatable checks.",
      prompt: "Synthetic summary: test the important flow, including empty, unavailable, retry, and keyboard behavior.",
    }),
    Object.freeze({
      name: "Marcus", role: "Independent reviewer", summary: "Reviews privacy, accessibility, correctness, and scope.",
      prompt: "Synthetic summary: compare the implementation and evidence with the acceptance criteria before delivery.",
    }),
  ]),
  run: Object.freeze({
    personaName: "Mina",
    personaRole: "Frontend engineer",
    scenarioTitle: "Keep the observatory useful when data is unavailable",
    worker: "Codex",
    qwenPlanningPrompt: "Synthetic planning summary: preserve a useful team view, explicit data boundaries, and recovery controls.",
    qwenHandoff: "Synthetic handoff: build labelled fallback personas and a representative trace without presenting either as live activity.",
    workerPrompt: "Synthetic worker summary: implement accessible unavailable and retry states, trace navigation, and focused automated tests.",
    qwenReview: "Synthetic review summary: verify disclosure, separation from public GitHub activity, keyboard recovery, and the return route.",
  }),
});
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

// The hero card at the top of the page: one line for how the check stands, one
// for when data last arrived. It is read before the panel below it and must not
// repeat the panel's heading, so it stays short — but "Checking" alone left the
// reader to guess what was being checked, and "Synthetic example shown" left out
// that GitHub had in fact answered. Each label now names the check, and the two
// states that always show the four synthetic rows say so here as well, for a
// reader who never scrolls as far as the banner above them. The failed check is
// the exception: it can keep the last live events on screen, so it reports the
// failure and lets the panel say what the rows are.
export const CONNECTION_LABELS = Object.freeze({
  loading: "Checking GitHub",
  live: "Live signal",
  empty: "No GitHub events · synthetic example",
  error: "GitHub check failed",
});

// --- The one real number on this page --------------------------------------
//
// Everything else this observatory shows about "the team" is a labelled
// synthetic example. This figure is not: every number this slot can show was
// counted from a public GitHub events response, from nothing else. There is no
// estimate, no extrapolation, and no zero standing in for a failed request.
//
// What changed, and why: the page requests that response unauthenticated, so a
// prospect is routinely rate-limited, and the slot used to answer that with
// "Counting…" or a sentence — a spinner where the one repeatable proof number
// belongs. It now has three states, each readable from the rendered page alone:
//
//   live         GitHub answered. This response's count, and no recorded date.
//   recorded     GitHub did not answer. The last count that was taken from it,
//                with the date it was taken shown as text beside the number.
//   unavailable  GitHub did not answer and no count has ever been recorded. One
//                sentence, no digit.
//
// The recorded count is a durable record, not a remembered render: it is read
// from RECORDED_COUNT_URL, and only scripts/record-merged-count.mjs writes it,
// only from a response GitHub actually returned. A stale number is therefore
// always dated, and an undated number can only ever be a live one.
//
// It says "merged pull requests" because the response can actually tell a merge
// apart: a PullRequestEvent closed with `pull_request.merged === true` is a
// merge, and a close without it is not. The scope the number is counted over is
// stated with it rather than implied, because the events endpoint returns a
// window of recent events and not the repository's whole history.

/** The repositories the figure is counted from, read off the URLs we request. */
export const SOURCE_REPOSITORIES = EVENTS_URLS.map(
  (url) => new URL(url).pathname.split("/").slice(2, 4).join("/"),
);

// Every synthetic record this page can reach, named here so excluding them is a
// decision in the code and not an accident of where the count happens to be
// called: the four representative activity rows, the built-in persona and run
// fallback, and the personas and run read from /agent-demo-data.json. None of
// them is public GitHub activity, so none of them may reach the count.
const SYNTHETIC_RECORDS = new Set([
  ...REPRESENTATIVE_ACTIVITY,
  ...SYNTHETIC_FALLBACK_DATA.personas,
  SYNTHETIC_FALLBACK_DATA.run,
]);
// The demo file is fetched, so its records are copies rather than the frozen
// objects above and identity alone would not catch them. These keys belong to
// persona, run, and representative-step records; a GitHub event carries none of
// them.
const SYNTHETIC_RECORD_KEYS = ["persona", "prompt", "phase", "personaName", "scenarioTitle"];

/**
 * The records from a batch that are live public GitHub events.
 *
 * A countable record has to be an event GitHub sent — an object with an event
 * `type` and a `created_at` — and must be none of the synthetic material above.
 */
export function liveGithubEvents(records = []) {
  const batch = Array.isArray(records) ? records : [];
  return batch.filter((record) => (
    record !== null && typeof record === "object"
    && !SYNTHETIC_RECORDS.has(record)
    && !SYNTHETIC_RECORD_KEYS.some((key) => key in record)
    && typeof record.type === "string" && Boolean(record.created_at)
  ));
}

/** Merged pull requests among live public GitHub events. Merges only. */
export function countMergedPullRequests(records = []) {
  return liveGithubEvents(records).filter((event) => (
    event.type === "PullRequestEvent"
    && event.payload?.action === "closed"
    && event.payload?.pull_request?.merged === true
  )).length;
}

/**
 * When the response the figure was computed from arrived.
 *
 * GitHub stamps every response with its own `Date` header; when it is there,
 * that is the response's time and beats ours. `receivedAt` is read once on the
 * fetch path, the moment the responses resolved — never at render time, so a
 * repaint cannot quietly age the figure's provenance.
 */
export function responseTimestamp(responses = [], receivedAt) {
  for (const response of responses) {
    const stamped = new Date(response?.headers?.get?.("date") ?? NaN);
    if (!Number.isNaN(stamped.getTime())) return stamped;
  }
  return receivedAt;
}

const formatClockTime = (date) => new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(date);
// The recorded count's date, as the calendar date it was taken on. ISO-8601,
// not a locale format: it is the same string the record itself holds, so what a
// reader sees and what the file says cannot drift, and it stays unambiguous for
// a reader who is not in the writer's locale.
export const formatRecordedDate = (date) => date.toISOString().slice(0, 10);

/**
 * A recorded count, or `null` when nothing has ever been recorded.
 *
 * "Never recorded" is a state of its own, so it is `null` here and never a zero
 * or an empty string: a count of 0 is a real answer GitHub can give, and the
 * two must not collapse into each other. A record is only usable when it
 * carries both halves — a whole non-negative count, and the timestamp that
 * count was taken at — because a number this page cannot date is a number it
 * may not show.
 */
export function parseRecordedCount(payload) {
  const count = payload?.count;
  const takenAt = payload?.takenAt;
  if (!Number.isInteger(count) || count < 0 || typeof takenAt !== "string") return null;
  const taken = new Date(takenAt);
  if (Number.isNaN(taken.getTime())) return null;
  return { count, takenAt: taken };
}

/**
 * Read the published record. Never throws and never rejects: this is the path
 * that exists because the other one failed, so its own failure is simply "no
 * record", which the page already knows how to say.
 */
export async function readRecordedCount(fetcher = fetch) {
  try {
    const response = await fetcher(RECORDED_COUNT_URL);
    if (!response?.ok) return null;
    return parseRecordedCount(await response.json());
  } catch {
    return null;
  }
}

export const MERGED_FIGURE_COPY = Object.freeze({
  loading: Object.freeze({
    value: "Counting…",
    source: "Counted from public GitHub activity, once GitHub answers.",
  }),
  // One plain sentence, and deliberately no second one: this is the state where
  // there is nothing to qualify. It renders alone, so the slot holds a sentence
  // and the verification links, and no dash, blank, or zero standing in for a
  // number that does not exist.
  unavailable: Object.freeze({
    value: "Public GitHub activity did not answer, and no count has been recorded from it yet.",
    source: "",
  }),
});

/** The count and unit, the two of them always rendered together. */
function appendCount(value, count) {
  appendText(value, "strong", "merged-figure-count", String(count));
  appendText(value, "span", "merged-figure-unit", `merged pull ${count === 1 ? "request" : "requests"}`);
}

/**
 * Paint the headline figure.
 *
 * `live` and `recorded` render a digit, each beside the words for exactly what
 * that count is and where it came from. They are told apart by text, not by
 * styling: only `recorded` carries a date, and it always carries one, so "this
 * number is from today's response" and "this number is from the 14th" are two
 * different sentences rather than the same sentence in two colours. `loading`
 * and `unavailable` are sentences with no number in them at all.
 *
 * Only the readout is replaced. It is the live region, so one load makes one
 * announcement, and the heading and the verification links above and below it
 * stay put and stay keyboard-reachable through every state — including both
 * fallbacks, where a reader most needs to check the source by hand.
 */
export function renderMergedFigure(root = document, state = "loading",
  { count = 0, total = 0, asOf = null, takenAt = null } = {}) {
  // A count with no response time behind it cannot be sourced, and an unsourced
  // number is not one this slot may show — so it falls to the empty state rather
  // than rendering a figure the line beneath it could not account for. A record
  // is held to the same rule, plus a whole count: a half-written record is not a
  // number either. Anything unrecognised falls the same way, never to a number.
  const sourced = asOf instanceof Date && !Number.isNaN(asOf.getTime());
  const dated = takenAt instanceof Date && !Number.isNaN(takenAt.getTime())
    && Number.isInteger(count) && count >= 0;
  const name = state === "loading" ? "loading"
    : state === "live" && sourced ? "live"
      : state === "recorded" && dated ? "recorded"
        : "unavailable";
  const section = root.querySelector("#merged-figure");
  const readout = root.querySelector("#merged-figure-readout");
  if (!section || !readout) return null;
  section.dataset.state = name;

  const value = document.createElement("p");
  value.className = "merged-figure-value";
  const source = document.createElement("p");
  source.className = "merged-figure-source";

  if (name === "live") {
    appendCount(value, count);
    appendText(source, "span", "", `Counted from ${total} public GitHub ${total === 1 ? "event" : "events"} in `
      + `${SOURCE_REPOSITORIES.join(" and ")}, as of `);
    const time = appendText(source, "time", "merged-figure-time", formatClockTime(asOf));
    time.dateTime = asOf.toISOString();
  } else if (name === "recorded") {
    appendCount(value, count);
    appendText(source, "span", "", "Public GitHub activity did not answer just now, so this is the last count "
      + `taken from ${SOURCE_REPOSITORIES.join(" and ")}, as of `);
    const date = appendText(source, "time", "merged-figure-recorded-date", formatRecordedDate(takenAt));
    date.dateTime = takenAt.toISOString();
  } else {
    value.textContent = MERGED_FIGURE_COPY[name].value;
    source.textContent = MERGED_FIGURE_COPY[name].source;
  }
  // The empty state's sentence stands alone rather than trailing an empty
  // paragraph, so what is on screen is one sentence and not a sentence and a gap.
  readout.replaceChildren(...(source.textContent ? [value, source] : [value]));
  return section;
}

/**
 * The figure when GitHub did not answer: the recorded count if one exists, and
 * otherwise the one sentence saying none does. Both keep the verification links
 * beside them, and neither of them is a spinner.
 */
function renderFallbackFigure(root, recorded) {
  return recorded
    ? renderMergedFigure(root, "recorded", recorded)
    : renderMergedFigure(root, "unavailable");
}

/**
 * Paint a record that has just arrived, if it is still the best thing to show.
 *
 * The two no-number states are what it may replace: `loading`, which is the
 * whole point — a rate-limited reader gets the dated count while the live
 * request is still in flight, instead of a spinner — and `unavailable`, which is
 * what a live request that failed before the record arrived leaves behind. It
 * never replaces a live count, and never replaces a record with itself.
 */
function paintRecordedFigure(root, record) {
  if (!record) return null;
  const state = root.querySelector("#merged-figure")?.dataset.state;
  if (state !== "loading" && state !== "unavailable") return null;
  return renderMergedFigure(root, "recorded", record);
}

export async function loadActivity(root = document, fetcher = fetch) {
  const list = root.querySelector("#activity-list");
  const signal = root.querySelector(".signal-card");
  const label = root.querySelector("#connection-label");
  const updated = root.querySelector("#last-updated");
  const hasLiveEvents = Boolean(list.querySelector?.(".activity-item:not(.activity-item-representative)"));
  renderActivityState(root, "loading", { keptEvents: hasLiveEvents });
  // Unconditionally, even on a refresh that keeps the events below on screen:
  // the previous count belongs to the previous response, and holding it there
  // while a new request is in flight would make a stale number look current. It
  // is the state's only undated number, so it may not outlive its response —
  // what replaces it below is either the next response's count or a dated one.
  renderMergedFigure(root, "loading");
  label.textContent = CONNECTION_LABELS.loading;
  if (!hasLiveEvents) {
    renderRepresentativeActivity(list, { reason: "loading" });
    updated.textContent = "Not updated yet";
  }
  // The record is requested first and awaited by nothing on this path. It is a
  // static same-origin file that cannot be rate-limited, so it normally lands
  // long before GitHub's unauthenticated feed and the reader gets the dated
  // count while the live request is still in flight, rather than a spinner that
  // is about to fail. Not awaiting it is deliberate in the other direction too:
  // this one file must never be able to hold up the live count, the activity
  // rows, or the status card, however slowly it answers. `recorded` is therefore
  // read as "the record, if it is here yet", and the paint below catches up the
  // case where it was not.
  let recorded = null;
  readRecordedCount(fetcher).then((record) => {
    recorded = record;
    paintRecordedFigure(root, record);
  });
  try {
    const responses = await Promise.all(EVENTS_URLS.map(
      (url) => fetcher(url, { headers: { Accept: "application/vnd.github+json" } }),
    ));
    // The moment this response arrived, taken once here rather than at render.
    const receivedAt = new Date();
    if (!responses.some((response) => response.ok)) throw new Error(`GitHub returned ${responses[0].status}`);
    const payloads = await Promise.all(responses.map((response) => (response.ok ? response.json() : [])));
    const events = payloads
      .flatMap((payload) => (Array.isArray(payload) ? payload : []))
      .sort((a, b) => new Date(b.created_at ?? 0) - new Date(a.created_at ?? 0))
      .slice(0, 30);
    // Only the live records are countable, and a response that carried none of
    // them is not a zero — it is nothing to count from, which is the empty
    // headline, not a figure a reader could mistake for a real one.
    const asOf = responseTimestamp(responses, receivedAt);
    const countable = liveGithubEvents(events);
    if (countable.length) {
      renderMergedFigure(root, "live", {
        count: countMergedPullRequests(countable), total: countable.length, asOf,
      });
    } else {
      // A response that carried nothing countable is not a live count, so the
      // slot falls back rather than showing a zero this response did not say.
      renderFallbackFigure(root, recorded);
    }
    const count = renderEvents(list, events);
    if (count) {
      list.setAttribute("aria-label", "Recent public GitHub events");
      renderActivityState(root, "live", { count });
      label.textContent = CONNECTION_LABELS.live;
    } else {
      renderRepresentativeActivity(list, { reason: "empty" });
      renderActivityState(root, "empty");
      label.textContent = CONNECTION_LABELS.empty;
    }
    signal.dataset.connected = "true";
    // The card and the figure below it report the same response, so they read
    // the same arrival time in the same format rather than two clocks.
    updated.textContent = `Updated ${formatClockTime(asOf)}`;
  } catch {
    renderActivityState(root, "error", { keptEvents: hasLiveEvents });
    renderFallbackFigure(root, recorded);
    signal.dataset.connected = "false";
    label.textContent = CONNECTION_LABELS.error;
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

export function renderDemoData(root, data, { fallback = false } = {}) {
  const personas = root.querySelector("#persona-list");
  const trace = root.querySelector("#prompt-trace");
  personas.replaceChildren();
  personas.setAttribute("aria-busy", "false");
  personas.dataset.source = fallback ? "synthetic-fallback" : "published-demo";
  personas.setAttribute("aria-label", fallback ? "Synthetic fallback persona summary" : "Published synthetic persona profiles");
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
  trace.dataset.source = fallback ? "synthetic-fallback" : "published-demo";
  trace.setAttribute("aria-label", fallback ? "Synthetic fallback representative handoff" : "Published representative prompt trace");
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
        detail: "The demo file was read and carried no personas — nothing failed, and nothing is hidden. The clearly labelled profiles below are a built-in synthetic fallback.",
      }),
      error: Object.freeze({
        title: "Persona profiles could not be loaded",
        detail: "The published demo file is unavailable. The profiles below are a built-in synthetic fallback, not customer or private-repository activity; trying again is safe.",
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
        detail: "The demo file carried no run. A built-in synthetic handoff is shown below and on the representative trace page linked above.",
      }),
      error: Object.freeze({
        title: "The published prompt trace could not be loaded",
        detail: "The published demo file is unavailable. The handoff below is a built-in synthetic fallback, not customer or private-repository activity; its full-page route remains available above.",
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
      renderDemoData(root, SYNTHETIC_FALLBACK_DATA, { fallback: true });
      renderDemoDataState(root, "empty");
    } else {
      renderDemoData(root, data);
      renderDemoDataState(root, "ready");
    }
  } catch {
    renderDemoData(root, SYNTHETIC_FALLBACK_DATA, { fallback: true });
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
