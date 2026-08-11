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
//
// The order below is DEMOS in src/site-footer.js, destination for destination.
// It used to lead with Decisions while the footer band led with AI FinOps and
// the home page's hero named AI FinOps as where to start, so the two lists of
// the same eight doors disagreed about priority on every page — and the reader
// who read both had no way to tell which one meant it. There is one priority
// here now, stated once at the top of the page and again at the bottom: the
// surfaces that run on a visitor's own material first, the demonstrations after
// them. tests/site-footer.test.js compares the two tables, and the ordering is
// the footer's because that is the list the home page's "start here" points at.
// THE ROW SAYS WHICH DOORS ARE FOR THE READER'S OWN WORK (#1537). Eight names
// in one flat row said nothing about the one difference that decides where a
// visitor should start: four of these surfaces run on material the reader
// brings — a spend export, their own prompts, their own decisions and releases
// — and four are demonstrations on sample data. A reader scanning the row had
// to open a destination to find out which kind it was, and the ones who opened
// Social first concluded the whole site was a demo.
//
// So the row is two named groups now, in the order the site already ranks them:
// the surfaces that run on your own work, then the demonstrations. `set` on
// each destination below says which group it is in, which means a new
// destination cannot be added without deciding — the generator renders nothing
// for a destination whose `set` matches no group.
//
// The names are plain text in the row: no hover, no summary element to open, no
// title attribute, and no screen-reader-only class. A grouping a sighted
// scanning reader cannot see is not the grouping this issue asked for. Each
// group's list carries `aria-labelledby` pointing at its name, so a screen
// reader announces the same two groups rather than one list of eight.
//
// What did not change: the order, the labels, the hrefs, and the tab order. The
// names are spans, so the row still holds exactly eight tab stops.
export const NAV_SETS = [
  { key: "own", id: "nav-set-own", label: "Runs on your own work" },
  { key: "demo", id: "nav-set-demo", label: "Demos, sample data" },
];

export const SITE_NAV = [
  {
    href: "/evolution.html",
    label: "AI FinOps",
    className: "nav-evolution",
    set: "own",
    // One door, and it opens on the answer rather than on the way to it. The
    // page's top is a hero and a five-destination rail, so a reader who clicked
    // "AI FinOps" arrived at a choice; `fragment` lands them on the answer.
    //
    // IT NAMES THE DESTINATION, NOT A REGION INSIDE IT (#1523). This used to be
    // `finops-recoverable-answer`, the id of the band that states the figure.
    // That was a mid-page anchor: it scrolled a reader to one section of a
    // workspace that now shows one destination at a time, and it said nothing
    // about which destination they had arrived in — so the rail could mark the
    // answer while the URL named a band. `#workspace-answer` is the answer
    // destination's own address, the same string the workspace rail's first door
    // carries and the one src/finops-workspace-shell.js resolves, so the link a
    // reader follows from any page and the link they copy back out are one
    // address. The answer band keeps its id and every saved link to it still
    // resolves; what moved is only what this door points at.
    //
    // It stays a rendering detail of this one link, never a second identity for
    // the destination: `href` stays the path, so navCurrentFor(), the footer
    // band, and the home page's destination list keep comparing one string.
    fragment: "workspace-answer",
    // The department screen is AI FinOps read for one department, not a ninth
    // door: it is addressed from the workspace, it carries the same analysis,
    // and a reader who lands on it is still in AI FinOps. It belongs in this
    // list for the same reason the action center and the briefing do.
    section: ["/savings-action-center.html", "/savings-commitment.html", "/executive-briefing.html",
      "/departments.html"],
  },
  // The prompt coach is a destination, not a panel of AI FinOps: it shares no
  // state with the analysis — no import, no workspace, no seed — and answers the
  // question a visitor arrives with before they have any file to analyse. It
  // sits beside AI FinOps because that is the surface it is closest to, and it
  // is a peer rather than a subordinate because neither one is a view of the
  // other.
  { href: "/coach.html", label: "Prompt coach", className: "nav-coach", set: "own", section: ["/personal-history.html"] },
  { href: "/", label: "Decisions", set: "own", section: ["/index.html", "/decision.html", "/workspace.html"] },
  { href: "/releases.html", label: "Releases", set: "own", section: ["/release.html"] },
  { href: "/social.html", label: "Social", className: "nav-social", group: "social", set: "demo", section: ["/post.html"] },
  { href: "/profile.html", label: "People", className: "nav-profile", group: "social", set: "demo", subordinate: true },
  { href: "/paint/", label: "Paint", set: "demo" },
  { href: "/agents.html", label: "Agent observatory", set: "demo", section: ["/agent-trace.html"] },
];

export const SITE_NAV_LABELS = SITE_NAV.map((link) => link.label);

// What a nav item's `href` attribute reads, which is the destination plus the
// in-page region it opens on when it declares one. Everything that reasons about
// *which* destination a link is — the current-item mark, the resolver, the
// footer, the home page's list — uses `href` instead.
export const navHref = (link) => (link.fragment ? `${link.href}#${link.fragment}` : link.href);

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
  const pad = (depth) => `${indent}${"  ".repeat(depth)}`;
  const anchor = (link) => {
    const { href, label, className } = link;
    const attributes = [
      className ? `class="${className}"` : null,
      href === current ? 'aria-current="page"' : null,
      `href="${navHref(link)}"`,
    ].filter(Boolean).join(" ");
    return `<a ${attributes}>${label}</a>`;
  };

  // One list item per destination, so the group's list has the count a screen
  // reader announces. The Social pair is one item: People is a view of Social,
  // not a ninth door, and it keeps the span the stylesheet steps it in with.
  const item = (link, depth) => {
    const children = SITE_NAV.filter((entry) => entry.group && entry.group === link.group && entry.subordinate);
    if (!children.length) return [`${pad(depth)}<li>${anchor(link)}</li>`];
    return [
      `${pad(depth)}<li>`,
      `${pad(depth + 1)}<span class="nav-group">`,
      ...[link, ...children].map((entry) => `${pad(depth + 2)}${anchor(entry)}`),
      `${pad(depth + 1)}</span>`,
      `${pad(depth)}</li>`,
    ];
  };

  // `role="list"` is not redundant: the group lists carry list-style:none, which
  // is enough for Safari to drop the list role and with it the count and the
  // group's announced name.
  const lines = NAV_SETS.flatMap(({ key, id, label }) => [
    `${pad(1)}<div class="nav-set">`,
    `${pad(2)}<span class="nav-set-name" id="${id}">${label}</span>`,
    `${pad(2)}<ul role="list" aria-labelledby="${id}">`,
    ...SITE_NAV.filter((link) => link.set === key && !link.subordinate).flatMap((link) => item(link, 3)),
    `${pad(2)}</ul>`,
    `${pad(1)}</div>`,
  ]);
  return [
    // "Site", not the product name: these pages also carry in-page navigation
    // (the AI FinOps workspace rail) and tab-like controls, and a reader
    // cycling landmarks needs to hear which one leaves the page they are on.
    `${indent}<nav class="site-nav" aria-label="Site">`,
    ...lines,
    `${indent}</nav>`,
  ].join("\n");
}
