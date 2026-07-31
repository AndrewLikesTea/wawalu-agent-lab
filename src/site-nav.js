// One definition of the site navigation: one link set, one order, one name per
// destination.
//
// Every page is static HTML and the build copies src/ verbatim, so each page
// embeds the rendered markup instead of asking a script for it — the nav has to
// be readable before any JavaScript runs, and on a page with no module at all.
// This file is still the single source of truth: tests/site-nav.test.js renders
// siteNavMarkup() for every page that carries a <nav class="site-nav"> and
// requires an exact match, so a page cannot quietly drift from the list below
// and a new page cannot ship a nav of its own invention.
//
// Adding a destination means adding it here and re-running that test, which
// names the pages that still disagree.
//
// Within-page destinations (the monthly Savings Action Center, a single post, a
// prompt trace) are not peers of these surfaces and stay out of this list; they
// are linked from the page body that owns them.

// The profile destination is not a peer of Social: it is Social narrowed to the
// image posts of one display name. `group` marks the pair, and `subordinate`
// marks the member that reads as a view of the other, so the markup can nest the
// two and the stylesheet can render the second one step in rather than beside
// it. Both stay ordinary links in the ordinary tab order — this changes what the
// pair looks like, never what a reader can reach.
//
// That destination is "People", not "Profile". This demo has no accounts,
// and a nav item called Profile promises every visitor a page about themselves.
// The stable label also remains true when a deep link or the picker selects a
// persona other than the default, Ari.
//
// `section` lists the paths that belong to a destination without being it: a
// decision detail is still Decisions, an executive briefing is still AI FinOps.
// It is a prefix list, so the query string a detail page actually arrives with
// (/decision.html?id=d-3) belongs to its surface too. The root destination
// carries no prefix of its own on purpose — "/" is a prefix of every path on
// the site, so matching it that way would mark Decisions current everywhere.
export const SITE_NAV = [
  { href: "/", label: "Decisions", section: ["/index.html", "/decision.html", "/workspace.html"] },
  { href: "/social.html", label: "Social", className: "nav-social", group: "social", section: ["/post.html"] },
  { href: "/profile.html", label: "People", className: "nav-profile", group: "social", subordinate: true },
  { href: "/releases.html", label: "Releases", section: ["/release.html"] },
  { href: "/paint/", label: "Paint" },
  {
    href: "/evolution.html",
    label: "AI FinOps",
    className: "nav-evolution",
    section: ["/savings-action-center.html", "/savings-commitment.html", "/executive-briefing.html"],
  },
  // The prompt coach is a destination, not a panel of AI FinOps: it shares no
  // state with the analysis — no import, no workspace, no seed — and answers the
  // question a visitor arrives with before they have any file to analyse. It
  // sits beside AI FinOps because that is the surface it is closest to, and it
  // is a peer rather than a subordinate because neither one is a view of the
  // other.
  { href: "/coach.html", label: "Prompt coach", className: "nav-coach", section: ["/personal-history.html"] },
  { href: "/agents.html", label: "Agent observatory", section: ["/agent-trace.html"] },
];

export const SITE_NAV_LABELS = SITE_NAV.map((link) => link.label);

// The surface a subordinate destination is a view of, or null for a peer.
export function navParentOf(href) {
  const link = SITE_NAV.find((entry) => entry.href === href);
  if (!link?.subordinate) return null;
  return SITE_NAV.find((entry) => entry.group === link.group && !entry.subordinate)?.href ?? null;
}

// Which destination a URL belongs to, by section rather than by string equality
// on the pathname. `/decision.html?id=d-3` is a detail page beneath Decisions
// and marks Decisions current; `/paint/canvas.html` sits under the one
// destination whose href is a directory. Unknown paths mark nothing, which is
// better than marking the front door.
export function navCurrentFor(url) {
  const path = String(url ?? "/").split(/[?#]/)[0] || "/";
  const owns = (link) => {
    if (path === link.href) return true;
    if (link.href.endsWith("/") && link.href !== "/") return path.startsWith(link.href);
    return (link.section ?? []).some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  };
  // Longest section prefix first, so a page nested under two destinations is
  // claimed by the more specific one rather than by list order.
  const match = [...SITE_NAV]
    .sort((a, b) => b.href.length - a.href.length)
    .find(owns);
  return match?.href ?? null;
}

// `current` is the href of the surface the reader is on — normally
// navCurrentFor(location.pathname), resolved when the page is authored because
// every page here ships static markup. Detail pages resolve to the surface they
// belong to: a release detail is still "Releases".
export function siteNavMarkup(current = null, indent = "        ") {
  const anchor = ({ href, label, className }, depth) => {
    const attributes = [
      className ? `class="${className}"` : null,
      href === current ? 'aria-current="page"' : null,
      `href="${href}"`,
    ].filter(Boolean).join(" ");
    return `${indent}${"  ".repeat(depth)}<a ${attributes}>${label}</a>`;
  };

  const lines = [];
  for (let index = 0; index < SITE_NAV.length; index += 1) {
    const link = SITE_NAV[index];
    if (link.subordinate) continue;
    const children = SITE_NAV.filter((entry) => entry.group && entry.group === link.group && entry.subordinate);
    if (!children.length) {
      lines.push(anchor(link, 1));
      continue;
    }
    lines.push(`${indent}  <span class="nav-group">`);
    lines.push(anchor(link, 2), ...children.map((child) => anchor(child, 2)));
    lines.push(`${indent}  </span>`);
  }
  return [
    // "Site", not the product name: these pages also carry in-page navigation
    // (the AI FinOps workspace rail) and tab-like controls, and a reader
    // cycling landmarks needs to hear which one leaves the page they are on.
    `${indent}<nav class="site-nav" aria-label="Site">`,
    ...lines,
    `${indent}</nav>`,
  ].join("\n");
}
