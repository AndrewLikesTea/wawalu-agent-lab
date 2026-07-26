import { performance } from "node:perf_hooks";
import { PixelDocument } from "../src/paint/paint-engine.js";

function median(values) {
  return values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
}

function measure(operation, runs = 7) {
  const samples = [];
  for (let run = 0; run < runs; run += 1) {
    const start = performance.now();
    operation();
    samples.push(performance.now() - start);
  }
  return median(samples);
}

const filterImage = new PixelDocument(1920, 1080);
const filterMs = measure(() => filterImage.filter("grayscale"));
const strokeImage = new PixelDocument(1200, 800);
const strokeMs = measure(() => {
  for (let line = 0; line < 100; line += 1) {
    strokeImage.brushLine(0, line * 8, 1199, line * 8, { color: "#3659e3", size: 8 });
  }
}, 5);

const viewportFrames = 120;
const bitmapBytes = 1920 * 1080 * 4;
const baselineUploadMiB = viewportFrames * bitmapBytes / 1024 / 1024;
const revisionGatedUploadMiB = bitmapBytes / 1024 / 1024;

console.log(JSON.stringify({
  fixture: "Node deterministic pixel core; median, warm process",
  grayscale1080pMs: Number(filterMs.toFixed(2)),
  hundredBrushStrokes1200x800Ms: Number(strokeMs.toFixed(2)),
  unchangedViewportFrames: viewportFrames,
  baselineUploadMiB: Number(baselineUploadMiB.toFixed(2)),
  revisionGatedUploadMiB: Number(revisionGatedUploadMiB.toFixed(2)),
  uploadReductionPercent: Number(((1 - revisionGatedUploadMiB / baselineUploadMiB) * 100).toFixed(2)),
}, null, 2));
