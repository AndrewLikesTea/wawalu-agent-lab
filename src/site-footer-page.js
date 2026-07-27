// The footer's page entry: every page that ships the footer markup loads this,
// the same way it loads its own page module.
//
// It is deliberately the whole of the wiring. The markup is already in the
// document, so a page where this script fails to load still names who operates
// Shiplog and still reads correctly — only the disclosure stops working, and the
// panel it would have opened is hidden until it does.
import { initSiteFooter } from "./site-footer.js";

initSiteFooter();
