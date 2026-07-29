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
export const SITE_NAV = [
  { href: "/", label: "Decisions" },
  { href: "/social.html", label: "Social", className: "nav-social", group: "social" },
  { href: "/profile.html", label: "People", className: "nav-profile", group: "social", subordinate: true },
  { href: "/releases.html", label: "Releases" },
  { href: "/paint/", label: "Paint" },
  { href: "/evolution.html", label: "AI FinOps", className: "nav-evolution" },
  // The prompt coach is a destination, not a panel of AI FinOps: it shares no
  // state with the analysis — no import, no workspace, no seed — and answers the
  // question a visitor arrives with before they have any file to analyse. It
  // sits beside AI FinOps because that is the surface it is closest to, and it
  // is a peer rather than a subordinate because neither one is a view of the
  // other.
  { href: "/coach.html", label: "Prompt coach", className: "nav-coach" },
  { href: "/agents.html", label: "Agent observatory" },
];

export const SITE_NAV_LABELS = SITE_NAV.map((link) => link.label);

// The surface a subordinate destination is a view of, or null for a peer.
export function navParentOf(href) {
  const link = SITE_NAV.find((entry) => entry.href === href);
  if (!link?.subordinate) return null;
  return SITE_NAV.find((entry) => entry.group === link.group && !entry.subordinate)?.href ?? null;
}

// `current` is the href of the surface the reader is on. Detail pages pass the
// surface they belong to — a release detail is still "Releases" — which is how
// the existing pages already mark themselves.
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
    `${indent}<nav class="site-nav" aria-label="Wawalu Labs">`,
    ...lines,
    `${indent}</nav>`,
  ].join("\n");
}
