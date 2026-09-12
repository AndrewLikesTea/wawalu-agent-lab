// Social as served, booted with the browser pieces a Paint handoff touches.
//
// loadPage installs the document, localStorage and a routed fetch. A handoff
// also reads the address (location, history), listens for another tab's storage
// writes (addEventListener on the global), and reads the image the way a chosen
// file is read (FileReader, createImageBitmap) — none of which this runtime
// ships. They are stood up here for the length of one test and put back after.
// The FileReader stub reads the File's real bytes, so what a test sees published
// is what was handed over, not a fixture string.

import { loadPage } from "./browser.js";
import { importPageModule, waitFor } from "./page-module.js";

export function handoffRecord(bytes, { type = "image/png", createdAt = Date.now() } = {}) {
  const data = Buffer.from(bytes).toString("base64");
  return JSON.stringify({ dataUrl: `data:${type};base64,${data}`, type, name: "paint-export.png", size: bytes.length, createdAt });
}

export async function bootSocial(t, { storage = {}, routes = {}, search = "", hash = "" } = {}) {
  const page = await loadPage(new URL("../../src/social.html", import.meta.url), {
    storage,
    routes: { "/social-demo-data.json": { posts: [] }, "/api/social-posts?limit=100": { posts: [] }, ...routes },
  });
  // Every request, with its method and body, so a test can say what was sent.
  const requests = [];
  const served = globalThis.fetch;
  globalThis.fetch = (url, init = {}) => {
    requests.push({ url, method: init.method ?? "GET", body: init.body });
    return served(url, init);
  };

  const listeners = [];
  const timers = [];
  const realSetInterval = globalThis.setInterval;
  const location = { pathname: "/social.html", search, hash };
  const history = {
    state: null,
    replaced: [],
    replaceState(state, title, url) {
      history.replaced.push(url);
      location.search = new URL(url, "https://labs.wawalu.org").search;
    },
  };
  const stubs = {
    location,
    history,
    addEventListener(type, listener) { listeners.push({ type, listener }); },
    FileReader: class {
      addEventListener(type, handler) { this.handlers = { ...this.handlers, [type]: handler }; }
      readAsDataURL(file) {
        file.arrayBuffer().then((buffer) => {
          this.result = `data:${file.type};base64,${Buffer.from(buffer).toString("base64")}`;
          this.handlers?.load?.();
        });
      }
    },
    createImageBitmap: async () => ({ width: 8, height: 8, close() {} }),
    // The feed polls on a timer; a live interval would outlast the test.
    setInterval: (...args) => {
      const handle = realSetInterval(...args);
      timers.push(handle);
      return handle;
    },
  };
  const saved = Object.fromEntries(Object.keys(stubs).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(stubs)) {
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  }
  t.after(() => {
    for (const handle of timers) clearInterval(handle);
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    page.restore();
  });

  const boot = async () => {
    const loads = requests.filter((request) => request.url === "/api/social-posts?limit=100").length;
    await importPageModule("/social-page.js");
    await waitFor(() => requests.filter((request) => request.url === "/api/social-posts?limit=100").length > loads
      && page.document.documentElement.dataset.shiplogSocial === "ready", "the social page finished its first load");
  };
  await boot();

  return {
    page,
    document: page.document,
    storage: page.storage,
    requests,
    history,
    id: (name) => page.document.querySelector(`#${name}`),
    // Another tab wrote to localStorage: what the browser tells this one.
    dispatchStorage(key) {
      const newValue = page.storage.getItem(key);
      for (const { type, listener } of listeners) if (type === "storage") listener({ key, newValue });
    },
    boot,
  };
}
