// Runs before the stylesheet is painted so a saved dark theme never flashes
// light. The guarded access also covers privacy modes where storage is blocked.
let savedTheme = null;
try {
  savedTheme = localStorage.getItem("paint.theme.v1");
} catch {
  // A blocked storage API should not prevent the system preference fallback.
}
if (savedTheme === "dark" || savedTheme === "light") {
  document.documentElement.dataset.theme = savedTheme;
} else if (matchMedia("(prefers-color-scheme: dark)").matches) {
  document.documentElement.dataset.theme = "dark";
}
