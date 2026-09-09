// Copy the rendered brief so shared wording stays in step with the page.
export function bindShiplogEvaluationBrief(doc = globalThis.document,
  clipboard = globalThis.navigator?.clipboard, location = globalThis.location) {
  const brief = doc?.getElementById("shiplog-evaluation-brief-text");
  const button = doc?.getElementById("copy-shiplog-evaluation-brief");
  const status = doc?.getElementById("shiplog-evaluation-brief-status");
  if (!brief || !button || !status) return false;

  // Only the newest press may speak. Two presses race, and a slow first copy
  // settling after a refused second one would otherwise report success for a
  // clipboard that is still empty. The button is NOT disabled while a copy is in
  // flight: disabling a focused control blurs it, and a keyboard buyer who
  // pressed Enter would lose their place on the page mid-copy.
  let press = 0;
  button.addEventListener("click", async () => {
    const current = ++press;
    status.textContent = "";
    try {
      const paragraphs = Array.from(brief.querySelectorAll("h2, p"),
        (node) => node.textContent.replace(/\s+/g, " ").trim());
      const record = brief.querySelector("a");
      const pageUrl = location.href;
      const recordUrl = new URL(record.getAttribute("href"), pageUrl).href;
      const payload = [...paragraphs, `Verification: ${recordUrl}`, `Page: ${pageUrl}`].join("\n\n");
      await clipboard.writeText(payload);
      if (current !== press) return;
      status.textContent = "Shiplog evaluation brief and page link copied.";
    } catch {
      if (current !== press) return;
      status.textContent = "Could not copy the Shiplog evaluation brief. Select the brief above and copy it manually, then add the page URL from your address bar.";
    }
  });
  return true;
}

if (typeof document !== "undefined") bindShiplogEvaluationBrief();
