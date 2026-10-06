/**
 * Workspace slot policy regressions
 * Covers bounded global allocation and pressure reclamation.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createTelegramWorkspaceHashSlotId,
  getTelegramWorkspaceSlotDisplayLabel,
  isTelegramHashWorkspaceSlotId,
  isTelegramWorkspaceSlotId,
  TELEGRAM_WORKSPACE_SLOTS,
  planTelegramWorkspaceSlotAllocation,
  type TelegramWorkspaceSlotOccupancy,
} from "../lib/workspace-slots.ts";

function fullProfile(): TelegramWorkspaceSlotOccupancy[] {
  return Array.from(TELEGRAM_WORKSPACE_SLOTS, (slot, index) => ({
    bindingKey: `/repo/${index}`,
    slot,
    inactiveSinceMs: 100 + index,
    protection: "eligible",
  }));
}

test("Workspace hash IDs remain full and stable while display labels extend on prefix collision", () => {
  const first = createTelegramWorkspaceHashSlotId("binding-a")!;
  assert.equal(first, `H${createHash("sha256").update("binding-a").digest("hex").toUpperCase()}`);
  assert.match(first, /^H[0-9A-F]{64}$/u);
  assert.equal(createTelegramWorkspaceHashSlotId("binding-a"), first);
  const second = createTelegramWorkspaceHashSlotId("binding-b", [first])!;
  assert.match(second, /^H[0-9A-F]{64}$/u);
  assert.notEqual(second, first);
  assert.equal(createTelegramWorkspaceHashSlotId("binding-a", [first]), undefined,
    "a full-hash collision fails closed rather than changing the stable identity");
  assert.equal(isTelegramWorkspaceSlotId(first), true);
  assert.equal(isTelegramHashWorkspaceSlotId(first), true);
  assert.equal(isTelegramWorkspaceSlotId(first.toLowerCase()), false, "persisted/wire IDs are canonical uppercase");
  assert.equal(isTelegramWorkspaceSlotId("M"), true, "legacy letter slots remain readable");
  assert.equal(isTelegramWorkspaceSlotId("AA"), false);
  const collisionA = `HABCDEF1${"0".repeat(57)}`;
  const collisionB = `HABCDEF1${"2"}${"0".repeat(56)}`;
  assert.notEqual(getTelegramWorkspaceSlotDisplayLabel(collisionA, [collisionA, collisionB]),
    getTelegramWorkspaceSlotDisplayLabel(collisionB, [collisionA, collisionB]));
  assert.equal(getTelegramWorkspaceSlotDisplayLabel(collisionA, [collisionA, collisionB]).length, 10,
    "display labels start short and add digest characters only when prefixes collide");
  assert.deepEqual(planTelegramWorkspaceSlotAllocation({
    bindings: [{ bindingKey: "hashed", slot: first.toLowerCase(), protection: "protected" }],
    reservedSlots: [],
    nowMs: 1,
  }), { kind: "free", slot: "a" }, "hash IDs coexist with legacy-letter retirement snapshots");
});

test("Global allocation uses the first free letter across directories and claims", () => {
  const bindings = fullProfile().slice(0, 2);
  assert.deepEqual(planTelegramWorkspaceSlotAllocation({
    bindings, reservedSlots: ["c", "e"], nowMs: 1000,
  }), { kind: "free", slot: "d" });
  assert.deepEqual(planTelegramWorkspaceSlotAllocation({
    bindings: [], reservedSlots: [], nowMs: 1000,
  }), { kind: "free", slot: "a" });
});

test("Pressure proposes the oldest eligible binding instead of alphabetic wrap", () => {
  const bindings = fullProfile();
  bindings[12].inactiveSinceMs = 1;
  const result = planTelegramWorkspaceSlotAllocation({
    bindings, reservedSlots: [], nowMs: 1000,
  });
  assert.equal(result.kind, "reclaim");
  if (result.kind !== "reclaim") return;
  assert.equal(result.candidate.slot, "m");
  assert.equal(result.candidate.bindingKey, "/repo/12");
  result.candidate.bindingKey = "changed";
  assert.equal(bindings[12].bindingKey, "/repo/12");
  assert.equal(bindings.length, 26);
});

test("Legacy pressure retirement never deletes a hash binding to free a letter", () => {
  const bindings = fullProfile();
  bindings.push({
    bindingKey: "hash-binding",
    slot: `h${"0".repeat(64)}`,
    inactiveSinceMs: 0,
    protection: "eligible",
  });
  const result = planTelegramWorkspaceSlotAllocation({ bindings, reservedSlots: [], nowMs: 1000 });
  assert.equal(result.kind, "reclaim");
  if (result.kind === "reclaim") assert.equal(result.candidate.slot, "a");
});

test("Elapsed time cannot retire a binding while free capacity remains", () => {
  assert.deepEqual(planTelegramWorkspaceSlotAllocation({
    bindings: fullProfile().slice(0, 25),
    reservedSlots: [],
    nowMs: Number.MAX_SAFE_INTEGER,
  }), { kind: "free", slot: "z" });
});

test("Protected, unknown, reserved, and unproven inactivity cannot be victims", () => {
  const bindings = fullProfile();
  bindings[0].protection = "protected";
  bindings[1].protection = "unknown";
  bindings[2].inactiveSinceMs = undefined;
  bindings[3].inactiveSinceMs = NaN;
  bindings[4].inactiveSinceMs = Infinity;
  bindings[5].inactiveSinceMs = -1;
  bindings[6].inactiveSinceMs = 1001;
  const result = planTelegramWorkspaceSlotAllocation({
    bindings, reservedSlots: ["h"], nowMs: 1000,
  });
  assert.equal(result.kind, "reclaim");
  if (result.kind === "reclaim") assert.equal(result.candidate.slot, "i");
});

test("All-protected capacity fails closed without extending the alphabet", () => {
  const bindings = fullProfile().map((binding) => ({
    ...binding, protection: "protected" as const,
  }));
  for (const input of [
    { bindings, reservedSlots: [] },
    { bindings: [], reservedSlots: Array.from(TELEGRAM_WORKSPACE_SLOTS) },
  ]) {
    assert.deepEqual(planTelegramWorkspaceSlotAllocation({ ...input, nowMs: 1000 }), {
      kind: "blocked", reason: "protected-capacity",
    });
  }
});

test("Equal inactivity uses deterministic letter order independent of input order", () => {
  const bindings = fullProfile().map((binding) => ({ ...binding, inactiveSinceMs: 0 }));
  assert.deepEqual(planTelegramWorkspaceSlotAllocation({
    bindings: bindings.toReversed(), reservedSlots: [], nowMs: 1000,
  }), { kind: "reclaim", candidate: bindings[0] });
});

test("Duplicate legacy slots, duplicate binding keys, and invalid inputs block planning", () => {
  const first = fullProfile()[0];
  for (const input of [
    { bindings: [first, { ...first, bindingKey: "/other" }], reservedSlots: [], nowMs: 1000 },
    { bindings: [first, { ...first, slot: "b" }], reservedSlots: [], nowMs: 1000 },
    { bindings: [{ ...first, slot: "aa" }], reservedSlots: [], nowMs: 1000 },
    { bindings: [{ ...first, slot: "A" }], reservedSlots: [], nowMs: 1000 },
    { bindings: [{ ...first, bindingKey: "" }], reservedSlots: [], nowMs: 1000 },
    { bindings: [], reservedSlots: ["aa"], nowMs: 1000 },
    { bindings: [], reservedSlots: [], nowMs: NaN },
    { bindings: [], reservedSlots: [], nowMs: -1 },
  ]) {
    assert.deepEqual(planTelegramWorkspaceSlotAllocation(input), {
      kind: "blocked", reason: "invalid-state",
    });
  }
});
