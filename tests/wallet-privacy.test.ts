import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const policy = readFileSync(new URL("../docs/privacy/index.html", import.meta.url), "utf8");
const deletion = readFileSync(new URL("../docs/privacy/delete-account.html", import.meta.url), "utf8");
const sheet = readFileSync(new URL("../src/components/PrivacySheet.tsx", import.meta.url), "utf8");
const hosting = JSON.parse(readFileSync(new URL("../firebase.json", import.meta.url), "utf8"));

test("privacy and deletion pages are deployable from the same static Hosting root", () => {
  assert.equal(hosting.hosting.public, "docs/privacy");
  assert.match(policy, /href="\/delete-account\.html"/);
  assert.match(deletion, /href="\/"/);
  assert.match(deletion, /com\.seunghyeonkim\.walletdiary/);
  for (const language of ["ko", "en", "fr"]) {
    assert.match(policy, new RegExp(`<h2 id="${language}">`));
    assert.match(deletion, new RegExp(`<section id="${language}"`));
  }
});

test("account deletion request remains available without the app and does not claim instant deletion", () => {
  assert.match(deletion, /mailto:rlatmdgus0920@gmail\.com/);
  assert.match(deletion, /without reinstalling the app/);
  assert.match(deletion, /Uninstalling alone does not delete the server account/);
  assert.match(sheet, /existingSharedTravelUid/);
  assert.match(sheet, /Trip IDs on this device/);
  assert.doesNotMatch(sheet, /signInAnonymously/);
});
