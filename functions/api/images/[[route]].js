// Cloudflare Pages Function mounting the shared image store at /api/images[/**]
// (upload, metadata, and bytes).
//
// Bindings are operations-owned and documented in src/bindings.js. `DB` is
// required; `SOCIAL_MEDIA_BUCKET` is optional and shared with the social feed --
// bound, image bytes live in R2 and the endpoint accepts its full 5 MB ceiling;
// unbound, bytes fall back to the bounded inline D1 table and the endpoint says
// so in its 413. The stored key is identical either way, so moving between them
// is a copy, not a migration.

import { hasStorage, imageDependencies, requestIdFor, storageUnavailable } from "../../../src/social-edge.js";
import { handleImagesRequest } from "../../../src/images-api.js";

export async function onRequest({ request, env }) {
  const requestId = requestIdFor(request);
  if (!hasStorage(env)) return storageUnavailable(requestId);
  return handleImagesRequest(request, imageDependencies(env, requestId));
}
