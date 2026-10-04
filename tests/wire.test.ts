/**
 * Wire-value primitive boundary regressions
 * Zones: wire fields, record shape, integer bounds
 * Covers shallow inspection without schema approval, coercion or normalization.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { hasOnlyWireKeys, isNonEmptyWireString, isNonNegativeWireInteger, isWireRecord } from "../lib/wire.ts";

test("Wire record inspection retains non-array object semantics, including prototypes", () => {
  for (const value of [undefined, null, false, true, 0, 1, "", "text", 1n, Symbol("field"), [], () => ({})]) {
    assert.equal(isWireRecord(value), false);
  }
  const inherited = Object.create({ inherited: true }) as Record<string, unknown>;
  for (const value of [{}, Object.create(null), inherited, new Date(0), new Map()]) {
    assert.equal(isWireRecord(value), true);
  }
  assert.equal(Object.getPrototypeOf(inherited).inherited, true);
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.throws(() => isWireRecord(revoked.proxy), TypeError, "inspection errors must not become schema absence");
});

test("Wire allowed-key inspection rejects unknown enumerable keys without requiring all keys", () => {
  assert.equal(hasOnlyWireKeys({}, ["required"]), true);
  assert.equal(hasOnlyWireKeys({ optional: undefined }, ["optional", "required"]), true);
  assert.equal(hasOnlyWireKeys({ known: 1, unknown: 2 }, ["known"]), false);
  assert.equal(hasOnlyWireKeys({ known: 1 }, ["known", "known"]), true);
  const value = Object.create({ inherited: true }) as Record<string | symbol, unknown>;
  value[Symbol("symbol")] = true;
  Object.defineProperty(value, "hidden", { value: true });
  const before = Object.getOwnPropertyDescriptors(value);
  assert.equal(hasOnlyWireKeys(value, []), true, "inherited, symbol and non-enumerable keys are outside this predicate");
  Object.defineProperty(value, "__proto__", { value: true, enumerable: true });
  assert.equal(hasOnlyWireKeys(value, []), false);
  assert.equal(hasOnlyWireKeys(value, ["__proto__"]), true);
  assert.deepEqual(Object.getOwnPropertyDescriptors(value).hidden, before.hidden);
  const failure = new Error("ownKeys failed");
  assert.throws(() => hasOnlyWireKeys(new Proxy({}, { ownKeys() { throw failure; } }), []), error => error === failure);
});

test("Wire non-empty strings preserve whitespace and reject coercion", () => {
  for (const value of ["text", " ", "\t\n", "\u0000"]) assert.equal(isNonEmptyWireString(value), true);
  for (const value of ["", undefined, null, 0, false, [], {}, new String("text")]) {
    assert.equal(isNonEmptyWireString(value), false);
  }
});

test("Wire non-negative integers keep exact safe-number boundaries without coercion", () => {
  for (const value of [0, -0, 1, Number.MAX_SAFE_INTEGER]) assert.equal(isNonNegativeWireInteger(value), true);
  for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, -Infinity,
    "0", "1", 1n, null, undefined, true, new Number(1), Symbol("integer")]) {
    assert.equal(isNonNegativeWireInteger(value), false);
  }
  const value = { valueOf() { throw new Error("must not coerce"); } };
  assert.equal(isNonNegativeWireInteger(value), false);
});
