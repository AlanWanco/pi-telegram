/**
 * Workspace slot allocation policy
 * Zones: telegram, workspace identity
 * Owns legacy letter selection, non-scarce hash slot IDs, and inactivity ordering.
 * Excludes liveness discovery, persistence, routing, and Telegram deletion;
 * a selection is a proposal, never authority to retire a binding.
 */

import { createHash } from "node:crypto";

export const TELEGRAM_WORKSPACE_SLOTS = "abcdefghijklmnopqrstuvwxyz";
const HASH_SLOT_PREFIX = "H";

export function isTelegramWorkspaceSlotId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return /^[A-Z]$/u.test(value) || /^H[0-9A-F]{64}$/u.test(value);
}

export function isTelegramHashWorkspaceSlotId(value: unknown): value is string {
  return typeof value === "string" && /^H[0-9A-F]{64}$/u.test(value);
}

export function createTelegramWorkspaceHashSlotId(
  bindingKey: string,
  occupiedSlots: readonly string[] = [],
): string | undefined {
  if (!bindingKey) return undefined;
  const digest = createHash("sha256")
    .update(bindingKey)
    .digest("hex")
    .toUpperCase();
  const occupied = new Set(occupiedSlots.map((slot) => slot.toUpperCase()));
  const candidate = `${HASH_SLOT_PREFIX}${digest}`;
  return occupied.has(candidate) ? undefined : candidate;
}

export function getTelegramWorkspaceSlotPaletteLetter(slot: string): string | undefined {
  if (/^[A-Z]$/u.test(slot)) return slot;
  if (!isTelegramHashWorkspaceSlotId(slot)) return undefined;
  return String.fromCharCode(65 + Number.parseInt(slot[1]!, 16));
}

export function getTelegramWorkspaceSlotDisplayLabel(
  slot: string,
  peerSlots: readonly string[] = [],
): string {
  const normalized = slot.toUpperCase();
  if (!isTelegramWorkspaceSlotId(normalized)) return "?";
  if (!isTelegramHashWorkspaceSlotId(normalized) || peerSlots.length === 0) return normalized;
  let length = Math.min(8, normalized.length);
  while (length < normalized.length && peerSlots.some((peer) =>
    peer.toUpperCase() !== normalized &&
    isTelegramHashWorkspaceSlotId(peer.toUpperCase()) &&
    peer.toUpperCase().slice(0, length) === normalized.slice(0, length),
  )) {
    length = Math.min(normalized.length, length + 2);
  }
  return normalized.slice(0, length);
}

export const formatTelegramWorkspaceSlotDisplayLabel = getTelegramWorkspaceSlotDisplayLabel;

export class TelegramWorkspaceSlotUnavailableError extends Error {
  constructor() {
    super("Telegram Workspace slot reservation is unavailable.");
    this.name = "TelegramWorkspaceSlotUnavailableError";
  }
}

export interface TelegramWorkspaceSlotOccupancy {
  bindingKey: string;
  slot: string;
  inactiveSinceMs?: number;
  protection: "eligible" | "protected" | "unknown";
}

export type TelegramWorkspaceSlotAllocation =
  | { kind: "free"; slot: string }
  | { kind: "reclaim"; candidate: TelegramWorkspaceSlotOccupancy }
  | { kind: "blocked"; reason: "invalid-state" | "protected-capacity" };

function isSlot(slot: string): boolean {
  return slot === slot.toLowerCase() && isTelegramWorkspaceSlotId(slot.toUpperCase());
}

function isValidSnapshot(
  bindings: readonly TelegramWorkspaceSlotOccupancy[],
  reservedSlots: readonly string[],
  nowMs: number,
): boolean {
  if (!Number.isFinite(nowMs) || nowMs < 0) return false;
  const slots = new Set<string>();
  const keys = new Set<string>();
  for (const binding of bindings) {
    if (!isSlot(binding.slot) || !binding.bindingKey ||
        slots.has(binding.slot) || keys.has(binding.bindingKey)) return false;
    slots.add(binding.slot);
    keys.add(binding.bindingKey);
  }
  return reservedSlots.every(isSlot);
}

function eligibleByInactivity(
  bindings: readonly TelegramWorkspaceSlotOccupancy[],
  reservedSlots: readonly string[],
  nowMs: number,
): TelegramWorkspaceSlotOccupancy[] {
  const reserved = new Set(reservedSlots);
  return bindings.filter((binding) =>
    /^[a-z]$/u.test(binding.slot) &&
    binding.protection === "eligible" &&
    !reserved.has(binding.slot) &&
    typeof binding.inactiveSinceMs === "number" &&
    Number.isFinite(binding.inactiveSinceMs) &&
    binding.inactiveSinceMs >= 0 &&
    binding.inactiveSinceMs <= nowMs,
  ).sort((left, right) =>
    left.inactiveSinceMs! - right.inactiveSinceMs! ||
    left.slot.localeCompare(right.slot),
  );
}

/** Caller must recheck exact ownership and protected work before retirement. */
export function planTelegramWorkspaceSlotAllocation(input: {
  bindings: readonly TelegramWorkspaceSlotOccupancy[];
  reservedSlots: readonly string[];
  nowMs: number;
}): TelegramWorkspaceSlotAllocation {
  const { bindings, reservedSlots, nowMs } = input;
  if (!isValidSnapshot(bindings, reservedSlots, nowMs)) {
    return { kind: "blocked", reason: "invalid-state" };
  }
  const occupied = new Set([
    ...bindings.map((binding) => binding.slot),
    ...reservedSlots,
  ]);
  for (const slot of TELEGRAM_WORKSPACE_SLOTS) {
    if (!occupied.has(slot)) return { kind: "free", slot };
  }
  const candidate = eligibleByInactivity(bindings, reservedSlots, nowMs)[0];
  return candidate
    ? { kind: "reclaim", candidate: { ...candidate } }
    : { kind: "blocked", reason: "protected-capacity" };
}
