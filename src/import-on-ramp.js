// The one question the import section asks first (#1169): which provider do
// you pay? Everything a first-time visitor needs after answering it, joined
// from the registries that already own each fact.
//
// THE GAP. The panel already publishes a recipe per pinned adapter and an
// errand card per recognized provider. Both are complete and both are lists: a
// visitor who pays exactly one provider reads four recipes and five cards to
// find the two lines that are theirs. This module turns that reading task into
// a choice — one provider in, one report, one starting file and one next step
// out — without inventing a single new fact.
//
// NOTHING IS AUTHORED HERE EXCEPT THE NEXT STEP. The report name, the question
// it answers, the row unit and the columns come from `import-recipes.js`
// (#1166); the console screen to open comes from the adapter's own export
// package; the downloadable one-row sample comes from the readiness contract.
// The only composed strings are the sentence naming the next action and the
// empty state, because no schema carries "what should I do now".
//
// The adapter-to-sample map is the one join that cannot be derived: the intake
// contract and the recognition source name providers differently, and an
// adapter with no one-row sample (Anthropic today) is a fact about the sample
// registry, not an omission to paper over. It is CHECKED AT MODULE LOAD — a
// fourth adapter, or a sample id that no longer resolves, throws on import and
// fails the build rather than shipping a chooser that answers three of four.
// No DOM, no fetch, no clock: the bytes a download hands a reader are testable
// in Node.

import { PROVIDER_ADAPTERS } from "./multi-provider-intake.js";
import { packageById } from "./provider-export-package.js";
import { IMPORT_RECIPES, RECIPE_SUPPLIES, recipeForAdapter } from "./import-recipes.js";
import { providerReadinessById } from "./provider-readiness-contract.js";

/** This module's own identity. Independent of every contract it reads. */
export const IMPORT_ON_RAMP_VERSION = "import-on-ramp/1.0.0";

/** The one question the section leads with. Asked once, answered once. */
export const IMPORT_ON_RAMP_QUESTION = "Which provider do you pay?";

/** The chooser's own label, bound to the control with a real label element. */
export const IMPORT_ON_RAMP_FIELD_LABEL = "Provider you pay for AI";

/** The unchosen option. A chooser that pre-selects a provider has answered for
 *  the reader, so the empty state is a real option with an empty value. */
export const IMPORT_ON_RAMP_UNCHOSEN = "Not chosen yet";

/**
 * The unchosen-provider state, said in full. It states the local-processing
 * boundary again because this is the first thing in the section a reader meets
 * and "which provider do you pay" reads like a question that leaves the tab.
 */
export const IMPORT_ON_RAMP_EMPTY = "No provider chosen yet. Choose the provider you "
  + "pay above and this panel names the one report to pull, hands you a starting file "
  + "for it, and gives you one next step. Nothing is uploaded either way: a file you "
  + "choose here is read in this browser tab and never leaves it.";

/** The template every delimited report starts from: its required header row. */
export const TEMPLATE_MEDIA_TYPE = "text/csv";

/**
 * Which recognized providers publish a one-row sample for a pinned adapter.
 *
 * Anthropic is deliberately an empty list rather than a missing key: the
 * recognition source does not describe an Anthropic console export, so that
 * choice ships the column template alone. Bedrock carries two because the AWS
 * Cost and Usage Report and its Bedrock slice are the same report to pull.
 */
const SAMPLE_PROVIDERS = Object.freeze({
  "openai-usage": Object.freeze(["openai"]),
  "anthropic-usage": Object.freeze([]),
  "bedrock-cost-and-usage": Object.freeze(["bedrock", "aws"]),
});

/** The recipe that supplies the other half of the headline figure. */
const secondInputRecipe = () => IMPORT_RECIPES
  .find((recipe) => recipe.supplies === RECIPE_SUPPLIES.sample) ?? null;

function samplesFor(adapterId) {
  const ids = SAMPLE_PROVIDERS[adapterId];
  if (!ids) throw new Error(`import-on-ramp: no sample list for adapter ${adapterId}`);
  return Object.freeze(ids.map((id) => {
    const entry = providerReadinessById(id);
    if (!entry) throw new Error(`import-on-ramp: no readiness entry for sample ${id}`);
    return Object.freeze({
      id: entry.id,
      displayName: entry.displayName,
      format: entry.sampleFormat,
      filename: entry.sampleFilename,
      mediaType: entry.sampleMediaType,
    });
  }));
}

function choiceFor(adapter) {
  const recipe = recipeForAdapter(adapter.id);
  const request = packageById(adapter.packageId)?.export_request;
  const second = secondInputRecipe();
  if (!recipe || !request || !second) {
    throw new Error(`import-on-ramp: no on-ramp for pinned adapter ${adapter.id}`);
  }
  return Object.freeze({
    adapter: recipe.adapter,
    label: recipe.label,
    // The three revealed facts, in the order they are revealed.
    report: recipe.report,
    question: recipe.question,
    supplies: recipe.supplies,
    consolePath: request.console_path,
    grouping: recipe.grouping,
    columns: recipe.columns,
    samples: samplesFor(adapter.id),
    templateFilename: `wawalu-template-${recipe.adapter}.csv`,
    // The one next action. Composed, not read: it is the only sentence here
    // that says what to DO, and no contract carries one.
    nextAction: Object.freeze({
      label: `Choose your ${recipe.label} file`,
      detail: `Pull ${recipe.report} — ${request.console_path} — then choose that file `
        + "here. It is read in this browser tab, and nothing is uploaded.",
    }),
    secondInput: Object.freeze({
      label: second.label, report: second.report, question: second.question,
    }),
  });
}

/**
 * One choice per pinned spend adapter, in the intake contract's declared order.
 * Derived from the contract list rather than hand-listed, so an adapter added
 * there and not to the sample map above throws on import.
 */
export const IMPORT_ON_RAMP_CHOICES = Object.freeze(PROVIDER_ADAPTERS.map(choiceFor));

/** The choice for a pinned adapter id, or null for the unchosen state. */
export function onRampChoiceFor(id) {
  return IMPORT_ON_RAMP_CHOICES.find((choice) => choice.adapter === id) ?? null;
}

/** The other choices, in declared order — what the alternates disclosure holds. */
export function onRampAlternatives(id) {
  return IMPORT_ON_RAMP_CHOICES.filter((choice) => choice.adapter !== id);
}

/**
 * The starting file for one choice: the header row of the report, in the
 * column spelling this importer accepts, with no invented values under it.
 * A filled sample is a different artifact and comes from the readiness
 * contract; this is the file a billing owner is asked to fill in.
 */
export function onRampTemplateText(choice) {
  const entry = typeof choice === "string" ? onRampChoiceFor(choice) : choice;
  if (!entry) return null;
  return `${entry.columns.join(",")}\n`;
}
