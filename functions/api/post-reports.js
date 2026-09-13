import { createD1SocialPostStore } from '../../src/social-posts-api.js';
import { createD1ReportStore, handleReportRequest } from '../../src/post-reports-api.js';
export function onRequest({ request, env }) {
  return handleReportRequest(request, {
    posts: createD1SocialPostStore(env?.DB),
    reports: createD1ReportStore(env?.DB),
  });
}
