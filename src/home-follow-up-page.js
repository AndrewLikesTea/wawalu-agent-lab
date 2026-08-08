// The home page's follow-up entry, the same shape as src/site-footer-page.js:
// the markup is already in the document, so a page where this script fails to
// load still reads correctly — the panel stays hidden and its button does
// nothing, which is why the button is the only control outside the panel.
import { initHomeFollowUp } from "./home-follow-up.js";

initHomeFollowUp();
