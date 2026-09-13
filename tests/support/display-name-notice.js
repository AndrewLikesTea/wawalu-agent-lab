import assert from "node:assert/strict";

// The display-name notice Social, People and the post permalink render, checked
// clause by clause so a failure names the half that went missing rather than a
// whole-sentence diff. Where the names come from is two cases, said separately
// (#2348): the notice used to join them with "or" behind "this demo", which left
// a reader unable to tell which case a card was, and called a feed where a
// visitor's post is real a demo.
export function assertDisplayNameNotice(text, where) {
  assert.doesNotMatch(text, /demo/i, `${where}: the display-name notice calls the feed a demo`);
  assert.match(text, /The posts already on Social carry invented display names\./,
    `${where}: the notice no longer says the names on the posts already on Social are invented`);
  assert.match(text, /On any other post, whoever published it chose the name\./,
    `${where}: the notice no longer says who chose the name on any other post`);
  assert.match(text, /Nobody owns or verifies a display name, so anyone can publish under any name\./,
    `${where}: the notice dropped that nobody owns or verifies a display name`);
}
