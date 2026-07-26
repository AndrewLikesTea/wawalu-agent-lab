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

if (typeof document !== "undefined") initPaint();
