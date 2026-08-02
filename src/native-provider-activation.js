// Decides whether one already-read table can enter analysis through a
// versioned native-provider adapter. This module does not parse bytes or retain
// rows; it only compares the header with the compatibility registry.

import { detectDialect, scoreProfile } from "./dialect-detection.js";
import { profileById } from "./dialect-profiles.js";
import { NATIVE_PROVIDER_COMPATIBILITY } from "./native-provider-compatibility.js";

export const NATIVE_ACTIVATION_STATUS = Object.freeze({
  SUPPORTED: "supported",
  INCOMPLETE: "incomplete",
  NOT_NATIVE: "not-native",
});

const profiles = () => NATIVE_PROVIDER_COMPATIBILITY
  .map(({ id }) => profileById(id))
  .filter(Boolean);

export function assessNativeProviderActivation(reading) {
  const table = {
    columns: reading?.header ?? [],
    rows: (reading?.rows ?? []).map((row) => row?.values ?? []),
    delimiter: reading?.delimiterName ?? null,
    headerRowIndex: reading?.headerRow ?? null,
  };
  const supportedProfiles = profiles();
  const detection = detectDialect(table, supportedProfiles);
  if (detection.status === "matched") {
    const provider = NATIVE_PROVIDER_COMPATIBILITY
      .find(({ id }) => id === detection.profileId);
    return Object.freeze({
      status: NATIVE_ACTIVATION_STATUS.SUPPORTED,
      providerId: provider.id,
      providerLabel: provider.label,
      adapterVersion: provider.adapterVersion,
      confidence: detection.confidence,
      // One sentence for both the reading and the ready state, so it is still
      // true once the analysis it describes is on screen.
      message: `${provider.label} is compatible with adapter v${provider.adapterVersion} `
        + `(${Math.round(detection.confidence * 100)}% header confidence). This export is `
        + "analyzed directly; manual column mapping is not required.",
    });
  }

  // A native-looking header that is missing a required field is an incomplete
  // export, not an invitation to guess. Optional signals establish that the
  // file resembles exactly one provider before we use that provider's recovery.
  const candidates = supportedProfiles.map((profile) => {
    const score = scoreProfile(profile, table.columns);
    const normalized = new Set(table.columns.map((value) => String(value).toLowerCase()
      .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")));
    const optionalHits = profile.columns.filter((column) => !column.required
      && [column.source, ...(column.aliases ?? [])].some((name) => normalized.has(String(name)
        .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")))).length;
    const missingCount = score.reason.startsWith("missing required")
      ? score.reason.split(",").length : Number.POSITIVE_INFINITY;
    return { profile, score, optionalHits, missingCount };
  }).filter(({ score, optionalHits }) => score.reason.startsWith("missing required") && optionalHits > 0);

  const closest = candidates.sort((left, right) => left.missingCount - right.missingCount
    || right.optionalHits - left.optionalHits);
  if (closest.length && (closest.length === 1
    || closest[0].missingCount < closest[1].missingCount
    || closest[0].optionalHits > closest[1].optionalHits)) {
    const [{ profile, score }] = closest;
    const provider = NATIVE_PROVIDER_COMPATIBILITY.find(({ id }) => id === profile.id);
    return Object.freeze({
      status: NATIVE_ACTIVATION_STATUS.INCOMPLETE,
      providerId: provider.id,
      providerLabel: provider.label,
      confidence: 0,
      message: `${provider.label} looks incomplete: ${score.reason}. Export the complete usage `
        + "table and choose it again. No analysis was run.",
    });
  }
  return Object.freeze({ status: NATIVE_ACTIVATION_STATUS.NOT_NATIVE, confidence: 0 });
}
