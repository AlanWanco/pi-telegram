/**
 * Telegram disposable runtime recovery classification
 * Zones: filesystem diagnostics, unclean-shutdown recovery
 * Owns fail-safe classification of temporary ownership and routing artifacts
 */
import { existsSync, lstatSync, readFileSync, readdirSync, rmdirSync, rmSync, } from "node:fs";
import { basename, dirname, join } from "node:path";
import { decodeTelegramSessionDirectoryName, getTelegramProfilePathSuffix } from "./paths.js";
import { isProcessAlive as defaultIsProcessAlive, parseTelegramLockEntry, TELEGRAM_BUS_LEADER_STALE_HEARTBEAT_MS, withTelegramFileTransaction, } from "./locks.js";
const OWNER_FILE_PATTERN = /^owner\.([A-Za-z0-9-]+)\.json$/u;
const RECLAIM_FILE_PATTERN = /^owner\.reclaim\.(\d+)\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/u;
function corruption(kind, path, reason) {
    return { source: kind, corrupt: { kind, path, reason }, ownerPids: [] };
}
function inspectOwners(path, nowMs, staleHeartbeatMs) {
    if (!existsSync(path))
        return { source: "owners", ownerPids: [] };
    let value;
    try {
        value = JSON.parse(readFileSync(path, "utf8"));
    }
    catch {
        return corruption("owners", path, "owners.json is not valid JSON");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return corruption("owners", path, "owners.json is not an object");
    }
    const ownerPids = Object.values(value).flatMap((candidate) => {
        const entry = parseTelegramLockEntry(candidate);
        if (!entry ||
            (typeof entry.heartbeatMs === "number" &&
                nowMs - entry.heartbeatMs > staleHeartbeatMs)) {
            return [];
        }
        return [entry.pid];
    });
    return { source: "owners", ownerPids };
}
function inspectState(path) {
    if (!existsSync(path))
        return { source: "state", ownerPids: [] };
    try {
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 8 * 1024 * 1024)
            return corruption("state", path, `${basename(path)} cannot be safely inspected`);
        JSON.parse(readFileSync(path, "utf8"));
        return { source: "state", ownerPids: [] };
    }
    catch {
        return corruption("state", path, `${basename(path)} is not valid JSON`);
    }
}
function parseTransactionOwner(path) {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    const pid = value.pid;
    const acquiredAtMs = value.acquiredAtMs;
    const generation = value.generation;
    return typeof pid === "number" &&
        typeof acquiredAtMs === "number" &&
        typeof generation === "string"
        ? pid
        : undefined;
}
function inspectTransaction(path) {
    if (!existsSync(path))
        return { source: "transaction", ownerPids: [] };
    try {
        const stat = lstatSync(path);
        let ownerPath;
        let expectedOwnerPid;
        if (stat.isDirectory()) {
            const entries = readdirSync(path);
            if (entries.length !== 1) {
                return corruption("transaction", path, "transaction guard has an unverifiable directory shape");
            }
            const entry = entries[0];
            const ownerMatch = OWNER_FILE_PATTERN.exec(entry);
            const reclaimMatch = RECLAIM_FILE_PATTERN.exec(entry);
            if (!ownerMatch && !reclaimMatch) {
                return corruption("transaction", path, "transaction guard has an unrecognized owner marker");
            }
            ownerPath = join(path, entry);
            expectedOwnerPid = reclaimMatch ? Number(reclaimMatch[1]) : undefined;
            const ownerPid = parseTransactionOwner(ownerPath);
            if (ownerPid === undefined) {
                return corruption("transaction", path, "transaction guard owner metadata is invalid");
            }
            if (ownerMatch) {
                const value = JSON.parse(readFileSync(ownerPath, "utf8"));
                if (value.generation !== ownerMatch[1]) {
                    return corruption("transaction", path, "transaction guard generation does not match its owner marker");
                }
            }
            return {
                source: "transaction",
                ownerPids: [expectedOwnerPid ?? ownerPid],
            };
        }
        if (!stat.isFile()) {
            return corruption("transaction", path, "transaction guard has an unsupported filesystem type");
        }
        ownerPath = path;
        const ownerPid = parseTransactionOwner(ownerPath);
        return ownerPid === undefined
            ? corruption("transaction", path, "legacy transaction guard owner metadata is invalid")
            : { source: "transaction", ownerPids: [ownerPid] };
    }
    catch {
        return corruption("transaction", path, "transaction guard cannot be inspected");
    }
}
/**
 * Classify disposable runtime corruption without mutating any artifact.
 *
 * Corruption remains recoverable only when neither owners.json nor a
 * verifiable transaction marker identifies a process that is still alive.
 */
export function classifyTelegramRuntimeRecovery(options) {
    const transactionPath = options.transactionPath ?? `${options.ownersPath}.transaction`;
    const inspections = [
        inspectOwners(options.ownersPath, options.nowMs ?? Date.now(), options.staleHeartbeatMs ?? TELEGRAM_BUS_LEADER_STALE_HEARTBEAT_MS),
        ...(options.statePaths ?? []).map(inspectState),
        inspectTransaction(transactionPath),
    ];
    const artifacts = inspections.flatMap((inspection) => inspection.corrupt ? [inspection.corrupt] : []);
    if (artifacts.length === 0)
        return { kind: "clean" };
    const processAlive = options.isProcessAlive ?? defaultIsProcessAlive;
    const ignoredTransactionPids = new Set(options.ignoredTransactionPids ?? []);
    const livePids = [
        ...new Set(inspections.flatMap((inspection) => inspection.ownerPids.filter((pid) => !(inspection.source === "transaction" &&
            ignoredTransactionPids.has(pid)) && processAlive(pid)))),
    ].sort((left, right) => left - right);
    return livePids.length > 0
        ? { kind: "blocked-live-owner", artifacts, livePids }
        : { kind: "recoverable-corruption", artifacts };
}
/**
 * Delete classifier-approved disposable corruption under two guards.
 *
 * A dedicated recovery transaction serializes recoverers. The ownership
 * transaction then prevents a new Telegram owner from appearing between the
 * final classification and mutation. Damaged ownership debris and canonical
 * state are deleted (operator policy: unfinished Restores in unreadable state
 * are acceptable loss). Durable config and diagnostics never enter the set.
 */
export function recoverTelegramRuntimeState(options) {
    const transactionPath = options.transactionPath ?? `${options.ownersPath}.transaction`;
    const recoveryTransactionPath = options.recoveryTransactionPath ??
        join(dirname(options.ownersPath), "runtime-recovery.transaction");
    const removePath = options.removePath ?? ((path) => rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }));
    const classificationOptions = {
        ownersPath: options.ownersPath,
        statePaths: options.statePaths,
        transactionPath,
        isProcessAlive: options.isProcessAlive,
        nowMs: options.nowMs ?? options.getNowMs?.(),
        staleHeartbeatMs: options.staleHeartbeatMs,
    };
    return withTelegramFileTransaction(recoveryTransactionPath, () => {
        const initial = classifyTelegramRuntimeRecovery(classificationOptions);
        if (initial.kind === "clean")
            return { kind: "not-needed" };
        if (initial.kind === "blocked-live-owner") {
            return {
                kind: "blocked-live-owner",
                livePids: initial.livePids,
            };
        }
        const deletedPaths = [];
        const recoveredArtifacts = [];
        const deleteArtifact = (artifact) => {
            if (!existsSync(artifact.path))
                return;
            removePath(artifact.path);
            deletedPaths.push(artifact.path);
            recoveredArtifacts.push(artifact);
        };
        for (const artifact of initial.artifacts) {
            if (artifact.kind === "transaction")
                deleteArtifact(artifact);
        }
        return withTelegramFileTransaction(transactionPath, () => {
            const current = classifyTelegramRuntimeRecovery({
                ...classificationOptions,
                ignoredTransactionPids: [process.pid],
            });
            if (current.kind === "blocked-live-owner") {
                return {
                    kind: "blocked-live-owner",
                    livePids: current.livePids,
                    ...(deletedPaths.length > 0 ? { deletedPaths } : {}),
                };
            }
            if (current.kind === "recoverable-corruption") {
                for (const artifact of current.artifacts) {
                    if (artifact.kind !== "transaction")
                        deleteArtifact(artifact);
                }
            }
            return recoveredArtifacts.length > 0
                ? {
                    kind: "recovered",
                    artifacts: recoveredArtifacts,
                    deletedPaths,
                }
                : { kind: "not-needed" };
        }, options.transactionOptions);
    }, options.transactionOptions);
}
/**
 * Remove recovery folders written by earlier releases (runtime root and session folders).
 * Current releases delete damaged files instead of quarantining them; nothing reads these copies.
 */
export function removeTelegramLegacyRecoveryStorage(runtimeDir) {
    const removed = [];
    const remove = (path) => {
        try {
            if (!lstatSync(path).isDirectory())
                return;
            rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
            removed.push(path);
        }
        catch {
            // Best-effort housekeeping; a later startup retries.
        }
    };
    remove(join(runtimeDir, "recovery"));
    let sessions = [];
    try {
        sessions = readdirSync(join(runtimeDir, "sessions"));
    }
    catch { /* no sessions yet */ }
    for (const session of sessions)
        remove(join(runtimeDir, "sessions", session, "recovery"));
    return removed;
}
const TELEGRAM_SESSION_SWEEP_INTERVAL_MS = 10 * 60 * 1000;
/**
 * Leader housekeeping (operator policy): a session without a Workspace slot loses its
 * current-profile journal family; the folder disappears once no profile uses it.
 */
export function createTelegramSessionFolderSweeper(deps) {
    const getNowMs = deps.getNowMs ?? Date.now;
    const intervalMs = deps.intervalMs ?? TELEGRAM_SESSION_SWEEP_INTERVAL_MS;
    let lastSweepAtMs;
    return {
        sweep() {
            const now = getNowMs();
            if (lastSweepAtMs !== undefined && now - lastSweepAtMs < intervalMs)
                return [];
            lastSweepAtMs = now;
            const sessionsDir = deps.getSessionsDir();
            const kept = new Set(deps.getKeptSessionIds());
            const suffix = getTelegramProfilePathSuffix(deps.getProfileName()).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
            const family = new RegExp(`^journal\\.[a-f0-9]{16}${suffix}\\.json(?:\\.segments|\\.retained)?$`, "u");
            const removed = [];
            let names;
            try {
                names = readdirSync(sessionsDir);
            }
            catch {
                return removed;
            }
            for (const name of names) {
                const sessionId = decodeTelegramSessionDirectoryName(name);
                if (sessionId === undefined || kept.has(sessionId))
                    continue;
                const folder = join(sessionsDir, name);
                try {
                    if (!lstatSync(folder).isDirectory())
                        continue;
                    for (const entry of readdirSync(folder)) {
                        if (!family.test(entry))
                            continue;
                        const path = join(folder, entry);
                        rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
                        removed.push(path);
                    }
                    if (readdirSync(folder).length === 0) {
                        rmdirSync(folder);
                        removed.push(folder);
                    }
                }
                catch {
                    // Best-effort housekeeping; the next sweep retries.
                }
            }
            return removed;
        },
    };
}
/** Build the `/telegram-connect` recovery boundary around runtime artifacts. */
export function createTelegramPollingStartRecoveryHandler(deps) {
    return async () => {
        const ownersPath = deps.getOwnersPath();
        const statePaths = deps.getStatePaths();
        const classification = classifyTelegramRuntimeRecovery({
            ownersPath,
            statePaths,
        });
        if (classification.kind === "clean")
            return { kind: "unhandled" };
        if (classification.kind === "blocked-live-owner") {
            return {
                kind: "blocked",
                message: `Telegram temporary state is damaged, but owner process ${classification.livePids.join(", ")} is still live. Restart that Pi instance, then run /telegram-connect again.`,
            };
        }
        try {
            await deps.suspendPolling();
        }
        catch (error) {
            deps.recordRuntimeEvent?.("recovery", error, {
                phase: "suspend-before-reset",
            });
            return {
                kind: "blocked",
                message: "Telegram polling could not stop safely, so temporary state was not reset. Restart this Pi instance and run /telegram-connect again.",
            };
        }
        try {
            await deps.releaseOwnership?.();
        }
        catch (error) {
            deps.recordRuntimeEvent?.("recovery", error, {
                phase: "release-before-reset",
            });
        }
        try {
            const recovery = recoverTelegramRuntimeState({ ownersPath, statePaths });
            if (recovery.kind === "blocked-live-owner") {
                return {
                    kind: "blocked",
                    message: `Telegram temporary state changed during recovery and is now protected by owner process ${recovery.livePids.join(", ")}. Restart that Pi instance, then run /telegram-connect again.`,
                };
            }
            return {
                kind: "retry",
                message: recovery.kind === "recovered"
                    ? "Telegram temporary state was damaged after an unclean shutdown and has been reset."
                    : "Telegram temporary state was recovered by another Pi instance.",
            };
        }
        catch (error) {
            deps.recordRuntimeEvent?.("recovery", error, { phase: "runtime-reset" });
            return {
                kind: "blocked",
                message: "Telegram temporary-state recovery failed. Restart this Pi instance and run /telegram-connect again.",
            };
        }
    };
}
