// Cloudflare Pages Function mounting image uploads and image bytes at
// /api/social-media[/**]. Same dependency graph as the posts route -- an image
// and the post that carries it are one model, so they share one wiring.
//
// Bindings are documented in ../social-posts/[[route]].js and remain
// operations-owned. `SOCIAL_MEDIA_BUCKET` is optional: bound, image bytes live
// in R2; unbound, they live in the bounded `social_media_blobs` D1 table. The
// stored key is identical either way, so the switch is a copy, not a migration.

import { hasStorage, requestIdFor, socialDependencies, storageUnavailable } from "../../../src/social-edge.js";
import { handleSocialMediaRequest } from "../../../src/social-posts-api.js";

export async function onRequest({ request, env }) {
  const requestId = requestIdFor(request);
  if (!hasStorage(env)) return storageUnavailable(requestId);
  return handleSocialMediaRequest(request, socialDependencies(env, requestId));
}
