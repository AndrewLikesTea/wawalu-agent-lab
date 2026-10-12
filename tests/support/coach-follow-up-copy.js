// Prompt coach's own follow-up wording (#2802), held in one place for the test
// tables that pin the footer page by page.
//
// The page ships it as static markup, built by siteFooterMarkup() from these
// strings; it is not a constant in src/site-footer.js because that module sits
// on the footer entry graph's byte budget and every other page shares it.
//
// Prompt coach is a separate tool, not part of Shiplog, and its request is sent
// about Prompt coach. So the invitation names it and says "rather than Shiplog",
// because it reads directly below the About Shiplog band's own copy; and the
// offer makes the shared OFFER's two claims about Prompt coach instead.

import { OFFER } from "../../src/site-footer.js";

export const COACH_INVITATION = "Questions about Prompt coach rather than Shiplog? Send the Wawalu team that runs this lab a follow-up request.";

export const COACH_OFFER = OFFER.replace("Whether Shiplog is", "Whether Prompt coach is");
