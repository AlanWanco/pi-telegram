/**
 * Telegram disposable runtime recovery classification
 * Zones: filesystem diagnostics, unclean-shutdown recovery
 * Owns fail-safe classification of temporary ownership and routing artifacts
 */
import { type TelegramFileTransactionOptions } from "./locks.ts";
export type TelegramRuntimeArtifactKind = "owners" | "state" | "transaction";
export interface TelegramRuntimeCorruptArtifact {
    kind: TelegramRuntimeArtifactKind;
    path: string;
    reason: string;
}
export type TelegramRuntimeRecoveryClassification = {
    kind: "clean";
} | {
    kind: "recoverable-corruption";
    artifacts: TelegramRuntimeCorruptArtifact[];
} | {
    kind: "blocked-live-owner";
    artifacts: TelegramRuntimeCorruptArtifact[];
    livePids: number[];
};
export interface TelegramRuntimeRecoveryClassificationOptions {
    ownersPath: string;
    statePaths?: readonly string[];
    transactionPath?: string;
    isProcessAlive?: (pid: number) => boolean;
    nowMs?: number;
    staleHeartbeatMs?: number;
    ignoredTransactionPids?: readonly number[];
}
export type TelegramRuntimeRecoveryResult = {
    kind: "not-needed";
} | {
    kind: "blocked-live-owner";
    livePids: number[];
    deletedPaths?: string[];
} | {
    kind: "recovered";
    artifacts: TelegramRuntimeCorruptArtifact[];
    /** Damaged disposable artifacts deleted per the approved corruption policy; nothing is quarantined. */
    deletedPaths: string[];
};
export interface TelegramRuntimeRecoveryOptions extends TelegramRuntimeRecoveryClassificationOptions {
    recoveryTransactionPath?: string;
    pid?: number;
    getNowMs?: () => number;
    /** Fault-injection seam; production uses bounded-retry recursive removal. */
    removePath?: (path: string) => void;
    transactionOptions?: TelegramFileTransactionOptions;
}
export type TelegramPollingStartRecoveryDecision = {
    kind: "unhandled";
} | {
    kind: "retry";
    message: string;
} | {
    kind: "blocked";
    message: string;
};
export interface TelegramPollingStartRecoveryHandlerDeps {
    getOwnersPath: () => string;
    getStatePaths: () => readonly string[];
    suspendPolling: () => Promise<unknown>;
    releaseOwnership?: () => unknown | Promise<unknown>;
    recordRuntimeEvent?: (category: string, error: unknown, details?: Record<string, unknown>) => void;
}
/**
 * Classify disposable runtime corruption without mutating any artifact.
 *
 * Corruption remains recoverable only when neither owners.json nor a
 * verifiable transaction marker identifies a process that is still alive.
 */
export declare function classifyTelegramRuntimeRecovery(options: TelegramRuntimeRecoveryClassificationOptions): TelegramRuntimeRecoveryClassification;
/**
 * Delete classifier-approved disposable corruption under two guards.
 *
 * A dedicated recovery transaction serializes recoverers. The ownership
 * transaction then prevents a new Telegram owner from appearing between the
 * final classification and mutation. Damaged ownership debris and canonical
 * state are deleted (operator policy: unfinished Restores in unreadable state
 * are acceptable loss). Durable config and diagnostics never enter the set.
 */
export declare function recoverTelegramRuntimeState(options: TelegramRuntimeRecoveryOptions): TelegramRuntimeRecoveryResult;
/**
 * Remove recovery folders written by earlier releases (runtime root and session folders).
 * Current releases delete damaged files instead of quarantining them; nothing reads these copies.
 */
export declare function removeTelegramLegacyRecoveryStorage(runtimeDir: string): string[];
export interface TelegramSessionFolderSweeperDeps {
    getSessionsDir: () => string;
    getProfileName: () => string | undefined;
    /** Sessions holding a Workspace slot binding, live registrations and this process's own session. */
    getKeptSessionIds: () => Iterable<string | undefined>;
    getNowMs?: () => number;
    intervalMs?: number;
}
/**
 * Leader housekeeping (operator policy): a session without a Workspace slot loses its
 * current-profile journal family; the folder disappears once no profile uses it.
 */
export declare function createTelegramSessionFolderSweeper(deps: TelegramSessionFolderSweeperDeps): {
    sweep: () => string[];
};
/** Build the `/telegram-connect` recovery boundary around runtime artifacts. */
export declare function createTelegramPollingStartRecoveryHandler(deps: TelegramPollingStartRecoveryHandlerDeps): () => Promise<TelegramPollingStartRecoveryDecision>;
