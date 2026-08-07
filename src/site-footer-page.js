// The footer's page entry: every page that ships the footer markup loads this,
// the same way it loads its own page module.
//
// It is deliberately the whole of the wiring. The markup is already in the
// document, so a page where this script fails to load still names who operates
// Shiplog and still reads correctly — only the disclosure stops working, and the
// panel it would have opened is hidden until it does.
//
// It wires every copy of the follow-up surface a page ships: the footer's, and
// the home page's second one under the recoverable-spend figure. Where a copy
// is absent, initSiteFooter binds nothing.
import { HOME_FOLLOW_UP, initSiteFooter } from "./site-footer.js";

initSiteFooter();
initSiteFooter(document, undefined, { prefix: HOME_FOLLOW_UP.prefix });
