/**
 * Test-process preload that selects a short canonical temporary root
 * Zones: tests, filesystem
 * Strict journal reads require canonical anchors, and Unix socket fixtures need short paths. Raw `mkdtemp(tmpdir())`
 * paths fail on hosts whose temp root is a long symlink (macOS `/var/folders/...` → `/private/var/...`), so POSIX test
 * processes use the canonical `/tmp`. Production paths canonicalize the agent directory in `lib/paths.ts`.
 */

import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";

if (process.platform !== "win32") process.env.TMPDIR = realpathSync(existsSync("/tmp") ? "/tmp" : tmpdir());
