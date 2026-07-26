import test from "node:test";
import assert from "node:assert/strict";
import {
  fitBitmapSize,
  FRAME_BUDGET_MS,
  MAX_BITMAP_BYTES,
  parseColor,
  PixelDocument,
  WebGLPresenter,
} from "../src/paint/paint-engine.js";

test("golden: rectangle compositing produces exact sRGB bytes", () => {
  const image = new PixelDocument(4, 3);
  image.rectangle(0, 0, 3, 2, { color: "#ff0000", size: 1 });
  assert.deepEqual(Array.from(image.pixels), [
    255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255,
    255, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 255,
    255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255,
  ]);
});

test("golden: source-over brush alpha is deterministic", () => {
  const image = new PixelDocument(3, 3);
  image.brushLine(1, 1, 1, 1, { color: "#00000080", size: 1 });
  assert.deepEqual(image.pixel(1, 1), [127, 127, 127, 255]);
  assert.deepEqual(image.pixel(0, 0), [255, 255, 255, 255]);
});

test("golden: filters use defined sRGB channel transforms", () => {
  const source = new Uint8ClampedArray([100, 150, 200, 255]);
  const grayscale = new PixelDocument(1, 1, source);
  grayscale.filter("grayscale");
  assert.deepEqual(Array.from(grayscale.pixels), [143, 143, 143, 255]);
  const sepia = new PixelDocument(1, 1, source);
  sepia.filter("sepia");
  assert.deepEqual(Array.from(sepia.pixels), [192, 171, 134, 255]);
  const invert = new PixelDocument(1, 1, source);
  invert.filter("invert");
  assert.deepEqual(Array.from(invert.pixels), [155, 105, 55, 255]);
});

test("golden: crop and nearest-neighbor resize preserve exact source pixels", () => {
  const pixels = new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 255, 255,
  ]);
  const image = new PixelDocument(2, 2, pixels);
  image.crop(1, 0, 1, 2);
  assert.deepEqual(Array.from(image.pixels), [0, 255, 0, 255, 255, 255, 255, 255]);
  image.resize(2, 2);
  assert.deepEqual(Array.from(image.pixels), [
    0, 255, 0, 255, 0, 255, 0, 255,
    255, 255, 255, 255, 255, 255, 255, 255,
  ]);
});

test("bitmap sizing degrades proportionally under a fixed memory ceiling", () => {
  assert.equal(MAX_BITMAP_BYTES, 64 * 1024 * 1024);
  assert.deepEqual(fitBitmapSize(4000, 4000), { width: 4000, height: 4000, scale: 1, degraded: false });
  const fitted = fitBitmapSize(12000, 8000);
  assert.equal(fitted.degraded, true);
  assert.ok(fitted.width * fitted.height * 4 <= MAX_BITMAP_BYTES);
  assert.ok(Math.abs(fitted.width / fitted.height - 1.5) < .001);
  assert.equal(FRAME_BUDGET_MS, 1000 / 60);
});

test("colors reject ambiguous input and support explicit alpha", () => {
  assert.deepEqual(parseColor("#123456"), [18, 52, 86, 255]);
  assert.deepEqual(parseColor("#12345680"), [18, 52, 86, 128]);
  assert.deepEqual(parseColor("red"), [0, 0, 0, 255]);
});

function mockWebGL() {
  const calls = [];
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, TEXTURE_2D: 8,
    TEXTURE_MIN_FILTER: 9, TEXTURE_MAG_FILTER: 10, LINEAR: 11,
    TEXTURE_WRAP_S: 12, TEXTURE_WRAP_T: 13, CLAMP_TO_EDGE: 14,
    UNPACK_COLORSPACE_CONVERSION_WEBGL: 15, NONE: 0, RGBA: 16,
    UNSIGNED_BYTE: 17, TRIANGLES: 18,
  };
  for (const name of ["createShader", "createProgram", "createBuffer", "createTexture"]) gl[name] = () => ({});
  for (const name of ["shaderSource", "compileShader", "attachShader", "linkProgram", "useProgram",
    "bindBuffer", "bufferData", "enableVertexAttribArray", "vertexAttribPointer", "bindTexture",
    "texParameteri", "pixelStorei", "viewport", "drawArrays"]) gl[name] = (...args) => calls.push([name, ...args]);
  gl.getShaderParameter = gl.getProgramParameter = () => true;
  gl.getAttribLocation = () => 0;
  gl.texImage2D = (...args) => calls.push(["texImage2D", ...args]);
  return { gl, calls };
}

test("WebGL presenter sizes in device pixels and avoids unchanged texture uploads", () => {
  const { gl, calls } = mockWebGL();
  const canvas = {
    width: 1, height: 1,
    getContext: (name, options) => {
      assert.equal(name, "webgl");
      assert.equal(options.antialias, false);
      return gl;
    },
    getBoundingClientRect: () => ({ width: 320, height: 200 }),
  };
  const presenter = new WebGLPresenter(canvas);
  const image = new PixelDocument(2, 2);
  presenter.render(image, 2);
  presenter.render(image, 2);
  assert.equal(canvas.width, 640);
  assert.equal(canvas.height, 400);
  assert.equal(calls.filter(([name]) => name === "texImage2D").length, 1);
  assert.equal(calls.filter(([name]) => name === "drawArrays").length, 2);
});
