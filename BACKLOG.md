# Project Backlog

_This file owns unresolved project work only. Completed behavior belongs in `CHANGELOG.md`; durable contracts belong in `AGENTS.md` and `/docs`._

## Post-Release Transport Recovery Acceptance

- Release boundary: The operator authorized the hotfix on native regression and CI evidence; real Telegram smoke/fault acceptance remains open below, not a claimed completed check. Installing/reloading Pi or injecting live faults needs separate authorization.
- CI boundary: Native Linux/macOS/Windows checks exercise capped poll/admission backoff, preserved persistent-conflict stand-down and generation-fenced manual disconnect. Existing skipped strict journal witnesses remain a separate Windows boundary; green CI does not replace operator acceptance.
- [ ] Obtain operator acceptance for ordinary disconnect, unconfirmed-cleanup reporting and outage recovery without manual reconnect on a disposable setup. Local fake-transport/storage regressions do not certify real Telegram or platform fault behavior; installation/reload and live fault injection require separate authorization.
- Acceptance: Captured manual stop never affects a replacement connection or bypasses Thread deletion fences, uncertain stop is not retried, and accepted local work is preserved. Session-restart cleanup remains admission-required.

## Windows Reliability

- [ ] Strengthen native Windows reliability beyond the 0.52.0 ordinary-queue fix. Audit filesystem paths, named pipes, locking, owner fencing, heartbeat and atomic publication; cover interrupted writes, damaged state, ownership changes and lost-ACK retries with focused regressions.
- [ ] Investigate Windows-compatible strict journal evidence for Restore and cleanup without weakening source identity, scoped ACK or fail-closed protections. Inventory witnesses currently skipped on Windows and enable them only when equivalent native evidence exists.
- Acceptance: Local synthetic tests distinguish ordinary delivery from strict proofs; native Windows CI exercises supported paths and refusal boundaries. Linux emulation or a green matrix with skipped Restore witnesses does not establish Windows Restore acceptance.

## Consistent Callback Notification Copy Across Other Extensions

- [ ] Inventory Telegram button callback acknowledgements across all local extensions, including companion callbacks. Standardize the transient non-interactive notification bubbles (callback answers/toasts) to concise, consistent text with no trailing period.
- [ ] Distinguish transient callback bubbles from in-chat notices, chooser headings and blocking alerts; reconcile the owning UI-copy contracts before implementation rather than stripping punctuation from every message.
- Acceptance: All participating extensions follow the same callback-notification format, with focused copy checks for success, no-op and rejection outcomes; in-chat notice formatting and callback behavior remain unchanged.
