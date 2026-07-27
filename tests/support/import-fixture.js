// Deterministic synthetic exports, generated at test time.
//
// Nothing is committed. A multi-megabyte CSV in the repository is a file nobody
// reviews, that every clone pays for, and that drifts from the parser it was
// meant to exercise. A seeded generator costs milliseconds, reproduces exactly
// across machines, and can be resized by a caller without a new artifact.
//
// The seed drives a small LCG rather than Math.random, so two runs of the same
// suite build byte-identical files and a perf regression is a real one.

/** Numerical Recipes LCG. Not a random source; a reproducible one. */
function sequence(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const MODELS = ["claude-sonnet-4", "claude-haiku-4", "claude-opus-4"];

function isoDay(index) {
  return new Date(Date.UTC(2026, 0, 1) + index * 86_400_000).toISOString().slice(0, 10);
}

/**
 * An Anthropic-shaped usage export with `rows` data records.
 *
 * The cardinality of the aggregation is fixed by `days` × `units` × the model
 * set collapsing into one service category, so the *retained* summary stays the
 * same size no matter how many rows are generated. That is exactly the property
 * the retention assertion needs: growth in input with no growth in output.
 */
export function syntheticProviderCsv({ rows, days = 30, units = 8, seed = 20_260_726 } = {}) {
  const next = sequence(seed);
  const lines = ["Usage Day,Workspace,Model,Cost USD,Currency,Input Tokens,Output Tokens"];
  for (let index = 0; index < rows; index += 1) {
    const day = isoDay(index % days);
    const unit = `Unit ${String(index % units).padStart(2, "0")}`;
    const model = MODELS[Math.floor(next() * MODELS.length) % MODELS.length];
    const cost = (next() * 40 + 0.01).toFixed(2);
    const input = Math.floor(next() * 200_000);
    const output = Math.floor(next() * 40_000);
    lines.push(`${day},${unit},${model},${cost},USD,${input},${output}`);
  }
  return `${lines.join("\n")}\n`;
}

/** A roster covering the same units, for pair-completing tests. */
export function syntheticRosterCsv({ units = 8 } = {}) {
  const lines = ["Department,Parent,Unit Type,Active", "Wawalu Labs,,company,true"];
  for (let index = 0; index < units; index += 1) {
    lines.push(`Unit ${String(index).padStart(2, "0")},Wawalu Labs,department,true`);
  }
  return `${lines.join("\n")}\n`;
}

/** A File the import path can stream, from text generated above. */
export function fileOf(text, name, type = "text/csv") {
  return new File([text], name, { type });
}

/**
 * A File stand-in whose stream arrives in fixed-size chunks.
 *
 * Node's `Blob.stream()` hands the whole blob over in a single chunk, which a
 * browser's does not: there, an 8 MB pick arrives over many reads. A test that
 * used the Node behaviour would only ever see one progress event and could never
 * cancel between two of them — it would be asserting on the platform rather than
 * on the import. This yields `chunkBytes` at a time so the cadence, the
 * incremental guard, and the cancel boundaries are all reachable and repeatable.
 *
 * Everything the import path touches is present: `name`, `type`, `size`, and
 * `stream()`. It touches nothing else.
 */
export function chunkedFile(text, name, { type = "text/csv", chunkBytes = 65_536 } = {}) {
  const bytes = new TextEncoder().encode(text);
  return {
    name,
    type,
    size: bytes.byteLength,
    stream() {
      let offset = 0;
      return new ReadableStream({
        pull(controller) {
          if (offset >= bytes.byteLength) {
            controller.close();
            return;
          }
          controller.enqueue(bytes.subarray(offset, offset + chunkBytes));
          offset += chunkBytes;
        },
      });
    },
  };
}
