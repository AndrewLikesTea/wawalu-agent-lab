import { handleArchiveRequest } from "../../src/shiplog-archive.js";

// Stateless: no DB binding, credentials, shared records, or tenant lookup.
export const onRequest = ({ request }) => handleArchiveRequest(request);
