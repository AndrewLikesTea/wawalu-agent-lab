const EVENTS_URL = "https://api.github.com/repos/AndrewLikesTea/wawalu-agent-lab/events?per_page=30";
const REFRESH_MS = 90_000;

export function personaFromRef(ref = "") {
  const match = String(ref).match(/(?:refs\/heads\/)?agent\/([^/]+)/);
  return match?.[1]?.replaceAll("-", " ") ?? "team";
}

export function describeEvent(event) {
  const payload = event?.payload ?? {};
  if (event?.type === "PullRequestEvent") {
    const pull = payload.pull_request ?? {};
    return {
      persona: personaFromRef(pull.head?.ref),
      title: pull.title || `Pull request #${pull.number ?? ""}`,
      detail: `${payload.action ?? "updated"} pull request #${pull.number ?? ""}`,
      url: pull.html_url,
    };
  }
  if (event?.type === "PullRequestReviewEvent") {
    const pull = payload.pull_request ?? {};
    return {
      persona: "reviewer",
      title: pull.title || `Pull request #${pull.number ?? ""}`,
      detail: `${payload.review?.state ?? payload.action ?? "reviewed"} the proposed diff`,
      url: payload.review?.html_url || pull.html_url,
    };
  }
  if (event?.type === "PushEvent") {
    const commits = Array.isArray(payload.commits) ? payload.commits : [];
    return {
      persona: personaFromRef(payload.ref),
      title: commits[0]?.message || "Pushed repository changes",
      detail: `${commits.length} ${commits.length === 1 ? "commit" : "commits"} pushed`,
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

export function renderEvents(list, events) {
  list.replaceChildren();
  const visible = events.map((event) => ({ event, item: describeEvent(event) })).filter(({ item }) => item);
  if (!visible.length) {
    appendText(list, "li", "activity-empty", "No recent agent activity is public yet.");
    return 0;
  }
  for (const { event, item } of visible.slice(0, 16)) {
    const row = document.createElement("li");
    row.className = "activity-item";
    appendText(row, "span", "activity-persona", item.persona);
    const copy = document.createElement("div");
    copy.className = "activity-copy";
    const link = appendText(copy, "a", "", item.title);
    link.href = item.url || "https://github.com/AndrewLikesTea/wawalu-agent-lab";
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

export async function loadActivity(root = document, fetcher = fetch) {
  const list = root.querySelector("#activity-list");
  const status = root.querySelector("#activity-status");
  const signal = root.querySelector(".signal-card");
  const label = root.querySelector("#connection-label");
  const updated = root.querySelector("#last-updated");
  status.textContent = "Refreshing public repository activity…";
  try {
    const response = await fetcher(EVENTS_URL, { headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
    const events = await response.json();
    const count = renderEvents(list, Array.isArray(events) ? events : []);
    status.textContent = `${count} relevant events · refreshes every 90 seconds`;
    signal.dataset.connected = "true";
    label.textContent = "Live signal";
    updated.textContent = `Updated ${new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date())}`;
  } catch {
    status.textContent = "Public activity is temporarily unavailable. Existing product data is unaffected.";
    signal.dataset.connected = "false";
    label.textContent = "Signal paused";
    updated.textContent = "Try again shortly";
  }
}

if (typeof document !== "undefined") {
  const refresh = () => loadActivity();
  document.querySelector("#refresh-activity")?.addEventListener("click", refresh);
  refresh();
  setInterval(refresh, REFRESH_MS);
}
