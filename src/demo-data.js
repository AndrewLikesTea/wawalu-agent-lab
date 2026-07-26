// One source for representative product data across the decision and release
// views. The records are examples, not customer or Wawalu operational data.
export async function fetchDemoData() {
  try {
    const response = await fetch("/releases-demo-data.json", { cache: "no-store" });
    if (!response.ok) return { decisions: [], releases: [], unavailable: true };
    const data = await response.json();
    return {
      decisions: Array.isArray(data.decisions) ? data.decisions : [],
      releases: Array.isArray(data.releases) ? data.releases : [],
      unavailable: false,
    };
  } catch {
    return { decisions: [], releases: [], unavailable: true };
  }
}

export function dedupeById(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
