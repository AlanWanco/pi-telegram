/**
 * Telegram downgrade safety checker regressions
 * Zones: release operations, durable journal authority
 */

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import test from "node:test";

import { createTelegramUpdateJournalStore } from "../lib/journal.ts";
import { resolveTelegramSessionJournalPath } from "../lib/paths.ts";

const execFileAsync = promisify(execFile);
const scriptUrl = new URL("../scripts/check-downgrade.mjs", import.meta.url);
const scriptPath = fileURLToPath(scriptUrl);
const identity = { tokenSha256: "a".repeat(64) };

function entry(updateId: number) {
  return {
    updateId,
    update: { update_id: updateId },
    admittedAtMs: 1,
    state: "pending",
  };
}

function snapshot(entries: unknown[], options: Record<string, unknown> = {}) {
  return {
    version: 1,
    profile: "default",
    botIdentity: identity,
    entries,
    ...options,
  };
}

function segment(
  revision: number,
  previousRevision: number,
  options: Record<string, unknown> = {},
) {
  return {
    version: 1,
    revision,
    previousRevision,
    profile: "default",
    botIdentity: identity,
    upsertedEntries: [],
    removedUpdateIds: [],
    ...options,
  };
}

async function runCheck(
  agentDir: string,
  options: { useArgument?: boolean; env?: NodeJS.ProcessEnv } = {},
) {
  return execFileAsync(
    process.execPath,
    [scriptPath, ...(options.useArgument === false ? [] : [agentDir])],
    {
      env:
        options.env ??
        (options.useArgument === false
          ? { ...process.env, PI_CODING_AGENT_DIR: agentDir }
          : process.env),
    },
  );
}

async function withAgentDir(
  run: (input: { agentDir: string; runtimeDir: string }) => Promise<void>,
) {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-telegram-downgrade-"));
  const runtimeDir = join(agentDir, "tmp", "pi-telegram");
  await mkdir(runtimeDir, { recursive: true });
  try {
    await run({ agentDir, runtimeDir });
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
}

async function expectBlocked(
  operation: () => Promise<unknown>,
  pattern: RegExp,
) {
  await assert.rejects(
    operation,
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      pattern.test(String((error as { stderr?: unknown }).stderr)),
  );
}

test("Downgrade check blocks unresolved leader and follower authority", async () => {
  await withAgentDir(async ({ agentDir, runtimeDir }) => {
    await writeFile(
      join(runtimeDir, "inbox.json"),
      JSON.stringify(snapshot([entry(1)])),
    );
    await writeFile(
      join(runtimeDir, "follower-inbox-0123456789abcdef.work.json"),
      JSON.stringify(snapshot([entry(2)], { profile: "work" })),
    );
    await expectBlocked(
      () => runCheck(agentDir),
      /follower-inbox-0123456789abcdef\.work\.json retains 1 unresolved[\s\S]*inbox\.json retains 1 unresolved/u,
    );
  });
});

test("Downgrade check sees each session journal and its unapplied segment authority", async () => {
  await withAgentDir(async ({ agentDir, runtimeDir }) => {
    const oldPath = resolveTelegramSessionJournalPath("session-old", "manual:same-recipient", agentDir);
    const newPath = resolveTelegramSessionJournalPath("session-new", "manual:same-recipient", agentDir, "work");
    await mkdir(join(runtimeDir, "sessions", "session-old"), { recursive: true });
    await mkdir(join(runtimeDir, "sessions", "session-new"));
    await writeFile(join(runtimeDir, "inbox.json"), JSON.stringify(snapshot([])));
    await writeFile(oldPath, JSON.stringify(snapshot([entry(1)])));
    await writeFile(newPath, JSON.stringify(snapshot([], { profile: "work" })));
    await mkdir(`${newPath}.segments`);
    await writeFile(join(`${newPath}.segments`, "0000000000000001.json"), JSON.stringify(segment(1, 0, {
      profile: "work", upsertedEntries: [entry(2)],
    })));
    await expectBlocked(() => runCheck(agentDir), /sessions[\s\S]*retains 1 unresolved/u);
    assert.deepEqual(JSON.parse(await readFile(oldPath, "utf8")).entries, [entry(1)]);
    await mkdir(`${oldPath}.segments`);
    await writeFile(join(`${oldPath}.segments`, "0000000000000001.json"), JSON.stringify(segment(1, 0, { removedUpdateIds: [1] })));
    await expectBlocked(() => runCheck(agentDir), /session-new[\s\S]*retains 1 unresolved/u);
    await writeFile(join(`${newPath}.segments`, "0000000000000002.json"), JSON.stringify(segment(2, 1, {
      profile: "work", removedUpdateIds: [2],
    })));
    const drained = await runCheck(agentDir);
    assert.match(drained.stdout, /SAFE: 3 Telegram journal/u);
    assert.deepEqual(JSON.parse(await readFile(oldPath, "utf8")).entries, [entry(1)], "Inspection never compacts the source");
  });
});

for (const artifact of ["alias", "unknown", "orphan-segments", "retained", "snapshot-directory", "root-alias"] as const) {
  test(`Downgrade check refuses unclassified session storage (${artifact})`, async () => {
    await withAgentDir(async ({ agentDir, runtimeDir }) => {
      const root = join(runtimeDir, artifact === "root-alias" ? "Sessions" : "sessions");
      const directory = join(root, artifact === "alias" ? "%61" : "session");
      await mkdir(directory, { recursive: true });
      if (artifact === "unknown") await writeFile(join(directory, "journal.bad.json"), "unchanged");
      if (artifact === "orphan-segments") await mkdir(join(directory, "journal.0123456789abcdef.json.segments"));
      if (artifact === "retained") await mkdir(join(directory, "journal.0123456789abcdef.json.retained"));
      if (artifact === "snapshot-directory") await mkdir(join(directory, "journal.0123456789abcdef.json"));
      await expectBlocked(() => runCheck(agentDir), /BLOCKED: cannot verify/u);
    });
  });
}

test("Downgrade check ignores legacy recovery folders", async () => {
  await withAgentDir(async ({ agentDir, runtimeDir }) => {
    await mkdir(join(runtimeDir, "recovery", "old"), { recursive: true });
    await writeFile(join(runtimeDir, "recovery", "old", "inbox.json"), "{damaged");
    await mkdir(join(runtimeDir, "sessions", "session", "recovery"), { recursive: true });
    const result = await runCheck(agentDir);
    assert.match(result.stdout, /SAFE/u);
  });
});

for (const artifact of ["runtime", "session-root", "session-folder", "snapshot", "segments"] as const) {
  test(`Downgrade check refuses linked session storage (${artifact})`, { skip: process.platform === "win32" }, async () => {
    await withAgentDir(async ({ agentDir, runtimeDir }) => {
      const outside = join(agentDir, "outside");
      await mkdir(outside);
      await writeFile(join(outside, "source.json"), JSON.stringify(snapshot([entry(1)])));
      if (artifact === "runtime") {
        await rm(runtimeDir, { recursive: true });
        await symlink(outside, runtimeDir);
      } else if (artifact === "session-root") await symlink(outside, join(runtimeDir, "sessions"));
      else {
        await mkdir(join(runtimeDir, "sessions"));
        const directory = join(runtimeDir, "sessions", "session");
        if (artifact === "session-folder") await symlink(outside, directory);
        else {
          await mkdir(directory);
          const path = join(directory, "journal.0123456789abcdef.json");
          if (artifact === "snapshot") await symlink(join(outside, "source.json"), path);
          else {
            await writeFile(path, JSON.stringify(snapshot([])));
            await symlink(join(outside, "missing"), `${path}.segments`);
          }
        }
      }
      await expectBlocked(() => runCheck(agentDir), /BLOCKED: cannot verify/u);
      assert.deepEqual(JSON.parse(await readFile(join(outside, "source.json"), "utf8")).entries, [entry(1)]);
    });
  });
}

test("Downgrade check shares directory and file-byte budgets across inspection", async () => {
  await withAgentDir(async ({ agentDir, runtimeDir }) => {
    const path = join(runtimeDir, "inbox.json");
    await writeFile(path, "{}");
    await truncate(path, 64 * 1024 * 1024 + 1);
    await expectBlocked(() => runCheck(agentDir), /file\/byte inspection limit exhausted/u);
    await rm(path);
    for (let index = 0; index < 10_001; index += 100) {
      await Promise.all(Array.from({ length: Math.min(100, 10_001 - index) }, (_, offset) =>
        mkdir(join(runtimeDir, `unrelated-${index + offset}`))));
    }
    await expectBlocked(() => runCheck(agentDir), /directory listing limit exhausted/u);
  });
});

test("Downgrade check fails closed on malformed, unknown, and orphan authority", async () => {
  await withAgentDir(async ({ agentDir, runtimeDir }) => {
    await writeFile(join(runtimeDir, "inbox.json"), "{broken");
    await expectBlocked(() => runCheck(agentDir), /cannot verify/u);
    await rm(join(runtimeDir, "inbox.json"));
    await mkdir(join(runtimeDir, "follower-inbox-0123456789abcdef.json.segments"));
    await expectBlocked(() => runCheck(agentDir), /orphan journal segments/u);
    await rm(join(runtimeDir, "follower-inbox-0123456789abcdef.json.segments"), {
      recursive: true,
    });
    await writeFile(join(runtimeDir, "inbox.unknown"), "{}");
    await expectBlocked(() => runCheck(agentDir), /unrecognized journal-like/u);
  });
});

test("Downgrade check permits fully drained leader and follower journals", async () => {
  await withAgentDir(async ({ agentDir, runtimeDir }) => {
    for (const name of ["inbox.json", "follower-inbox-0123456789abcdef.work.json"]) {
      const path = join(runtimeDir, name);
      await writeFile(
        path,
        JSON.stringify(snapshot([entry(1)], name.includes(".work.") ? { profile: "work" } : {})),
      );
      await mkdir(`${path}.segments`);
      await writeFile(
        join(`${path}.segments`, "0000000000000001.json"),
        JSON.stringify(
          segment(1, 0, {
            profile: name.includes(".work.") ? "work" : "default",
            removedUpdateIds: [1],
          }),
        ),
      );
    }
    const result = await runCheck(agentDir);
    assert.match(result.stdout, /SAFE: 2 Telegram journal/u);
  });
});

test("Downgrade check blocks drained journals with journal-owned cursor authority", async () => {
  await withAgentDir(async ({ agentDir, runtimeDir }) => {
    await writeFile(
      join(runtimeDir, "inbox.json"),
      JSON.stringify({ ...snapshot([]), acceptedThroughUpdateId: 9 }),
    );
    await expectBlocked(
      () => runCheck(agentDir),
      /cannot verify|malformed|unsupported/u,
    );
  });
});

test("Downgrade check uses PI_CODING_AGENT_DIR when no argument is provided", async () => {
  await withAgentDir(async ({ agentDir, runtimeDir }) => {
    await writeFile(
      join(runtimeDir, "inbox.json"),
      JSON.stringify(snapshot([entry(1)])),
    );
    await expectBlocked(
      () => runCheck(agentDir, { useArgument: false }),
      /retains 1 unresolved/u,
    );
  });
});

test("Downgrade check auto-detects an OMP invocation", async () => {
  const home = await mkdtemp(join(tmpdir(), "pi-telegram-downgrade-home-"));
  const runtimeDir = join(home, ".omp", "agent", "tmp", "pi-telegram");
  const ompScriptPath = join(home, "omp");
  await mkdir(runtimeDir, { recursive: true });
  await writeFile(
    join(runtimeDir, "inbox.json"),
    JSON.stringify(snapshot([entry(1)])),
  );
  await writeFile(
    ompScriptPath,
    `import ${JSON.stringify(scriptUrl.href)};\n`,
  );
  try {
    await expectBlocked(
      () =>
        execFileAsync(process.execPath, [ompScriptPath], {
          env: {
            ...process.env,
            HOME: home,
            USERPROFILE: home,
            PI_CODING_AGENT_DIR: "",
          },
        }),
      /\.omp[\\/]agent[\\/]tmp[\\/]pi-telegram[\\/]inbox\.json retains 1 unresolved/u,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("Downgrade check accepts same-bot token rotation and redundant revisions", async () => {
  await withAgentDir(async ({ agentDir, runtimeDir }) => {
    const path = join(runtimeDir, "inbox.json");
    await writeFile(
      path,
      JSON.stringify(
        snapshot([], {
          revision: 1,
          botIdentity: { botId: 7, tokenSha256: "a".repeat(64) },
          operatorDispositions: [
            {
              failureId: "failure-1",
              updateId: 1,
              action: "discard",
              committedAtMs: 3,
              attemptCount: 1,
              failureClass: "Error",
              terminalAtMs: 2,
              terminalReason: "operator discard",
            },
          ],
        }),
      ),
    );
    await mkdir(`${path}.segments`);
    await writeFile(
      join(`${path}.segments`, "0000000000000001.json"),
      JSON.stringify(
        segment(1, 0, {
          botIdentity: { botId: 7, tokenSha256: "a".repeat(64) },
        }),
      ),
    );
    await writeFile(
      join(`${path}.segments`, "0000000000000002.json"),
      JSON.stringify(
        segment(2, 1, {
          botIdentity: { botId: 7, tokenSha256: "b".repeat(64) },
        }),
      ),
    );
    const result = await runCheck(agentDir);
    assert.match(result.stdout, /SAFE: 1 Telegram journal/u);
  });
});

test("Downgrade check rejects profile, identity, revision, and schema conflicts", async () => {
  const cases: Array<{
    name: string;
    segmentValue?: unknown;
    segmentName?: string;
    expected: RegExp;
  }> = [
    {
      name: "profile",
      segmentValue: segment(1, 0, { profile: "work" }),
      expected: /foreign journal segment identity/u,
    },
    {
      name: "identity",
      segmentValue: segment(1, 0, {
        botIdentity: { tokenSha256: "b".repeat(64) },
      }),
      expected: /foreign journal segment identity/u,
    },
    {
      name: "revision gap",
      segmentValue: segment(2, 0),
      segmentName: "0000000000000002.json",
      expected: /malformed or gapped/u,
    },
    {
      name: "unknown segment",
      segmentValue: {},
      segmentName: "notes.txt",
      expected: /unrecognized journal segment/u,
    },
    {
      name: "malformed segment entry",
      segmentValue: segment(1, 0, {
        upsertedEntries: [{ ...entry(1), extra: true }],
      }),
      expected: /malformed or gapped/u,
    },
  ];
  for (const fixture of cases) {
    await withAgentDir(async ({ agentDir, runtimeDir }) => {
      const path = join(runtimeDir, "inbox.json");
      await writeFile(path, JSON.stringify(snapshot([])));
      await mkdir(`${path}.segments`);
      await writeFile(
        join(`${path}.segments`, fixture.segmentName ?? "0000000000000001.json"),
        JSON.stringify(fixture.segmentValue),
      );
      await expectBlocked(() => runCheck(agentDir), fixture.expected);
    });
  }
});

test("Downgrade checker and runtime journal agree on shared entry schema", async () => {
  const queueOwner = {
    instanceId: "inst-1",
    processId: 1234,
    processBirthId: "1234:start:1",
    sessionGeneration: 1,
    acquisitionId: "acq-1",
    acquiredAtMs: 2,
  };
  const queued = {
    updateId: 1,
    update: { update_id: 1 },
    admittedAtMs: 1,
    state: "queued",
    queueKind: "prompt",
    queueReceiptId: "receipt-1",
    queueOwner,
  };
  const validCases: Array<{ name: string; entry: unknown }> = [
    { name: "pending", entry: entry(1) },
    { name: "queued with owner", entry: queued },
  ];
  const invalidCases: Array<{ name: string; entry: unknown }> = [
    {
      name: "owner-less queued",
      entry: {
        updateId: 1,
        update: { update_id: 1 },
        admittedAtMs: 1,
        state: "queued",
        queueKind: "prompt",
        queueReceiptId: "receipt-1",
      },
    },
    { name: "queued without kind", entry: { ...queued, queueKind: undefined } },
    {
      name: "queued without receipt",
      entry: { ...queued, queueReceiptId: undefined },
    },
    { name: "pending with queue metadata", entry: { ...entry(1), queueKind: "prompt" } },
    {
      name: "retry-wait without failure",
      entry: {
        updateId: 1,
        update: { update_id: 1 },
        admittedAtMs: 1,
        state: "retry-wait",
        nextRetryAtMs: 5,
      },
    },
    { name: "unknown state", entry: { ...entry(1), state: "bogus" } },
    {
      name: "update id mismatch",
      entry: { updateId: 2, update: { update_id: 1 }, admittedAtMs: 1, state: "pending" },
    },
  ];

  for (const { name, entry: fixture } of validCases) {
    const journalDir = await mkdtemp(join(tmpdir(), "pi-telegram-recon-journal-"));
    try {
      const path = join(journalDir, "inbox.json");
      await writeFile(path, JSON.stringify(snapshot([fixture])));
      const store = createTelegramUpdateJournalStore({
        path,
        botIdentity: identity,
      });
      assert.doesNotThrow(
        () => store.read(),
        `journal.ts rejects valid: ${name}`,
      );
    } finally {
      await rm(journalDir, { recursive: true, force: true });
    }
    await withAgentDir(async ({ agentDir, runtimeDir }) => {
      await writeFile(
        join(runtimeDir, "inbox.json"),
        JSON.stringify(snapshot([fixture])),
      );
      await assert.rejects(
        () => runCheck(agentDir),
        (error: unknown) => {
          const stderr = String((error as { stderr?: unknown }).stderr);
          return /retains 1 unresolved/u.test(stderr) && !/cannot verify|malformed/u.test(stderr);
        },
        `downgrade checker misclassifies valid: ${name}`,
      );
    });
  }

  for (const { name, entry: fixture } of invalidCases) {
    const journalDir = await mkdtemp(join(tmpdir(), "pi-telegram-recon-journal-"));
    try {
      const path = join(journalDir, "inbox.json");
      await writeFile(path, JSON.stringify(snapshot([fixture])));
      const store = createTelegramUpdateJournalStore({
        path,
        botIdentity: identity,
      });
      assert.throws(
        () => store.read(),
        (error: unknown) => (error as { code?: unknown }).code === "invalid",
        `journal.ts accepts invalid: ${name}`,
      );
    } finally {
      await rm(journalDir, { recursive: true, force: true });
    }
    await withAgentDir(async ({ agentDir, runtimeDir }) => {
      await writeFile(
        join(runtimeDir, "inbox.json"),
        JSON.stringify(snapshot([fixture])),
      );
      await expectBlocked(() => runCheck(agentDir), /cannot verify/u);
    });
  }
});

test("downgrade check leaves the inert agent-owned channel post journal untouched", async () => {
  await withAgentDir(async ({ agentDir, runtimeDir }) => {
    const path = join(runtimeDir, "channel-posts.json");
    const content = `${JSON.stringify({ version: 1, profile: "default",
      tokenSha256: "a".repeat(64), records: [{ state: "outcome-unknown" }] })}\n`;
    await writeFile(path, content, { mode: 0o600 });
    const result = await runCheck(agentDir);
    assert.match(result.stdout, /SAFE:/u);
    assert.equal(await readFile(path, "utf8"), content);
  });
});
