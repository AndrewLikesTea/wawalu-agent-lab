import React, { useId, useRef, useState } from "https://esm.sh/react@19.1.0";
import { createRoot } from "https://esm.sh/react-dom@19.1.0/client";
import {
  EMPTY_FORM,
  newAlternative,
  removeAlternative,
  submissionValues,
  updateAlternative,
  validateDecisionForm,
} from "/decision-form-state.js";

const h = React.createElement;

function FieldError({ id, message }) {
  return message ? h("span", { className: "field-error", id }, message) : null;
}

function DecisionForm() {
  const formId = useId().replaceAll(":", "");
  const nextAlternativeId = useRef(1);
  const [values, setValues] = useState({ ...EMPTY_FORM });
  const [alternatives, setAlternatives] = useState([newAlternative(0)]);
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState("");
  const formRef = useRef(null);

  const updateField = (event) => {
    const { name, value } = event.target;
    setValues((current) => ({ ...current, [name]: value }));
    if (errors[name]) setErrors((current) => ({ ...current, [name]: undefined }));
  };

  const addAlternative = () => {
    const alternative = newAlternative(nextAlternativeId.current++);
    setAlternatives((current) => [...current, alternative]);
    requestAnimationFrame(() => document.getElementById(`${formId}-alternative-${alternative.id}`)?.focus());
  };

  const remove = (id, index) => {
    setAlternatives((current) => removeAlternative(current, id));
    requestAnimationFrame(() => {
      const remaining = formRef.current?.querySelectorAll(".alternative-input");
      remaining?.[Math.min(index, remaining.length - 1)]?.focus() ?? formRef.current?.querySelector(".add-alternative")?.focus();
    });
  };

  const submit = (event) => {
    event.preventDefault();
    const nextErrors = validateDecisionForm(values);
    setErrors(nextErrors);
    setNotice("");
    const firstInvalid = ["title", "context", "owner"].find((name) => nextErrors[name]);
    if (firstInvalid) {
      requestAnimationFrame(() => formRef.current?.elements[firstInvalid]?.focus());
      return;
    }

    const detail = { values: submissionValues(values, alternatives), result: null };
    formRef.current.dispatchEvent(new CustomEvent("decision-submit", { bubbles: true, detail }));
    if (!detail.result?.ok) {
      setNotice(detail.result?.message ?? "The decision could not be added. Try again.");
      return;
    }
    setValues({ ...EMPTY_FORM });
    setAlternatives([newAlternative(nextAlternativeId.current++)]);
    setNotice(detail.result.persisted
      ? "Decision added and saved in this browser."
      : "Decision added for this session, but browser storage is unavailable.");
    requestAnimationFrame(() => formRef.current?.elements.title?.focus());
  };

  const describedBy = (hint, error) => [hint, error].filter(Boolean).join(" ") || undefined;
  return h("form", { id: "decision-form", ref: formRef, onSubmit: submit, noValidate: true },
    h("p", { className: "hint form-intro", id: `${formId}-required` }, "Required fields are marked with an asterisk."),
    h("div", { className: `field field-wide${errors.title ? " field-invalid" : ""}` },
      h("label", { htmlFor: `${formId}-title` }, "Decision title ", h("span", { "aria-hidden": true }, "*")),
      h("input", { id: `${formId}-title`, name: "title", value: values.title, onChange: updateField, maxLength: 120, required: true, autoComplete: "off", "aria-invalid": Boolean(errors.title), "aria-describedby": describedBy(null, errors.title && `${formId}-title-error`) }),
      h(FieldError, { id: `${formId}-title-error`, message: errors.title }),
    ),
    h("div", { className: `field field-wide${errors.context ? " field-invalid" : ""}` },
      h("label", { htmlFor: `${formId}-context` }, "Context ", h("span", { "aria-hidden": true }, "*")),
      h("textarea", { id: `${formId}-context`, name: "context", rows: 5, value: values.context, onChange: updateField, maxLength: 1000, required: true, "aria-invalid": Boolean(errors.context), "aria-describedby": describedBy(`${formId}-context-hint`, errors.context && `${formId}-context-error`) }),
      h("span", { className: "hint", id: `${formId}-context-hint` }, "Summarize the problem, constraints, and reasoning."),
      h(FieldError, { id: `${formId}-context-error`, message: errors.context }),
    ),
    h("fieldset", { className: "alternatives-field field-wide", "aria-describedby": `${formId}-alternatives-hint` },
      h("legend", null, "Alternatives ", h("span", { className: "label-optional" }, "(optional)")),
      h("p", { className: "hint", id: `${formId}-alternatives-hint` }, "Add the other approaches the team considered."),
      h("div", { className: "alternative-editor" }, alternatives.map((alternative, index) =>
        h("div", { className: "alternative-row", key: alternative.id },
          h("label", { className: "visually-hidden", htmlFor: `${formId}-alternative-${alternative.id}` }, `Alternative ${index + 1}`),
          h("input", { className: "alternative-input", id: `${formId}-alternative-${alternative.id}`, value: alternative.value, onChange: (event) => setAlternatives((current) => updateAlternative(current, alternative.id, event.target.value)), maxLength: 1000, placeholder: `Alternative ${index + 1}` }),
          h("button", { className: "remove-alternative", type: "button", onClick: () => remove(alternative.id, index), "aria-label": `Remove alternative ${index + 1}` }, "Remove"),
        )),
      h("button", { className: "add-alternative", type: "button", onClick: addAlternative }, h("span", { "aria-hidden": true }, "+"), " Add alternative"),
    ),
    h("div", { className: `field${errors.owner ? " field-invalid" : ""}` },
      h("label", { htmlFor: `${formId}-owner` }, "Owner ", h("span", { "aria-hidden": true }, "*")),
      h("input", { id: `${formId}-owner`, name: "owner", value: values.owner, onChange: updateField, maxLength: 80, required: true, autoComplete: "name", "aria-invalid": Boolean(errors.owner), "aria-describedby": describedBy(null, errors.owner && `${formId}-owner-error`) }),
      h(FieldError, { id: `${formId}-owner-error`, message: errors.owner }),
    ),
    h("div", { className: "field" },
      h("label", { htmlFor: `${formId}-status` }, "Status"),
      h("select", { id: `${formId}-status`, name: "status", value: values.status, onChange: updateField },
        h("option", { value: "pending" }, "Pending"),
        h("option", { value: "approved" }, "Approved")),
    ),
    notice && h("p", { className: "notice form-notice", role: "status" }, notice),
    h("button", { className: "submit-decision", type: "submit" }, "Add decision ", h("span", { "aria-hidden": true }, "→")),
  );
}

const root = document.querySelector("#decision-form-root");
if (root) createRoot(root).render(h(DecisionForm));
