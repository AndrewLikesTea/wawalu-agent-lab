// "Report post": the one way a reader asks the Wawalu team to look at a public
// post (#2343). src/social.js and src/profile.js draw the button on every loaded
// card and tile and mount this panel once per page. The endpoint
// (src/post-reports-api.js) reads its reason list from here, so the radios a
// reader picks from and the values the server accepts are one array.
//
// The panel is the composer's disclosure pattern (mountComposerDisclosure in
// src/social.js), not a new widget: `hidden` rather than a dialog, focus into the
// panel on open, Escape or Close to leave, focus back on the button that opened
// it, and no closing while a send is in flight. A report never touches the post,
// and the panel says so before anything is sent. Every string is written with
// textContent, so nothing a post says can become markup here.

export const REPORT_POST_LABEL = "Report post";
export const MAX_REPORT_CONTEXT_LENGTH = 500;
export const REPORT_REASONS = Object.freeze([
  { value: "harmful", label: "Harmful or abusive" },
  { value: "personal_information", label: "Shares personal or sensitive information" },
  { value: "spam", label: "Spam" },
  { value: "posted_in_error", label: "Mistaken or posted in error" },
  { value: "other", label: "Something else" },
].map((reason) => Object.freeze(reason)));

export const REPORT_REVIEW_NOTE = "This report goes to the Wawalu team, who review each one. Reporting does not remove or hide the post, and not every report leads to removal.";
export const REPORT_SENT_NOTE = "Send report sends this post, your reason, your note if you write one, and your email address. Only the Wawalu team sees them; none of it is shown on Social or People.";
export const REPORT_RECEIVED = "Report sent. The Wawalu team will review this post, and it stays up while they do.";
export const REPORT_NOT_SENT = "Your report was not sent.";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// What is wrong with a report before it is sent, by field. Checked here rather
// than left to the browser: a required radio group is not something every
// engine refuses on submit, and the reason is the one answer the endpoint will
// not guess.
export function reportProblems({ reason = "", context = "", email = "" } = {}) {
  const problems = {};
  if (!REPORT_REASONS.some((entry) => entry.value === reason)) problems.reason = "Choose a reason for this report.";
  if (String(context).trim().length > MAX_REPORT_CONTEXT_LENGTH) {
    problems.context = `Your note must be ${MAX_REPORT_CONTEXT_LENGTH} characters or fewer.`;
  }
  const address = String(email).trim();
  if (!address) problems.email = "Enter your email address.";
  else if (address.length > 254 || !EMAIL_PATTERN.test(address)) problems.email = "Enter a valid email address, like you@example.com.";
  return problems;
}

// Which post, in words a reader can match to the card they pressed: the author,
// then the start of what it says, or its image description when it says nothing.
export function reportedPostLine(post) {
  const text = String(post?.body || post?.image?.alt || "").replace(/\s+/g, " ").trim();
  const excerpt = text.length > 80 ? `${text.slice(0, 79).trimEnd()}…` : text;
  return `You are reporting the post by ${post?.author ?? ""}: “${excerpt}”`;
}

export async function sendPostReport(report) {
  let response;
  try {
    response = await fetch("/api/post-reports", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(report),
    });
  } catch {
    throw new Error(`${REPORT_NOT_SENT} The connection failed.`);
  }
  if (response.ok) return response.json();
  const payload = await response.json().catch(() => null);
  // The endpoint's refusals are written for the reader; a server failure's
  // wording is not, so it gets this module's own sentence.
  const message = response.status < 500 ? payload?.error?.message : "";
  throw new Error(message ? `${REPORT_NOT_SENT} ${message}` : REPORT_NOT_SENT);
}

// The button on a card or tile. Its name starts with the two words printed on
// it and then says which post, because every card prints the same two words.
export function renderReportButton(post, when, onReport) {
  const button = document.createElement("button");
  button.setAttribute("type", "button");
  button.className = "text-button post-report-button";
  button.textContent = REPORT_POST_LABEL;
  button.setAttribute("aria-label", `${REPORT_POST_LABEL} by ${post.author}, ${when}`);
  button.dataset.postId = post.id;
  button.addEventListener("click", () => onReport(post, button));
  return button;
}

export function mountPostReport(root, { send = sendPostReport } = {}) {
  const doc = root.ownerDocument ?? root;
  const main = root.querySelector("#main-content");
  if (!main) return null;
  const make = (tag, className = "", text = undefined, attributes = {}) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    return node;
  };
  const fieldError = (id) => {
    const node = make("p", "field-error", undefined, { id, role: "alert" });
    node.hidden = true;
    return node;
  };

  const panel = make("section", "form-panel", undefined, { id: "post-report-panel", "aria-labelledby": "post-report-title" });
  panel.hidden = true;
  const title = make("h2", "", REPORT_POST_LABEL, { id: "post-report-title", tabindex: "-1" });
  const which = make("p", "hint", undefined, { id: "post-report-post" });
  const review = make("p", "hint", REPORT_REVIEW_NOTE, { id: "post-report-review" });
  const form = make("form", "", undefined, {
    id: "post-report-form", novalidate: "", "aria-labelledby": "post-report-title", "aria-describedby": "post-report-post post-report-review",
  });

  const reasons = make("fieldset", "media-picker", undefined, { id: "post-report-reasons" });
  reasons.append(make("legend", "", "Reason"));
  const radios = REPORT_REASONS.map((reason, index) => {
    const radio = make("input", "", undefined, { type: "radio", name: "report-reason", value: reason.value, id: `post-report-reason-${index}` });
    const row = make("p");
    row.append(radio, " ", make("label", "", reason.label, { for: radio.id }));
    reasons.append(row);
    return radio;
  });
  const reasonError = fieldError("post-report-reason-error");

  const contextInput = make("textarea", "", undefined, {
    id: "post-report-context", name: "context", rows: "3", maxlength: String(MAX_REPORT_CONTEXT_LENGTH), "aria-describedby": "post-report-context-hint",
  });
  const contextLabel = make("label", "", "Note for the team ", { for: "post-report-context" });
  contextLabel.append(make("span", "label-optional", "(optional)"));
  const contextError = fieldError("post-report-context-error");
  const contextField = make("div", "field field-wide");
  contextField.append(contextLabel, contextInput, contextError,
    make("span", "hint", `Up to ${MAX_REPORT_CONTEXT_LENGTH} characters.`, { id: "post-report-context-hint" }));

  const emailInput = make("input", "", undefined, {
    id: "post-report-email", name: "email", type: "email", required: "", maxlength: "254", inputmode: "email", autocomplete: "email", "aria-describedby": "post-report-sent",
  });
  const emailError = fieldError("post-report-email-error");
  const emailField = make("div", "field field-wide");
  emailField.append(make("label", "", "Your email address", { for: "post-report-email" }), emailInput, emailError);

  const sent = make("p", "hint", REPORT_SENT_NOTE, { id: "post-report-sent" });
  const submit = make("button", "", "Send report", { id: "post-report-submit", type: "submit" });
  form.append(reasons, reasonError, contextField, emailField, sent, submit);

  // Outside the form, so the confirmation and the way out both survive the
  // form being replaced by the answer.
  // A live region only while the panel is open: each page keeps one standing
  // voice in main, and a closed panel has nothing to say. open() gives it the
  // role before any message is written, so the first one is still announced.
  const status = make("p", "notice submit-feedback", undefined, { id: "post-report-status", "aria-atomic": "true", tabindex: "-1" });
  status.hidden = true;
  const retry = make("button", "secondary-button", "Retry sending report", { id: "post-report-retry", type: "button" });
  retry.hidden = true;
  const closeButton = make("button", "text-button", "Close", { id: "post-report-close", type: "button" });
  panel.append(title, which, review, form, status, retry, closeButton);
  main.append(panel);

  let post = null;
  let opener = null;
  let sending = false;

  const inDocument = (node) => {
    for (let at = node; at; at = at.parentNode) if (at === doc) return true;
    return false;
  };
  const showError = (node, input, message) => {
    node.textContent = message ?? "";
    node.hidden = !message;
    if (!input) return;
    if (message) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  };
  const setStatus = (message, success = false) => {
    status.textContent = message;
    status.hidden = !message;
    status.classList.toggle("is-success", success);
  };

  const reset = () => {
    for (const radio of radios) radio.checked = false;
    contextInput.value = "";
    showError(reasonError, null, "");
    showError(contextError, contextInput, "");
    showError(emailError, emailInput, "");
    setStatus("");
    retry.hidden = true;
    form.hidden = false;
  };

  // A different post, or the same one after its report went through, starts a
  // new report. The email address is kept: it is the reader's, not the post's.
  const open = (next, from = null) => {
    if (!sending) {
      if (post?.id !== next.id || form.hidden) reset();
      post = next;
    }
    opener = from;
    which.textContent = reportedPostLine(post);
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    panel.hidden = false;
    title.focus();
  };

  const close = () => {
    if (panel.hidden || sending) return;
    panel.hidden = true;
    status.removeAttribute("role");
    status.removeAttribute("aria-live");
    // The feed redraws its cards on every refresh, so the button that opened
    // the panel may be gone; its replacement for the same post takes focus.
    const target = opener && inDocument(opener) ? opener
      : [...root.querySelectorAll(".post-report-button")].find((button) => button.dataset.postId === post?.id);
    target?.focus();
  };

  const submitReport = async () => {
    if (sending || !post) return;
    const values = { reason: radios.find((radio) => radio.checked)?.value ?? "", context: contextInput.value, email: emailInput.value };
    const problems = reportProblems(values);
    showError(reasonError, null, problems.reason);
    showError(contextError, contextInput, problems.context);
    showError(emailError, emailInput, problems.email);
    const firstProblem = problems.reason ? radios[0] : problems.context ? contextInput : problems.email ? emailInput : null;
    if (firstProblem) {
      firstProblem.focus();
      return;
    }
    sending = true;
    submit.disabled = true;
    submit.setAttribute("aria-busy", "true");
    retry.hidden = true;
    setStatus("Sending your report…");
    // Disabling the button under the reader's focus drops them on the body in a
    // browser, so focus is put where the answer is about to arrive.
    status.focus();
    try {
      await send({ post_id: post.id, reason: values.reason, context: values.context.trim(), email: values.email.trim() });
      form.hidden = true;
      setStatus(REPORT_RECEIVED, true);
    } catch (error) {
      setStatus(`${error?.message || REPORT_NOT_SENT} Your reason, note, and email address are still in the form.`);
      retry.hidden = false;
    } finally {
      sending = false;
      submit.disabled = false;
      submit.removeAttribute("aria-busy");
    }
    (retry.hidden ? status : retry).focus();
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitReport();
  });
  retry.addEventListener("click", () => submitReport());
  closeButton.addEventListener("click", close);
  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
    event.preventDefault();
    close();
  });

  return { open, close, get isOpen() { return !panel.hidden; } };
}
