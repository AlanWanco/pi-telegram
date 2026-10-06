/**
 * Telegram Thread naming rules and manual-name interaction
 * Zones: thread identity names, palettes, title formatting, runtime controls
 * Owns name/title value policy and one expiring exact-target dialog per session scope.
 * Excludes occupancy/slot allocation, display-mode projection, transport and API/store effects.
 */
import { areTelegramTargetsEqual as sameTarget } from "./target.js";
import { getTelegramWorkspaceSlotDisplayLabel, getTelegramWorkspaceSlotPaletteLetter, } from "./workspace-slots.js";
export const TELEGRAM_THREAD_NAME_DIALOG_TTL_MS = 5 * 60_000;
function targetKey(target) {
    return `${target.chatId}:${target.threadId ?? "chat"}`;
}
function cloneCandidate(candidate) {
    return { ...candidate, target: { ...candidate.target } };
}
export function createTelegramThreadNameDialogRuntime(options) {
    const ttlMs = options?.ttlMs ?? TELEGRAM_THREAD_NAME_DIALOG_TTL_MS;
    const nowMs = options?.nowMs ?? Date.now;
    const candidates = new Map();
    const current = (scope, target) => {
        const key = targetKey(target);
        const candidate = candidates.get(key);
        if (!candidate || candidate.scope !== scope ||
            !sameTarget(candidate.target, target))
            return undefined;
        if (candidate.expiresAtMs <= nowMs()) {
            candidates.delete(key);
            return undefined;
        }
        return candidate;
    };
    return {
        open(input) {
            const candidate = {
                scope: input.scope,
                target: { ...input.target },
                dialogMessageId: input.dialogMessageId,
                phase: "input",
                expiresAtMs: nowMs() + ttlMs,
            };
            candidates.set(targetKey(input.target), candidate);
            return cloneCandidate(candidate);
        },
        select(input) {
            const candidate = current(input.scope, input.target);
            if (!candidate || candidate.dialogMessageId !== input.dialogMessageId) {
                return { kind: "expired" };
            }
            candidates.delete(targetKey(input.target));
            return { kind: input.action };
        },
        consumeName(input) {
            const candidate = current(input.scope, input.target);
            if (!candidate || candidate.phase !== "input")
                return { kind: "none" };
            const name = input.text.trim();
            if (!name)
                return { kind: "empty" };
            candidates.delete(targetKey(input.target));
            return { kind: "name", name };
        },
        clearScope(scope) {
            for (const [key, candidate] of candidates) {
                if (candidate.scope === scope)
                    candidates.delete(key);
            }
        },
        inspect(target) {
            const candidate = candidates.get(targetKey(target));
            if (!candidate || candidate.expiresAtMs <= nowMs()) {
                candidates.delete(targetKey(target));
                return undefined;
            }
            return cloneCandidate(candidate);
        },
    };
}
function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}
function getWorkspaceHint(cwd) {
    if (!cwd)
        return undefined;
    const parts = cwd.split("/").filter(Boolean);
    const last = parts.at(-1)?.trim();
    if (!last)
        return undefined;
    return (last
        .replace(/[^\p{L}\p{N}._-]+/gu, " ")
        .trim()
        .slice(0, 32) || undefined);
}
export function createTelegramThreadName(input) {
    const workspace = getWorkspaceHint(input.cwd);
    const roleMark = input.role === "leader"
        ? "Leader"
        : input.role === "follower"
            ? "Follower"
            : undefined;
    const slot = input.slot ? `Thread ${input.slot}` : undefined;
    const peerSalt = input.peers?.slice().sort().join("|") ?? "";
    const fallback = `Instance ${hashString(`${input.seed}|${input.cwd ?? ""}|${input.role ?? ""}|${peerSalt}|${input.slot ?? ""}`)
        .toString(36)
        .slice(0, 4)}`;
    return ([slot, workspace, roleMark].filter(Boolean).join(" ").slice(0, 96) ||
        fallback);
}
export function normalizeTelegramTopicTargetThreadName(threadName) {
    return threadName.replace(/\s+/g, " ").trim().slice(0, 96);
}
function getGraphemeSegments(value) {
    const segmenter = Intl.Segmenter;
    if (!segmenter)
        return Array.from(value);
    return Array.from(new segmenter(undefined, { granularity: "grapheme" }).segment(value), (part) => part.segment);
}
export function getTelegramTopicIdentityName(threadName) {
    return getGraphemeSegments(normalizeTelegramTopicTargetThreadName(threadName))
        .join("")
        .trim();
}
const TELEGRAM_THREAD_NAME_PALETTE = {
    A: ["Atlas", "Aster", "Aurora", "Anchor", "Ashen"],
    B: ["Beacon", "Briar", "Boreal", "Birch", "Bison"],
    C: ["Cedar", "Comet", "Cipher", "Coral", "Cinder"],
    D: ["Delta", "Dawn", "Drift", "Dune", "Dagger"],
    E: ["Ember", "Echo", "Eagle", "Eden", "Elder"],
    F: ["Falcon", "Fjord", "Flint", "Forest", "Fable"],
    G: ["Grove", "Glade", "Glyph", "Garnet", "Gale"],
    H: ["Harbor", "Hawk", "Hazel", "Helix", "Haven"],
    I: ["Iris", "Ivory", "Iron", "Isle", "Idea"],
    J: ["Jade", "Juno", "Jolt", "Jewel", "Jasper"],
    K: ["Kite", "Karma", "Kernel", "Kodiak", "Kelp"],
    L: ["Lumen", "Laurel", "Lynx", "Lotus", "Lagoon"],
    M: ["Maple", "Meteor", "Meadow", "Marble", "Moss"],
    N: ["Nimbus", "Nova", "Nectar", "North", "Noble"],
    O: ["Orion", "Onyx", "Opal", "Orbit", "Olive"],
    P: ["Pine", "Pulse", "Praxis", "Pebble", "Prism"],
    Q: ["Quartz", "Quill", "Quasar", "Quest", "Quiver"],
    R: ["River", "Raven", "Rune", "Reef", "Ridge"],
    S: ["Spruce", "Solar", "Signal", "Stone", "Sable"],
    T: ["Timber", "Talon", "Terra", "Torch", "Tide"],
    U: ["Umber", "Unity", "Ursa", "Uplink", "Ulmus"],
    V: ["Violet", "Vector", "Vista", "Vale", "Vortex"],
    W: ["Willow", "Warden", "Wave", "Winter", "Wisp"],
    X: ["Xenon", "Xylem", "Xavier", "Xylo", "Xerus"],
    Y: ["Yarrow", "Yonder", "Yukon", "Yale", "Yogi"],
    Z: ["Zenith", "Zephyr", "Zircon", "Zebra", "Zion"],
};
export function chooseTelegramThreadName(input) {
    const paletteSlot = input.slot
        ? getTelegramWorkspaceSlotPaletteLetter(input.slot)
        : undefined;
    if (!paletteSlot)
        return undefined;
    const names = TELEGRAM_THREAD_NAME_PALETTE[paletteSlot];
    if (!names || names.length === 0)
        return undefined;
    const occupied = new Set((input.occupied ?? []).map((name) => getTelegramTopicIdentityName(name)));
    const start = input.getRandom
        ? Math.max(0, Math.min(names.length - 1, Math.floor(input.getRandom() * names.length)))
        : getTelegramThreadNameEntropyIndex(input.entropy, names.length);
    for (let offset = 0; offset < names.length; offset += 1) {
        const name = names[(start + offset) % names.length];
        if (!occupied.has(getTelegramTopicIdentityName(name)))
            return name;
    }
    for (const paletteSlot of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
        for (const name of TELEGRAM_THREAD_NAME_PALETTE[paletteSlot] ?? []) {
            if (!occupied.has(getTelegramTopicIdentityName(name)))
                return name;
        }
    }
    return undefined;
}
export function getTelegramThreadNameLeadingSlot(threadName) {
    if (!threadName)
        return undefined;
    const first = getTelegramTopicIdentityName(threadName)[0];
    return first && /^[A-Z]$/.test(first) ? first : undefined;
}
function getTelegramThreadNameEntropyIndex(entropy, length) {
    if (length <= 1)
        return 0;
    if (typeof entropy === "number" && entropy < 1_000_000_000_000)
        return 0;
    const value = entropy === undefined ? "0" : String(entropy);
    let hash = 2166136261;
    for (const char of value) {
        hash ^= char.codePointAt(0) ?? 0;
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash % length;
}
export function getTelegramTopicThreadNameValidationError(threadName, _slot) {
    const identity = getTelegramTopicIdentityName(threadName);
    const reasons = [];
    if (!identity)
        reasons.push("it is empty after trimming");
    if (/\s/.test(identity))
        reasons.push("it contains spaces");
    if (/[^A-Za-z]/.test(identity)) {
        reasons.push("it contains characters outside Latin A-Z letters");
    }
    if (!/^[A-Z]/.test(identity)) {
        reasons.push("it does not start with an uppercase Latin letter");
    }
    const genericLabels = new Set(["telegram", "leader", "follower"]);
    if (genericLabels.has(identity.toLowerCase())) {
        reasons.push("it is a generic role label");
    }
    if (/^[A-Z]$/.test(identity))
        reasons.push("it is only a bare slot letter");
    if (reasons.length === 0)
        return undefined;
    return `Invalid Telegram instance name: ${reasons.join("; ")}. Use exactly one capitalized Latin word with no spaces, punctuation, emoji, non-Latin letters, or digits; it must not be a generic role label or only a bare slot letter.`;
}
export function getTelegramManualThreadDisplayNameValidationError(threadName) {
    const trimmed = threadName.trim();
    const normalized = trimmed.replace(/\s+/g, " ");
    const reasons = [];
    if (!trimmed)
        reasons.push("it is empty after trimming");
    if (trimmed && /[^\x20-\x7E]/.test(trimmed)) {
        reasons.push("it contains characters outside printable ASCII");
    }
    if (normalized.length > 96)
        reasons.push("it is longer than 96 characters");
    if (/^[A-Z]$/.test(normalized)) {
        reasons.push("a bare slot letter is reserved for reset to automatic");
    }
    if (reasons.length === 0)
        return undefined;
    return `Invalid Telegram Thread display name: ${reasons.join("; ")}. Use 1–96 printable ASCII characters.`;
}
export function isTelegramTopicThreadNameValidForSlot(threadName, slot) {
    return !getTelegramTopicThreadNameValidationError(threadName, slot);
}
function applyTopicNameTemplate(template, request, slot) {
    const threadName = request.threadName?.replace(/\s+/g, " ").trim() || request.profileKey;
    let result = template
        .replaceAll("{threadName}", threadName)
        .replaceAll("{profileKey}", request.profileKey)
        .replaceAll("{instanceId}", request.instanceId);
    if (slot)
        result = result.replaceAll("{slot}", getTelegramWorkspaceSlotDisplayLabel(slot));
    return result;
}
export function getTelegramTopicName(request, template = "{slot}", slot) {
    const name = applyTopicNameTemplate(template, request, slot)
        .replace(/\s+/g, " ")
        .trim();
    return (name || (slot ? getTelegramWorkspaceSlotDisplayLabel(slot) : undefined) || "Pi").slice(0, 128);
}
export function getTelegramTopicTitleForThreadName(threadName, slot, template = "{threadName}") {
    return getTelegramTopicName({
        instanceId: "",
        profileKey: normalizeTelegramTopicTargetThreadName(threadName) || "Pi",
        threadName,
    }, template, slot);
}
