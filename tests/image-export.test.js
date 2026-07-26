import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_EXPORT_INPUT_BYTES,
  handleImageExportRequest,
  validateExportTransformations,
} from "../src/image-export.js";

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);
const OUTPUT_PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1]);
const OUTPUT_JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1]);

function harness({ pipelineFailure = null, responseStatus = 200 } = {}) {
  const calls = [];
  const logs = [];
  const images = {
    input(bytes) {
      calls.push(["input", bytes]);
      const handle = {
        transform(options) {
          calls.push(["transform", options]);
          return handle;
        },
        output(options) {
          calls.push(["output", options]);
          if (pipelineFailure) throw pipelineFailure;
          const bytes = options.format === "image/png" ? OUTPUT_PNG : OUTPUT_JPEG;
          return {
            response() {
              return new Response(bytes, { status: responseStatus, headers: { "x-pipeline": "images" } });
            },
          };
        },
      };
      return handle;
    },
  };
  const deps = {
    requestId: "export-request-1",
    images,
    log: {
      info(event, details) { logs.push(["info", event, details]); },
      error(event, details) { logs.push(["error", event, details]); },
    },
  };

  function form({ bytes = PNG, type = "image/png", transformations, omitFile = false } = {}) {
    const body = new FormData();
    if (!omitFile) body.set("file", new Blob([bytes], { type }), "input.png");
    if (transformations !== undefined) {
      body.set("transformations", typeof transformations === "string" ? transformations : JSON.stringify(transformations));
    }
    return body;
  }

  function send(format, { method = "POST", body = form(), headers = {} } = {}) {
    return handleImageExportRequest(new Request(`https://labs.wawalu.org/api/image/export/${format}`, {
      method, body: method === "POST" ? body : undefined, headers,
    }), deps);
  }
  return { calls, deps, form, logs, send };
}

test("PNG export applies the bounded editing model and returns attachment bytes", async () => {
  const { send, form, calls, logs } = harness();
  const response = await send("png", {
    body: form({ transformations: { width: 320, height: 200, fit: "cover", rotate: 90 } }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="edited-image.png"');
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-request-id"), "export-request-1");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), OUTPUT_PNG);
  assert.deepEqual(calls.slice(1), [
    ["transform", { width: 320, height: 200, fit: "cover", rotate: 90 }],
    ["output", { format: "image/png", anim: false }],
  ]);
  assert.equal(logs[0][1], "image_export_completed");
  assert.equal(logs[0][2].format, "png");
});

test("JPEG export sets JPEG type and passes output quality to the encoder", async () => {
  const { send, form, calls } = harness();
  const response = await send("jpeg", { body: form({ transformations: { width: 640, quality: 82 } }) });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="edited-image.jpg"');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), OUTPUT_JPEG);
  assert.deepEqual(calls.slice(1), [
    ["transform", { width: 640 }],
    ["output", { format: "image/jpeg", quality: 82, anim: false }],
  ]);
});

test("format, method, media type, and malformed multipart JSON have explicit errors", async () => {
  const { send, form } = harness();

  const format = await send("webp");
  assert.equal(format.status, 400);
  assert.equal((await format.json()).error.code, "invalid_format");

  const method = await send("png", { method: "GET" });
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "POST");

  const media = await send("png", {
    body: JSON.stringify({}),
    headers: { "content-type": "application/json" },
  });
  assert.equal(media.status, 415);

  const malformed = await send("png", { body: form({ transformations: "{" }) });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, "invalid_json");
});

test("missing, empty, oversized, and disguised inputs are rejected without processing", async () => {
  const { send, form, calls } = harness();

  const missing = await send("png", { body: form({ omitFile: true }) });
  assert.equal(missing.status, 422);
  assert.match((await missing.json()).error.fields.file, /single uploaded image/);

  const empty = await send("png", { body: form({ bytes: new Uint8Array() }) });
  assert.equal(empty.status, 422);

  const oversized = new Uint8Array(MAX_EXPORT_INPUT_BYTES + 1);
  oversized.set(PNG);
  const tooLarge = await send("png", { body: form({ bytes: oversized }) });
  assert.equal(tooLarge.status, 413);

  const html = new TextEncoder().encode("<html>not an image</html>");
  const disguised = await send("png", { body: form({ bytes: html, type: "image/png" }) });
  assert.equal(disguised.status, 422);
  assert.equal(calls.length, 0);
});

test("transformation contract rejects unknown, out-of-range, and format-specific fields", async () => {
  const bad = validateExportTransformations({
    width: 0, height: 4097, rotate: 45, fit: "stretch", quality: 80, blur: 2,
  }, "png");
  assert.deepEqual(Object.keys(bad.errors).sort(), ["blur", "fit", "height", "quality", "rotate", "width"]);

  const { send, form, calls } = harness();
  const response = await send("jpeg", { body: form({ transformations: { width: "320" } }) });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "invalid_image_export");
  assert.equal(calls.length, 0);
});

test("pipeline and missing-binding failures are observable and expose no internals", async () => {
  const failed = harness({ pipelineFailure: new Error("decoder exploded with private detail") });
  const response = await failed.send("png");
  assert.equal(response.status, 422);
  const body = await response.text();
  assert.doesNotMatch(body, /private detail|decoder exploded/);
  assert.equal(failed.logs[0][1], "image_export_failed");
  assert.match(failed.logs[0][2].error, /private detail/);

  const unavailable = harness();
  unavailable.deps.images = null;
  const missing = await unavailable.send("jpeg");
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).error.code, "export_unavailable");
  assert.equal(unavailable.logs[0][1], "image_export_unavailable");
});

test("a non-success response from the image pipeline is treated as processing failure", async () => {
  const { send } = harness({ responseStatus: 502 });
  const response = await send("png");
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "image_processing_failed");
});
