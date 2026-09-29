import { initShiplogExport } from "./shiplog-export.js";
import { initHistoryExportCheck } from "./history-export-check.js";

initShiplogExport(document, localStorage);
initHistoryExportCheck(document, localStorage);

import { initShiplogArchive } from "./shiplog-archive-page.js";
initShiplogArchive(document, localStorage);
