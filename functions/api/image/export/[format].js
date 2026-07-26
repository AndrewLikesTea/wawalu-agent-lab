import { handleImageExportRequest } from "../../../../src/image-export.js";
import { requestIdFor } from "../../../../src/social-edge.js";

export async function onRequest({ request, env }) {
  return handleImageExportRequest(request, {
    requestId: requestIdFor(request),
    images: env.IMAGES,
    log: console,
  });
}
