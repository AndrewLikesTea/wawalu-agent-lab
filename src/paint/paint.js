export const THEME_KEY = "paint.theme.v1";
export const LAYER_STATES = new Set(["ready", "loading", "empty", "error"]);

export function normalizeOpacity(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 100;
  return Math.min(100, Math.max(0, Math.round(parsed)));
}

export function opacityLabel(value) {
  return `${normalizeOpacity(value)}%`;
}

export function setLayerPanelState(section, stateNode, state = "ready", message = "") {
  const resolved = LAYER_STATES.has(state) ? state : "error";
  const unavailable = resolved !== "ready";
  section?.classList.toggle("is-unavailable", unavailable);
  section?.setAttribute("aria-busy", String(resolved === "loading"));
  if (!stateNode) return resolved;
  stateNode.hidden = !unavailable;
  stateNode.dataset.state = resolved;
  const defaults = {
    loading: "Loading layers…",
    empty: "No layers yet. Add a layer to begin editing.",
    error: "Layers could not be loaded. Try reopening the editor.",
  };
  stateNode.textContent = unavailable ? (message || defaults[resolved]) : "";
  return resolved;
}

export function syncOpacity(input, output) {
  const value = normalizeOpacity(input?.value);
  if (input) {
    input.value = String(value);
    input.setAttribute("aria-valuetext", opacityLabel(value));
  }
  if (output) output.value = output.textContent = opacityLabel(value);
  return value;
}

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

  const opacity = root.querySelector("#layer-opacity");
  const opacityValue = root.querySelector("#opacity-value");
  syncOpacity(opacity, opacityValue);
  opacity?.addEventListener("input", () => syncOpacity(opacity, opacityValue));

  setLayerPanelState(
    root.querySelector(".layers-section"),
    root.querySelector("#layer-state"),
    "ready",
  );
}

if (typeof document !== "undefined") initPaint();
