function classes(node) {
  return node.className.split(/\s+/).filter(Boolean);
}

export function element(properties = {}) {
  const listeners = new Map();
  const node = {
    className: "",
    dataset: {},
    disabled: false,
    hidden: false,
    style: {},
    value: "",
    textContent: "",
    attributes: {},
    // Focus is state here, not behaviour: a test can ask which control the
    // editor moved the reader to after an action.
    focus() { node.focused = true; },
    focused: false,
    addEventListener(type, listener) {
      const handlers = listeners.get(type) ?? [];
      handlers.push(listener);
      listeners.set(type, handlers);
    },
    async dispatch(type, properties = {}) {
      const event = {
        type,
        target: node,
        preventDefault() { event.defaultPrevented = true; },
        ...properties,
      };
      for (const listener of listeners.get(type) ?? []) await listener(event);
      return event;
    },
    setAttribute(name, value) {
      node.attributes[name] = String(value);
    },
    getAttribute(name) {
      return node.attributes[name] ?? null;
    },
    classList: {
      add(...names) {
        node.className = [...new Set([...classes(node), ...names])].join(" ");
      },
      remove(...names) {
        node.className = classes(node).filter((name) => !names.includes(name)).join(" ");
      },
      toggle(name, force) {
        if (force ?? !classes(node).includes(name)) this.add(name);
        else this.remove(name);
      },
      contains(name) {
        return classes(node).includes(name);
      },
    },
    ...properties,
  };
  return node;
}

function webGl() {
  const uploads = [];
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, TEXTURE_2D: 8,
    TEXTURE_MIN_FILTER: 9, TEXTURE_MAG_FILTER: 10, LINEAR: 11,
    TEXTURE_WRAP_S: 12, TEXTURE_WRAP_T: 13, CLAMP_TO_EDGE: 14,
    UNPACK_COLORSPACE_CONVERSION_WEBGL: 15, NONE: 0, RGBA: 16,
    UNSIGNED_BYTE: 17, TRIANGLES: 18,
    createShader: () => ({}),
    createProgram: () => ({}),
    createBuffer: () => ({}),
    createTexture: () => ({}),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getAttribLocation: () => 0,
    shaderSource() {}, compileShader() {}, attachShader() {}, linkProgram() {},
    useProgram() {}, bindBuffer() {}, bufferData() {}, enableVertexAttribArray() {},
    vertexAttribPointer() {}, bindTexture() {}, texParameteri() {}, pixelStorei() {},
    viewport() {}, drawArrays() {},
    texImage2D(...args) {
      uploads.push({
        width: args[3],
        height: args[4],
        pixels: new Uint8ClampedArray(args[8]),
      });
    },
  };
  return { gl, uploads };
}

function twoDimensionalCanvas(bitmap) {
  const operations = [];
  const context = {
    fillStyle: "",
    fillRect() {},
    drawImage(source, x, y, width, height) {
      operations.push({ source, x, y, width, height });
    },
    getImageData(x, y, width, height) {
      const pixels = new Uint8ClampedArray(width * height * 4);
      pixels.fill(bitmap?.fill ?? 127);
      return { data: pixels };
    },
    createImageData(width, height) {
      return { data: new Uint8ClampedArray(width * height * 4) };
    },
    putImageData(imageData) {
      operations.push({ imageData });
    },
  };
  return { context, operations };
}

export function createPaintHarness({ createImageBitmap, exportBlob } = {}) {
  const { gl, uploads } = webGl();
  const frame = element();
  const statusLine = element();
  const status = element({ textContent: "Starting WebGL…", closest: () => statusLine });
  const viewport = element({
    className: "canvas-viewport",
    setAttribute(name, value) { viewport.attributes[name] = String(value); },
  });
  const canvas = element({
    width: 1200,
    height: 800,
    style: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
    getContext: (name) => name === "webgl" ? gl : null,
    closest(selector) {
      return selector === ".canvas-frame" ? frame : viewport;
    },
    setPointerCapture() {},
  });
  const selectors = new Map([
    ["#paint-canvas", canvas],
    ["#render-status", status],
    ["#drop-prompt", element({ hidden: false })],
    ["#file-input", element()],
    ["#document-width", element({ textContent: "1200 px" })],
    ["#document-height", element({ textContent: "800 px" })],
    ["#save-state", element({ textContent: "Saved locally" })],
    ["#stroke-color", element({ value: "#3659e3" })],
    ["#stroke-size", element({ value: "8" })],
    ["#stroke-size-value", element({ textContent: "8 px" })],
    ["#clear-button", element()],
    ["#crop-center-button", element()],
    ["#resize-button", element()],
    ["#zoom-out", element()],
    ["#zoom-in", element()],
    ["#zoom-level", element({ textContent: "100%" })],
    ["#export-button", element()],
    ["#layer-opacity", element({ value: "100" })],
    ["#layer-opacity-value", element({ textContent: "100%" })],
    ["#blend-mode", element({ value: "normal" })],
    ["#layer-visibility", element({ attributes: { "aria-pressed": "true" } })],
    // The route out of the editor: the publish control, the transient status
    // line, and the handoff card the editor reveals once an image exists.
    ["#publish-button", element()],
    ["#publish-status", element({ textContent: "" })],
    ["#paint-handoff", element({ hidden: true })],
    ["#paint-handoff-chip-label", element()],
    ["#paint-handoff-title", element()],
    ["#paint-handoff-detail", element()],
    ["#paint-handoff-action-label", element()],
    ["#paint-handoff-link", element({ href: "" })],
    ["#paint-handoff-dismiss", element()],
  ]);
  const tools = ["select", "crop", "brush", "rectangle"].map((tool) =>
    element({ dataset: { tool }, className: tool === "brush" ? "is-active" : "" }));
  const filters = ["grayscale", "sepia", "invert"].map((filter) =>
    element({ dataset: { filter }, textContent: filter[0].toUpperCase() + filter.slice(1) }));
  const exports = [];
  const root = {
    querySelector(selector) {
      return selectors.get(selector) ?? null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-tool]") return tools;
      if (selector === "[data-filter]") return filters;
      if (selector === "button, input") return [...tools, ...filters, ...selectors.values()];
      return [];
    },
    createElement(tagName) {
      if (tagName === "a") {
        const link = element({ click() { exports.push({ download: link.download, href: link.href }); } });
        return link;
      }
      if (tagName === "canvas") {
        const { context, operations } = twoDimensionalCanvas();
        return element({
          width: 0,
          height: 0,
          operations,
          getContext: () => context,
          toBlob(callback, type) {
            callback(exportBlob ?? new Blob(["png"], { type }));
          },
        });
      }
      return element();
    },
  };
  viewport.closest = (selector) => selector === ".canvas-frame" ? frame : null;
  const environment = {
    devicePixelRatio: 1,
    document: {
      createElement() {
        const state = twoDimensionalCanvas(environment.lastBitmap);
        environment.decodeOperations = state.operations;
        return element({
          width: 0,
          height: 0,
          getContext: () => state.context,
        });
      },
    },
    async createImageBitmap(file) {
      const bitmap = createImageBitmap
        ? await createImageBitmap(file)
        : { width: file.width, height: file.height, fill: file.fill ?? 127, close() {} };
      environment.lastBitmap = bitmap;
      return bitmap;
    },
    requestAnimationFrame(callback) {
      callback();
    },
    addEventListener() {},
    prompt() { return null; },
  };
  return {
    canvas,
    environment,
    exports,
    filters,
    frame,
    root,
    selectors,
    status,
    tools,
    uploads,
    viewport,
  };
}

export function imageFile(width, height, options = {}) {
  return {
    name: options.name ?? "fixture.png",
    type: options.type ?? "image/png",
    width,
    height,
    fill: options.fill ?? 127,
  };
}
