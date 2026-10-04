export interface TelegramWorkspaceBindingIdentity {
    cwd: string;
    workspaceKey: string;
    /** Exact durable Pi session identity; absent only on legacy cwd-only bindings. */
    sessionId?: string;
    /** Full SHA-256 index component for session-qualified bindings. */
    sessionKey?: string;
    /** Immutable legacy binding-key component, not the displayed global letter. */
    instanceSlot: string;
    bindingKey: string;
    /** Profile-wide letter reserved by the transient claim. */
    slot?: string;
}
export declare const TELEGRAM_WORKSPACE_KEY_MAX_LENGTH = 180;
export declare function normalizeTelegramSessionId(sessionId: string): string | undefined;
export declare function createTelegramSessionKey(sessionId: string): string | undefined;
export declare function normalizeTelegramWorkspacePath(cwd: string): string | undefined;
export declare function createTelegramWorkspaceDirectoryKey(cwd: string): string | undefined;
export declare function createTelegramWorkspaceBindingIdentityWithKey(cwd: string, workspaceKey: string, ordinal: number, sessionId?: string): TelegramWorkspaceBindingIdentity | undefined;
export declare function createTelegramWorkspaceBindingIdentity(cwd: string, ordinal?: number, sessionId?: string): TelegramWorkspaceBindingIdentity | undefined;
