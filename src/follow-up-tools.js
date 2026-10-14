// Shared page-to-tool contract. Older clients may omit tool for Shiplog.
export const FOLLOW_UP_TOOLS = Object.freeze({ shiplog: "Shiplog", social: "Social", people: "People", agents: "Agent observatory" });
export const PAGE_TOOLS = Object.freeze({ follow_up_social: "social", follow_up_people: "people", follow_up_agents: "agents" });
export const TOOL_DISCLOSURE = "Your choice of Shiplog or this page’s tool is sent with your request, so the Wawalu team knows which one to reply about.";
// Replaces the Shiplog invitation while a separate tool is chosen. It names the
// tool as the footer identity does and promises no price or access.
export function toolInvitation(tool) {
  const name = FOLLOW_UP_TOOLS[tool];
  return `Questions about ${name}? Send the Wawalu team a question. ${name} is a separate tool hosted in the same lab, not part of Shiplog.`
    + (tool === "social" ? " If your question is about one of the posts, select Report post on that post instead." : "");
}
export function toolFieldLines(purpose) {
  const tool = PAGE_TOOLS[purpose];
  if (!tool) return [];
  return [
    '<fieldset class="decision-picker-field" id="site-footer-tool"><legend>Which tool is your request about?</legend>',
    ...["shiplog", tool].map(value => `<div class="filter-option"><input id="site-footer-tool-${value}" name="tool" type="radio" value="${value}"${value === "shiplog" ? " checked" : ""} /><label for="site-footer-tool-${value}">${FOLLOW_UP_TOOLS[value]}</label></div>`),
    '</fieldset>',
    '<p id="site-footer-tool-selection" aria-live="polite">Request about: Shiplog.</p>',
    `<p class="site-footer-note">${TOOL_DISCLOSURE}</p>`,
  ];
}
