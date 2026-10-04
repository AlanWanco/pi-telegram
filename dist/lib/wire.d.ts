/**
 * Non-coercing decoded wire-value inspection
 * Zones: wire fields, record shape, integer bounds
 * Owns shared shallow predicates; excludes schemas, lossless decoding,
 * required fields, normalization, storage and execution authority.
 */
/** Non-array object shape only; not a plain-object or JSON-serializability guarantee. */
export declare function isWireRecord(value: unknown): value is Record<string, unknown>;
/** Checks only own enumerable string keys, not required, inherited or symbol fields. */
export declare function hasOnlyWireKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean;
export declare function isNonEmptyWireString(value: unknown): value is string;
export declare function isNonNegativeWireInteger(value: unknown): value is number;
