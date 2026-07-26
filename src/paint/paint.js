import { fitBitmapSize, FRAME_BUDGET_MS, PixelDocument, WebGLPresenter } from "./paint-engine.js";

export const THEME_KEY = "paint.theme.v1";

export function storedTheme(storage) {
  try {
    const value = storage?.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

export function preferredTheme(storage, mediaQuery) {
  return storedTheme(storage) ?? (mediaQuery?.matches ? "dark" : "light");
}

export function persistTheme(storage, theme) {
  if (theme !== "light" && theme !== "dark") return false;
  try {
    storage?.setItem(THEME_KEY, theme);
    return true;
  } catch {
    return false;
  }
}

export function normalizedOpacity(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 100;
}

export const supportedBlendModes = new Set(["normal", "multiply", "screen", "overlay", "darken", "lighten"]);

export function normalizedBlendMode(value) {
  return supportedBlendModes.has(value) ? value : "normal";
}

export function applyTheme(root, button, theme) {
  const dark = theme === "dark";
  root.dataset.theme = dark ? "dark" : "light";
  button?.setAttribute("aria-pressed", String(dark));
  button?.setAttribute("aria-label", `Switch to ${dark ? "light" : "dark"} mode`);
  return root.dataset.theme;
}

export function initPaint(root = document, environment = globalThis) {
  const html = root.documentElement;
  const toggle = root.querySelector("#theme-toggle");
  const media = environment.matchMedia?.("(prefers-color-scheme: dark)");
  let theme = preferredTheme(environment.localStorage, media);
  applyTheme(html, toggle, theme);

  toggle?.addEventListener("click", () => {
    theme = theme === "dark" ? "light" : "dark";
    applyTheme(html, toggle, theme);
    persistTheme(environment.localStorage, theme);
  });

  // Follow system changes only until the user makes an explicit choice.
  media?.addEventListener?.("change", (event) => {
    if (storedTheme(environment.localStorage)) return;
    theme = event.matches ? "dark" : "light";
    applyTheme(html, toggle, theme);
  });
}

function pointerPosition(canvas, event, image) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(image.width - 1, (event.clientX - rect.left) * image.width / rect.width)),
    y: Math.max(0, Math.min(image.height - 1, (event.clientY - rect.top) * image.height / rect.height)),
  };
}

export async function decodeImageFile(file, environment = globalThis) {
  if (!file?.type?.startsWith("image/")) throw new Error("Choose a supported image file");
  const bitmap = await environment.createImageBitmap(file);
  const fitted = fitBitmapSize(bitmap.width, bitmap.height);
  const scratch = environment.document.createElement("canvas");
  scratch.width = fitted.width;
  scratch.height = fitted.height;
  const context = scratch.getContext("2d", { alpha: true, colorSpace: "srgb", willReadFrequently: false });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, fitted.width, fitted.height);
  context.drawImage(bitmap, 0, 0, fitted.width, fitted.height);
  const pixels = context.getImageData(0, 0, fitted.width, fitted.height, { colorSpace: "srgb" }).data;
  bitmap.close?.();
  const image = new PixelDocument(fitted.width, fitted.height, pixels);
  image.degraded = fitted.degraded;
  return image;
}

export function initEditor(root = document, environment = globalThis) {
  const canvas = root.querySelector("#paint-canvas");
  if (!canvas) return null;
  const status = root.querySelector("#render-status");
  let presenter;
  try {
    presenter = new WebGLPresenter(canvas);
  } catch {
    status.textContent = "WebGL unavailable on this device";
    status.closest("p")?.classList.add("is-error");
    for (const control of root.querySelectorAll("button, input")) {
      if (control.id !== "theme-toggle") control.disabled = true;
    }
    return null;
  }

  let image = new PixelDocument();
  let tool = "brush";
  let zoom = 1;
  let framePending = false;
  let activePointer = null;
  let renderSamples = [];
  let importSequence = 0;
  const frame = canvas.closest(".canvas-frame");
  const viewport = canvas.closest(".canvas-viewport");
  const prompt = root.querySelector("#drop-prompt");
  const fileInput = root.querySelector("#file-input");
  const opacity = root.querySelector("#layer-opacity");
  const opacityValue = root.querySelector("#layer-opacity-value");
  const blendMode = root.querySelector("#blend-mode");
  const visibility = root.querySelector("#layer-visibility");
  let layerVisible = true;

  function updateLayerAppearance(message) {
    const amount = normalizedOpacity(opacity.value);
    const mode = normalizedBlendMode(blendMode.value);
    opacity.value = String(amount);
    opacityValue.textContent = `${amount}%`;
    canvas.style.opacity = String(amount / 100);
    canvas.style.mixBlendMode = mode;
    if (message) root.querySelector("#save-state").textContent = message;
  }

  opacity.addEventListener("input", () => updateLayerAppearance(`Layer opacity ${normalizedOpacity(opacity.value)}%`));
  blendMode.addEventListener("change", () => {
    updateLayerAppearance(`${blendMode.options?.[blendMode.selectedIndex]?.text ?? blendMode.value} blend mode`);
  });
  visibility.addEventListener("click", () => {
    layerVisible = !layerVisible;
    visibility.setAttribute("aria-pressed", String(layerVisible));
    visibility.setAttribute("aria-label", `${layerVisible ? "Hide" : "Show"} Bitmap layer`);
    frame.classList.toggle("is-layer-hidden", !layerVisible);
    root.querySelector("#save-state").textContent = layerVisible ? "Layer shown" : "Layer hidden";
  });

  function updateDocumentUi() {
    root.querySelector("#document-width").textContent = `${image.width} px`;
    root.querySelector("#document-height").textContent = `${image.height} px`;
    viewport.setAttribute("aria-label", `Image canvas, ${image.width} by ${image.height} pixels`);
    frame.style.aspectRatio = `${image.width} / ${image.height}`;
  }

  function render() {
    framePending = false;
    const elapsed = presenter.render(image, environment.devicePixelRatio || 1);
    renderSamples.push(elapsed);
    if (renderSamples.length > 30) renderSamples.shift();
    const average = renderSamples.reduce((sum, value) => sum + value, 0) / renderSamples.length;
    status.textContent = average <= FRAME_BUDGET_MS
      ? `WebGL · ${average.toFixed(1)} ms`
      : `WebGL · ${average.toFixed(1)} ms (over frame budget)`;
    prompt.hidden = image.revision > 1;
  }

  function scheduleRender() {
    if (framePending) return;
    framePending = true;
    (environment.requestAnimationFrame ?? ((callback) => setTimeout(callback, 0)))(render);
  }

  function changed(message = "Edited locally") {
    root.querySelector("#save-state").textContent = message;
    updateDocumentUi();
    scheduleRender();
  }

  function chooseTool(nextTool) {
    tool = nextTool;
    for (const button of root.querySelectorAll("[data-tool]")) {
      const selected = button.dataset.tool === tool;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
    }
    canvas.style.cursor = tool === "select" ? "default" : "crosshair";
    if (tool === "select") fileInput.click();
  }

  for (const button of root.querySelectorAll("[data-tool]")) {
    button.addEventListener("click", () => chooseTool(button.dataset.tool));
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (tool === "select") return;
    const point = pointerPosition(canvas, event, image);
    activePointer = { id: event.pointerId, start: point, last: point };
    canvas.setPointerCapture?.(event.pointerId);
    if (tool === "brush") {
      image.brushLine(point.x, point.y, point.x, point.y, {
        color: root.querySelector("#stroke-color").value,
        size: root.querySelector("#stroke-size").value,
      });
      changed();
    }
    event.preventDefault();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!activePointer || activePointer.id !== event.pointerId || tool !== "brush") return;
    const point = pointerPosition(canvas, event, image);
    image.brushLine(activePointer.last.x, activePointer.last.y, point.x, point.y, {
      color: root.querySelector("#stroke-color").value,
      size: root.querySelector("#stroke-size").value,
    });
    activePointer.last = point;
    changed();
  });

  function finishPointer(event) {
    if (!activePointer || activePointer.id !== event.pointerId) return;
    let point = pointerPosition(canvas, event, image);
    if (event.shiftKey && tool === "rectangle") {
      const extent = Math.max(Math.abs(point.x - activePointer.start.x), Math.abs(point.y - activePointer.start.y));
      point = {
        x: activePointer.start.x + Math.sign(point.x - activePointer.start.x || 1) * extent,
        y: activePointer.start.y + Math.sign(point.y - activePointer.start.y || 1) * extent,
      };
    }
    if (tool === "rectangle") {
      image.rectangle(activePointer.start.x, activePointer.start.y, point.x, point.y, {
        color: root.querySelector("#stroke-color").value,
        size: root.querySelector("#stroke-size").value,
      });
      changed();
    } else if (tool === "crop") {
      const x = Math.min(activePointer.start.x, point.x);
      const y = Math.min(activePointer.start.y, point.y);
      const width = Math.abs(point.x - activePointer.start.x);
      const height = Math.abs(point.y - activePointer.start.y);
      if (width >= 2 && height >= 2) {
        image.crop(x, y, width, height);
        changed("Cropped locally");
      }
    }
    activePointer = null;
  }
  canvas.addEventListener("pointerup", finishPointer);
  canvas.addEventListener("pointercancel", () => { activePointer = null; });

  async function importFile(file) {
    const sequence = ++importSequence;
    try {
      status.textContent = "Decoding image locally…";
      const decoded = await decodeImageFile(file, environment);
      if (sequence !== importSequence) return;
      image = decoded;
      changed(image.degraded ? "Imported at reduced resolution" : "Imported locally");
    } catch (error) {
      if (sequence !== importSequence) return;
      status.textContent = error.message;
    }
  }
  fileInput.addEventListener("change", () => importFile(fileInput.files?.[0]));
  viewport.addEventListener("dragover", (event) => {
    event.preventDefault();
    viewport.classList.add("is-dragging");
  });
  viewport.addEventListener("dragleave", () => viewport.classList.remove("is-dragging"));
  viewport.addEventListener("drop", (event) => {
    event.preventDefault();
    viewport.classList.remove("is-dragging");
    importFile(event.dataTransfer?.files?.[0]);
  });

  root.querySelector("#stroke-size").addEventListener("input", (event) => {
    root.querySelector("#stroke-size-value").textContent = `${event.target.value} px`;
  });
  for (const button of root.querySelectorAll("[data-filter]")) {
    button.addEventListener("click", () => {
      image.filter(button.dataset.filter);
      changed(`${button.textContent.trim()} applied locally`);
    });
  }
  root.querySelector("#clear-button").addEventListener("click", () => {
    image.clear();
    changed("Cleared locally");
  });
  root.querySelector("#crop-center-button").addEventListener("click", () => {
    image.crop(image.width * .05, image.height * .05, image.width * .9, image.height * .9);
    changed("Cropped locally");
  });
  root.querySelector("#resize-button").addEventListener("click", () => {
    const width = Number.parseInt(environment.prompt?.("New width in pixels", String(image.width)), 10);
    if (!Number.isFinite(width) || width < 1) return;
    const height = Number.parseInt(environment.prompt?.("New height in pixels", String(image.height)), 10);
    if (!Number.isFinite(height) || height < 1) return;
    image.resize(width, height);
    changed(image.degraded ? "Resized within memory limit" : "Resized locally");
  });
  for (const [id, direction] of [["#zoom-out", -.25], ["#zoom-in", .25]]) {
    root.querySelector(id).addEventListener("click", () => {
      zoom = Math.max(.25, Math.min(2, zoom + direction));
      frame.style.width = `${zoom * 100}%`;
      root.querySelector("#zoom-level").textContent = `${Math.round(zoom * 100)}%`;
      scheduleRender();
    });
  }
  root.querySelector("#export-button").addEventListener("click", () => {
    const exportCanvas = root.createElement("canvas");
    exportCanvas.width = image.width;
    exportCanvas.height = image.height;
    const context = exportCanvas.getContext("2d", { alpha: false, colorSpace: "srgb" });
    const output = context.createImageData(image.width, image.height, { colorSpace: "srgb" });
    output.data.set(image.pixels);
    context.putImageData(output, 0, 0);
    exportCanvas.toBlob((blob) => {
      if (!blob) return;
      const link = root.createElement("a");
      link.download = "paint-export.png";
      link.href = URL.createObjectURL(blob);
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 0);
    }, "image/png");
  });
  environment.addEventListener?.("resize", scheduleRender);
  updateDocumentUi();
  updateLayerAppearance();
  scheduleRender();
  return {
    get document() { return image; },
    get layerAppearance() {
      return { opacity: normalizedOpacity(opacity.value), blendMode: normalizedBlendMode(blendMode.value), visible: layerVisible };
    },
    render: scheduleRender,
  };
}

if (typeof document !== "undefined") {
  initPaint();
  initEditor();
}
