// Exact-path entry for /api/images.
//
// Pages resolves this static route ahead of the ./images/[[route]].js catch-all
// that serves /:id and /:id/content. Both must behave identically, so rather
// than duplicating the wiring this file re-exports the catch-all's handler:
// there is exactly one implementation, and no way for the upload endpoint to
// drift from the reads.

export { onRequest } from "./images/[[route]].js";
