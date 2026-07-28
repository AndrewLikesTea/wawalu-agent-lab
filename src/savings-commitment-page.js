import { loadSavingsCommitment } from "/savings-commitment.js";
import {
  renderSavingsCommitment, renderSavingsCommitmentError,
} from "/savings-commitment-view.js";

const root = document.getElementById("savings-commitment");

try {
  root.replaceChildren(renderSavingsCommitment(await loadSavingsCommitment()));
} catch (error) {
  console.error("savings_commitment_unavailable", {
    error: error?.message ?? String(error),
  });
  root.replaceChildren(renderSavingsCommitmentError());
} finally {
  root.setAttribute("aria-busy", "false");
}
