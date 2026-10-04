/** Thread naming value policy, compatibility and dialog state; no transport or Workspace mutation. */
import assert from "node:assert/strict";
import test from "node:test";
import * as Naming from "../lib/thread-naming.ts";
import * as Threads from "../lib/threads.ts";
import {
  chooseTelegramThreadName,
  createTelegramThreadName,
  createTelegramThreadNameDialogRuntime,
  getTelegramManualThreadDisplayNameValidationError,
  getTelegramTopicIdentityName,
  getTelegramTopicName,
  isTelegramTopicThreadNameValidForSlot,
  TELEGRAM_THREAD_NAME_DIALOG_TTL_MS,
} from "../lib/thread-naming.ts";

const target = { chatId: 7, threadId: 42 };

test("Thread-name dialog replaces duplicates and consumes one exact-target name", () => {
  let now = 100;
  const runtime = createTelegramThreadNameDialogRuntime({ nowMs: () => now });
  runtime.open({ scope: "session:1", target, dialogMessageId: 10 });
  runtime.open({ scope: "session:1", target, dialogMessageId: 11 });
  assert.deepEqual(runtime.select({
    scope: "session:1", target, dialogMessageId: 10, action: "cancel",
  }), { kind: "expired" });
  assert.deepEqual(runtime.consumeName({
    scope: "session:1", target: { chatId: 7, threadId: 43 }, text: "Wrong",
  }), { kind: "none" });
  assert.deepEqual(runtime.consumeName({
    scope: "session:1", target, text: "  Navigator  ",
  }), { kind: "name", name: "Navigator" });
  assert.deepEqual(runtime.consumeName({
    scope: "session:1", target, text: "Again",
  }), { kind: "none" });
  assert.equal(runtime.inspect(target), undefined);
  now++;
});

test("Thread-name dialog reset and cancel are consume-once", () => {
  const runtime = createTelegramThreadNameDialogRuntime();
  for (const action of ["reset", "cancel"] as const) {
    runtime.open({ scope: "session:1", target, dialogMessageId: 20 });
    assert.deepEqual(runtime.select({
      scope: "session:1", target, dialogMessageId: 20, action,
    }), { kind: action });
    assert.deepEqual(runtime.select({
      scope: "session:1", target, dialogMessageId: 20, action,
    }), { kind: "expired" });
  }
});

test("Thread-name dialog rejects stale scope, expiry, and empty input", () => {
  let now = 1_000;
  const runtime = createTelegramThreadNameDialogRuntime({ nowMs: () => now });
  runtime.open({ scope: "session:1", target, dialogMessageId: 30 });
  assert.deepEqual(runtime.select({
    scope: "session:2", target, dialogMessageId: 30, action: "cancel",
  }), { kind: "expired" });
  assert.deepEqual(runtime.consumeName({
    scope: "session:1", target, text: "   ",
  }), { kind: "empty" });
  assert.equal(runtime.inspect(target)?.phase, "input");
  now += TELEGRAM_THREAD_NAME_DIALOG_TTL_MS;
  assert.deepEqual(runtime.consumeName({
    scope: "session:1", target, text: "Late",
  }), { kind: "none" });
  assert.equal(runtime.inspect(target), undefined);
});

test("Thread-name dialog scope cleanup invalidates every target in that session", () => {
  const runtime = createTelegramThreadNameDialogRuntime();
  runtime.open({ scope: "session:1", target, dialogMessageId: 40 });
  runtime.open({
    scope: "session:1", target: { chatId: 7, threadId: 43 }, dialogMessageId: 41,
  });
  runtime.open({
    scope: "session:2", target: { chatId: 7, threadId: 44 }, dialogMessageId: 42,
  });
  runtime.clearScope("session:1");
  assert.equal(runtime.inspect(target), undefined);
  assert.equal(runtime.inspect({ chatId: 7, threadId: 43 }), undefined);
  assert.ok(runtime.inspect({ chatId: 7, threadId: 44 }));
});

test("Thread names are deterministic for the same seed", () => {
  const input = {
    seed: "123",
    cwd: "/repo/pi-telegram",
    role: "leader" as const,
  };
  assert.equal(
    createTelegramThreadName(input),
    createTelegramThreadName(input),
  );
});

test("Baked thread names stay compact for narrow Telegram tabs", () => {
  for (const slot of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    const seen = new Set<string>();
    for (let index = 0; index < 5; index += 1) {
      const name = chooseTelegramThreadName({
        slot,
        getRandom: () => index / 5,
      });
      assert.ok(name, `Expected baked name for slot ${slot}`);
      assert.equal(name.startsWith(slot), true);
      assert.ok(
        name.length >= 4 && name.length <= 6,
        `${name} should be 4-6 letters`,
      );
      seen.add(name);
    }
    assert.equal(seen.size, 5, `Expected five names for slot ${slot}`);
  }
});

test("Baked thread names skip identities reserved by Workspace bindings", () => {
  assert.equal(
    chooseTelegramThreadName({
      slot: "C",
      getRandom: () => 0,
      occupied: ["Cedar", "Comet", "Cipher", "Coral"],
    }),
    "Cinder",
  );
});

test("Baked thread names can be selected from timestamp entropy", () => {
  const first = chooseTelegramThreadName({
    slot: "C",
    entropy: 1_720_000_000_001,
  });
  const second = chooseTelegramThreadName({
    slot: "C",
    entropy: 1_720_000_000_001,
  });
  const nearby = chooseTelegramThreadName({
    slot: "C",
    entropy: 1_720_000_000_002,
  });

  assert.equal(first, second);
  assert.ok(first?.startsWith("C"));
  assert.ok(nearby?.startsWith("C"));
});

test("Thread names include workspace and role hints", () => {
  const name = createTelegramThreadName({
    seed: "123",
    cwd: "/repo/pi-telegram",
    role: "leader",
  });
  assert.match(name, /pi-telegram/);
  assert.match(name, /Leader/);
});

test("Thread names can include the assigned slot", () => {
  const name = createTelegramThreadName({
    seed: "123",
    cwd: "/repo/pi-telegram",
    role: "follower",
    slot: "B",
  });
  assert.match(name, /Thread B/);
  assert.match(name, /Follower/);
});

test("Thread recovery identities remain compact capitalized Latin names", () => {
  assert.equal(getTelegramTopicIdentityName("Jname"), "Jname");
  assert.equal(getTelegramTopicIdentityName("  Jname  "), "Jname");
  assert.equal(isTelegramTopicThreadNameValidForSlot("Jname", "J"), true);
  for (const name of [
    "J", "name", "Follower", "J identity", "J-identity", "Word Word",
    "wasd_123!?+$@", "🌙 J-identity",
  ]) {
    assert.equal(isTelegramTopicThreadNameValidForSlot(name, "J"), false, name);
  }
});

test("Manual Thread display names accept bounded printable ASCII", () => {
  for (const name of [
    "Jname", "name", "Follower", "J identity", "J-identity", "Word Word",
    "wasd_123!?+$@",
  ]) {
    assert.equal(getTelegramManualThreadDisplayNameValidationError(name), undefined, name);
  }
  assert.match(getTelegramManualThreadDisplayNameValidationError("A") ?? "", /reset/);
  assert.match(getTelegramManualThreadDisplayNameValidationError("   ") ?? "", /empty/);
  assert.match(getTelegramManualThreadDisplayNameValidationError("🌙") ?? "", /printable ASCII/);
  assert.match(getTelegramManualThreadDisplayNameValidationError("line\nbreak") ?? "", /printable ASCII/);
  assert.match(getTelegramManualThreadDisplayNameValidationError("x".repeat(97)) ?? "", /96/);
});

test("Thread titles are trimmed and capped to Telegram's 128 character limit", () => {
  const name = getTelegramTopicName(
    {
      instanceId: "inst-a",
      profileKey: "cwd:/repo",
      threadName: `repo ${"x".repeat(200)}`,
    },
    "  Pi   {threadName}  ",
  );
  assert.equal(name.length, 128);
  assert.match(name, /^Pi repo x+/);
});

test("Threads retains the exact name functions and legacy template input signature", () => {
  for (const name of ["chooseTelegramThreadName", "createTelegramThreadName",
    "getTelegramManualThreadDisplayNameValidationError", "getTelegramTopicIdentityName",
    "getTelegramTopicThreadNameValidationError", "isTelegramTopicThreadNameValidForSlot",
    "getTelegramTopicName", "getTelegramTopicTitleForThreadName"] as const) {
    assert.equal(Threads[name], Naming[name]);
  }
  const oldInput: Threads.TelegramThreadNameInput = { seed: "seed", cwd: "/repo", role: "leader" };
  const nameInput: Naming.TelegramThreadNameInput = oldInput;
  assert.equal(Naming.createTelegramThreadName(nameInput), Threads.createTelegramThreadName(oldInput));
  const title = Threads.getTelegramTopicName({
    profileKey: "profile", instanceId: "instance", threadName: " Display name ",
    owner: { kind: "leader", cwd: "/repo" }, preferredSlot: "Z",
    workspaceBindingKey: "binding", workspaceCwd: "/repo",
  }, "{threadName}:{profileKey}:{instanceId}:{slot}", "B");
  assert.equal(title, "Display name:profile:instance:B");
});

test("Thread palette order and exhaustion preserve fallback and random edge behavior", () => {
  const occupied = Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ").flatMap(slot =>
    Array.from({ length: 5 }, (_, index) => Naming.chooseTelegramThreadName({ slot, getRandom: () => index / 5 })!));
  assert.equal(new Set(occupied).size, 130);
  assert.equal(Naming.chooseTelegramThreadName({ slot: "A", occupied }), undefined);
  assert.equal(Naming.chooseTelegramThreadName({ slot: "A", occupied: occupied.slice(0, 5), getRandom: () => 0 }), "Beacon");
  assert.equal(Naming.chooseTelegramThreadName({ slot: undefined }), undefined);
  assert.equal(Naming.chooseTelegramThreadName({ slot: "a" }), undefined);
  assert.equal(Naming.chooseTelegramThreadName({ slot: "A", getRandom: () => -1 }), "Atlas");
  assert.equal(Naming.chooseTelegramThreadName({ slot: "A", getRandom: () => Infinity }), "Ashen");
  assert.throws(() => Naming.chooseTelegramThreadName({ slot: "A", getRandom: () => NaN }), TypeError);
  assert.equal(Naming.chooseTelegramThreadName({ slot: "A", entropy: 0 }), "Atlas");
});

test("Thread identity normalization and title fallback retain their different bounds", () => {
  assert.equal(Naming.normalizeTelegramTopicTargetThreadName("  Alpha\t Beta \n"), "Alpha Beta");
  assert.equal(Naming.getTelegramTopicIdentityName("  🌙 Alpha  "), "🌙 Alpha");
  assert.equal(Naming.getTelegramThreadNameLeadingSlot(" Jname "), "J");
  assert.equal(Naming.getTelegramThreadNameLeadingSlot("name"), undefined);
  assert.equal(Naming.normalizeTelegramTopicTargetThreadName("x".repeat(100)).length, 96);
  assert.equal(Naming.getTelegramTopicName({ instanceId: "id", profileKey: "profile", threadName: " " }, "{threadName}"), "profile");
  assert.equal(Naming.getTelegramTopicName({ instanceId: "id", profileKey: "profile" }, "", "A"), "A");
  assert.equal(Naming.getTelegramTopicName({ instanceId: "id", profileKey: "profile" }, ""), "Pi");
});
