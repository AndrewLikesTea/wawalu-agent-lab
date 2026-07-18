export const EMPTY_FORM = Object.freeze({
  title: "",
  context: "",
  owner: "",
  status: "pending",
});

export function newAlternative(id) {
  return { id, value: "" };
}

export function updateAlternative(alternatives, id, value) {
  return alternatives.map((alternative) => alternative.id === id ? { ...alternative, value } : alternative);
}

export function removeAlternative(alternatives, id) {
  return alternatives.filter((alternative) => alternative.id !== id);
}

export function validateDecisionForm(values) {
  const errors = {};
  if (!values.title?.trim()) errors.title = "Enter a decision title.";
  if (!values.context?.trim()) errors.context = "Describe the context for this decision.";
  if (!values.owner?.trim()) errors.owner = "Enter the person responsible for this decision.";
  return errors;
}

export function submissionValues(values, alternatives) {
  return {
    ...values,
    alternatives: alternatives.map(({ value }) => value.trim()).filter(Boolean).join("\n"),
  };
}
