// Record the observatory's merged-pull-request count.
//
// WHY THIS EXISTS. src/agents.html shows that count in the hero, and the page
// counts it in the browser from the public GitHub events feed, unauthenticated.
// An unauthenticated visitor is routinely rate-limited, so the one number on
// this site that is not a synthetic example was the number most likely to be
// missing. This writes down the last count GitHub actually returned, so the
// page has a dated figure to fall back to instead of a spinner.
//
// THE ONE RULE. The record may only ever hold a count this script read out of a
// real, successful response. Nothing here estimates, extrapolates, rounds,
// seeds a placeholder, or carries a number forward: a request that fails, is
// rate-limited, returns a non-OK status, returns something unreadable, or
// returns nothing countable writes nothing at all, and the previous record —
// including "no record yet" — survives untouched. That is what makes the date
// beside the figure mean what it says.
//
// It talks to one public API and writes one file inside this repository. It
// reads no credential, touches no deployment path, and the file it writes is
// published by the ordinary build like every other static fixture.
//
//   npm run record:merged-count
//
// Exit status is the observable failure: 0 when a count was recorded, 1 when
// GitHub did not give one, with the reason on stderr.

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  EVENTS_URLS,
  countMergedPullRequests,
  liveGithubEvents,
  responseTimestamp,
} from "../src/agents.js";

const root = resolve(import.meta.dirname, "..");
export const RECORD_PATH = resolve(root, "src", "merged-pull-request-count.json");
export const SCHEMA_VERSION = 1;

/**
 * Fetch the public event feeds and record the merged count on success.
 *
 * Returns `{ written: false, reason }` for every path that did not produce a
 * count, and never throws for one: the caller decides what a failure is worth,
 * and the record is untouched either way.
 */
export async function recordMergedCount({ fetcher = fetch, path = RECORD_PATH } = {}) {
  let responses;
  try {
    responses = await Promise.all(EVENTS_URLS.map((url) => fetcher(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "wawalu-agent-lab-merged-count-recorder",
      },
    })));
  } catch (error) {
    return { written: false, reason: "request-failed", detail: String(error?.message ?? error) };
  }
  // The moment the responses arrived, taken once here rather than at write time.
  const receivedAt = new Date();
  const answered = responses.filter((response) => response?.ok);
  if (!answered.length) {
    // 403 is what rate limiting looks like from here, and it is a status like
    // any other: nothing is written, and the reason is reported rather than
    // swallowed.
    return {
      written: false,
      reason: "not-ok",
      detail: `GitHub returned ${responses.map((response) => response?.status ?? "no status").join(", ")}`,
    };
  }

  let payloads;
  try {
    payloads = await Promise.all(answered.map((response) => response.json()));
  } catch (error) {
    return { written: false, reason: "unreadable-payload", detail: String(error?.message ?? error) };
  }
  // The same admissibility rule the page uses, from the same module: only live
  // public GitHub events are countable, and a response carrying none of them is
  // not a count of zero — it is nothing to count from.
  const events = liveGithubEvents(payloads.flatMap((payload) => (Array.isArray(payload) ? payload : [])));
  if (!events.length) return { written: false, reason: "nothing-countable" };

  const record = {
    schemaVersion: SCHEMA_VERSION,
    count: countMergedPullRequests(events),
    takenAt: responseTimestamp(answered, receivedAt).toISOString(),
  };
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`);
  return { written: true, record };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const result = await recordMergedCount();
  if (result.written) {
    console.log(`recorded ${result.record.count} merged pull requests as of ${result.record.takenAt}`);
  } else {
    console.error(`no count recorded (${result.reason}${result.detail ? `: ${result.detail}` : ""});`
      + " the previous record is unchanged");
    process.exitCode = 1;
  }
}
