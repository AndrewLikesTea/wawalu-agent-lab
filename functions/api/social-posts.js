// Exact-path entry for /api/social-posts.
//
// Pages resolves this static route ahead of the ./social-posts/[[route]].js
// catch-all that serves the sub-resources (/:id, /:id/likes, /:id/comments).
// Both must behave identically, so rather than duplicating the wiring this file
// re-exports the catch-all's handler: there is exactly one implementation, and
// no way for the collection endpoint to drift from the rest of the API.

export { onRequest } from "./social-posts/[[route]].js";
