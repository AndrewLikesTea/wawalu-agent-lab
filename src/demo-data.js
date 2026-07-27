// Composition helper shared by every view that merges the visitor's records
// with the representative examples. The examples themselves live in
// seed-records.js as module constants; nothing is fetched here any more, so a
// list or detail view can be resolved during the first render.
export function dedupeById(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
