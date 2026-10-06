/**
 * Workspace slot allocation policy
 * Zones: telegram, workspace identity
 * Owns legacy letter selection, non-scarce hash slot IDs, and inactivity ordering.
 * Excludes liveness discovery, persistence, routing, and Telegram deletion;
 * a selection is a proposal, never authority to retire a binding.
 */
export declare const TELEGRAM_WORKSPACE_SLOTS = "abcdefghijklmnopqrstuvwxyz";
export declare function isTelegramWorkspaceSlotId(value: unknown): value is string;
export declare function isTelegramHashWorkspaceSlotId(value: unknown): value is string;
export declare function createTelegramWorkspaceHashSlotId(bindingKey: string, occupiedSlots?: readonly string[]): string | undefined;
export declare function getTelegramWorkspaceSlotPaletteLetter(slot: string): string | undefined;
export declare function getTelegramWorkspaceSlotDisplayLabel(slot: string, peerSlots?: readonly string[]): string;
export declare const formatTelegramWorkspaceSlotDisplayLabel: typeof getTelegramWorkspaceSlotDisplayLabel;
export declare class TelegramWorkspaceSlotUnavailableError extends Error {
    constructor();
}
export interface TelegramWorkspaceSlotOccupancy {
    bindingKey: string;
    slot: string;
    inactiveSinceMs?: number;
    protection: "eligible" | "protected" | "unknown";
}
export type TelegramWorkspaceSlotAllocation = {
    kind: "free";
    slot: string;
} | {
    kind: "reclaim";
    candidate: TelegramWorkspaceSlotOccupancy;
} | {
    kind: "blocked";
    reason: "invalid-state" | "protected-capacity";
};
/** Caller must recheck exact ownership and protected work before retirement. */
export declare function planTelegramWorkspaceSlotAllocation(input: {
    bindings: readonly TelegramWorkspaceSlotOccupancy[];
    reservedSlots: readonly string[];
    nowMs: number;
}): TelegramWorkspaceSlotAllocation;
