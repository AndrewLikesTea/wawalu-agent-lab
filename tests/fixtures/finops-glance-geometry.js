// Executable agreement fixture for the production FinOps glance. It deliberately
// knows only the public figure series and SVG arithmetic: no element identity and
// no renderer internals participate in the comparison.

const GAP = 6;
const WIDTH = 48;
const HEIGHT = 12;
const RANK_ROWS = 4;

const attrs = (node, names) => Object.fromEntries(names.map((name) => [name, node.getAttribute(name)]));
const shapes = (chart, tag) => [...chart.children].filter((node) => node.tagName === tag.toUpperCase());
const num = (value) => String(value);

function expected(figure) {
  const values = figure.series.map(Number);
  if (figure.key === "spendMix") {
    const total = values.reduce((sum, value) => sum + value, 0);
    let x = GAP;
    const fills = values.map((value) => {
      const span = (value / total) * WIDTH;
      const result = { x: num(x), y: "3", width: num(Math.max(0, span - 0.6)), height: "6" };
      x += span;
      return result;
    });
    return { tag: "RECT", count: values.length + 1, coordinates: [
      { x: "6", y: "3", width: "48", height: "6" }, ...fills,
    ] };
  }
  if (figure.key === "departmentRank") {
    const rows = values.slice(0, RANK_ROWS);
    const largest = Math.max(...rows);
    return { tag: "RECT", count: rows.length * 2, coordinates: rows.flatMap((value, index) => {
      const y = index * (HEIGHT / RANK_ROWS) + 0.5;
      return ["48", num((value / largest) * WIDTH)].map((width) => ({
        x: "6", y: num(y), width, height: "2",
      }));
    }) };
  }
  if (figure.key === "movement") {
    const low = Math.min(...values);
    const span = Math.max(...values) - low;
    const x = (index) => GAP + (index * WIDTH) / (values.length - 1);
    const y = (value) => HEIGHT - 1.5 - ((value - low) / span) * (HEIGHT - 3);
    const points = values.map((value, index) => `${x(index)},${y(value)}`).join(" ");
    return { tag: "POLYLINE", count: 1, coordinates: [{ points }], trend:
      values.at(-1) > values[0] ? "up" : "down" };
  }
  const pitch = WIDTH / 4;
  return { tag: "RECT", count: 4, coordinates: [1, 2, 3, 4].map((slot) => ({
    x: num(GAP + (slot - 1) * pitch + 0.6), y: "3", width: num(pitch - 1.2), height: "6",
  })) };
}

export function glanceGeometryViolations(block, glance) {
  const violations = [];
  for (const figure of glance.figures) {
    const chart = block.querySelector(`[data-chart="${figure.key}"]`);
    if (!chart) { violations.push(`${figure.key}: missing chart`); continue; }
    const contract = expected(figure);
    const drawn = shapes(chart, contract.tag);
    if (drawn.length !== contract.count) violations.push(`${figure.key}: shape count ${drawn.length} != ${contract.count}`);
    const names = contract.tag === "POLYLINE" ? ["points"] : ["x", "y", "width", "height"];
    const actual = drawn.map((node) => attrs(node, names));
    if (JSON.stringify(actual) !== JSON.stringify(contract.coordinates)) violations.push(`${figure.key}: coordinates diverged`);
    if (contract.trend) {
      const points = actual[0]?.points?.split(" ") ?? [];
      const firstY = Number(points[0]?.split(",")[1]);
      const lastY = Number(points.at(-1)?.split(",")[1]);
      const actualTrend = lastY < firstY ? "up" : "down";
      if (actualTrend !== contract.trend) violations.push(`${figure.key}: trend ${actualTrend} != ${contract.trend}`);
    }
    if (!chart.parentNode?.textContent.startsWith(figure.line)) violations.push(`${figure.key}: adjacent prose diverged`);
  }
  return violations;
}

export function svgGeometryBytes(block) {
  return [...block.querySelectorAll("svg")].map((chart) => ({
    key: chart.getAttribute("data-chart"),
    shapes: [...chart.children].map((node) => ({ tag: node.tagName, attributes: [...node.attributes.entries()] })),
  })).map((value) => JSON.stringify(value)).join("\n");
}
