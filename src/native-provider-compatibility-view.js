import { NATIVE_PROVIDER_BOUNDARY, NATIVE_PROVIDER_COMPATIBILITY,
  NATIVE_PROVIDER_CONTRACT_VERSION } from "./native-provider-compatibility.js";

function item(text) { const node = document.createElement("li"); node.textContent = text; return node; }

export function renderNativeProviderCompatibility(root, providers = NATIVE_PROVIDER_COMPATIBILITY) {
  if (!root) return null;
  const cards = document.createElement("div"); cards.className = "native-provider-list";
  for (const provider of providers) {
    const card = document.createElement("article"); card.className = "native-provider-card";
    const title = document.createElement("h4"); title.textContent = provider.label;
    const version = document.createElement("p"); version.className = "native-provider-version";
    version.textContent = `Adapter v${provider.adapterVersion} · ${provider.format}`;
    const fields = document.createElement("dl");
    for (const [label, values] of [["Required", provider.required], ["Optional", provider.optional]]) {
      const term = document.createElement("dt"); term.textContent = label;
      const definition = document.createElement("dd"); definition.textContent = values.join(", ");
      fields.append(term, definition);
    }
    const failure = document.createElement("p"); failure.className = "native-provider-failure";
    failure.textContent = provider.behavior.unsupported;
    card.append(title, version, fields, failure); cards.append(card);
  }
  const boundary = document.createElement("ul"); boundary.className = "native-provider-boundary";
  boundary.setAttribute("aria-label", "Native provider import prohibitions");
  boundary.append(...NATIVE_PROVIDER_BOUNDARY.map(item));
  const provenance = document.createElement("p"); provenance.className = "native-provider-provenance";
  provenance.textContent = `${NATIVE_PROVIDER_CONTRACT_VERSION} · static synthetic fixtures · no live fallback`;
  root.replaceChildren(cards, boundary, provenance); root.dataset.state = "ready"; return root;
}
