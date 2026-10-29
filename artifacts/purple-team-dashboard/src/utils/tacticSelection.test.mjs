import { test } from "node:test";
import assert from "node:assert/strict";
import { tacticNames, tacticsAreEnabled } from "./tacticSelection.ts";

test("normalizes comma-separated tactic names", () => {
  assert.deepEqual(
    tacticNames("Execution, Privilege Escalation"),
    ["Execution", "Privilege Escalation"],
  );
});

test("excludes a multi-tactic TID when any mapped tactic is disabled", () => {
  const disabled = new Set(["Privilege Escalation"]);
  assert.equal(tacticsAreEnabled("Execution", disabled), true);
  assert.equal(tacticsAreEnabled("Execution, Privilege Escalation", disabled), false);
});

test("keeps unknown or unmapped TIDs visible", () => {
  assert.equal(tacticsAreEnabled("", new Set(["Execution"])), true);
  assert.equal(tacticsAreEnabled([], new Set(["Execution"])), true);
});
