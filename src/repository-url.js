// The public repository this site is built from, written down once.
//
// It was a constant inside src/deployed-release.js, where the release record
// composes commit permalinks from it. A second consumer now needs the bare
// address — the footer's follow-up failure state, which offers it as the one
// route to the team that does not run through the transport that just failed —
// and that module ships in every page's initial payload. Importing the release
// record there would put 8.6 KiB of release-shaped code on every page of the
// site to read one string, so the string lives here and the release record
// re-exports it. There is still exactly one definition.
export const REPOSITORY_URL = "https://github.com/AndrewLikesTea/wawalu-agent-lab";
