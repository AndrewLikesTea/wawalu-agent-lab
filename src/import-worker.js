// The module worker the local import runs in. Deliberately six lines.
//
// Everything it does is in `import-worker-core.js`, which a test drives directly
// through the same message protocol. Keeping the shim this thin means there is
// no behaviour here that only a browser can exercise.

import { createImportWorkerSession } from "./import-worker-core.js";

const session = createImportWorkerSession((message) => self.postMessage(message));

self.addEventListener("message", (event) => session.handle(event.data));
