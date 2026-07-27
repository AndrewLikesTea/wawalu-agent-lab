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

export const SITE_NAV = [
  { href: "/", label: "Decisions" },
  { href: "/social.html", label: "Social", className: "nav-social" },
  { href: "/profile.html", label: "Profile" },
  { href: "/releases.html", label: "Releases" },
  { href: "/paint/", label: "Paint" },
  { href: "/evolution.html", label: "AI FinOps", className: "nav-evolution" },
  { href: "/agents.html", label: "Agent observatory" },
];

export const SITE_NAV_LABELS = SITE_NAV.map((link) => link.label);

// `current` is the href of the surface the reader is on. Detail pages pass the
// surface they belong to — a release detail is still "Releases" — which is how
// the existing pages already mark themselves.
export function siteNavMarkup(current = null, indent = "        ") {
  const links = SITE_NAV.map(({ href, label, className }) => {
    const attributes = [
      className ? `class="${className}"` : null,
      href === current ? 'aria-current="page"' : null,
      `href="${href}"`,
    ].filter(Boolean).join(" ");
    return `${indent}  <a ${attributes}>${label}</a>`;
  });
  return [
    `${indent}<nav class="site-nav" aria-label="Wawalu Labs">`,
    ...links,
    `${indent}</nav>`,
  ].join("\n");
}
