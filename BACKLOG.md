# Project Backlog

_This file owns unresolved project work only. Completed behavior belongs in `CHANGELOG.md`; durable contracts belong in `AGENTS.md` and `/docs`._

## Routing Lifetime External Report

- [ ] Report the patch's precise shipped routing-lifetime scope externally only after separate authorization and verified release evidence. Do not claim a universal TTL or cleanup of historical originals lacking saved chooser clocks; native Windows destructive cleanup remains gated on strict evidence.
- Evidence boundary: The operator reports passing TTL live acceptance. New continuation-reaction and callback-copy behavior has native regression evidence, not a separate live-client claim. Neither establishes native Windows Restore/destructive-cleanup support. Completed implementation is recorded in `CHANGELOG.md`; durable contracts remain in `/docs`.

## Windows Reliability

- [ ] Strengthen native Windows reliability beyond the 0.52.0 ordinary-queue fix. Audit filesystem paths, named pipes, locking, owner fencing, heartbeat and atomic publication; cover interrupted writes, damaged state, ownership changes and lost-ACK retries with focused regressions.
- [ ] Investigate Windows-compatible strict journal evidence for Restore and cleanup without weakening source identity, scoped ACK or fail-closed protections. Inventory witnesses currently skipped on Windows and enable them only when equivalent native evidence exists.
- Acceptance: Local synthetic tests distinguish ordinary delivery from strict proofs; native Windows CI exercises supported paths and refusal boundaries. Linux emulation or a green matrix with skipped Restore witnesses does not establish Windows Restore acceptance.

## Consistent Callback Notification Copy Across Other Extensions

- [ ] Inventory Telegram button callback acknowledgements across all local extensions, including companion callbacks. Standardize the transient non-interactive notification bubbles (callback answers/toasts) to concise, consistent text with no trailing period.
- [ ] Distinguish transient callback bubbles from in-chat notices, chooser headings and blocking alerts; reconcile the owning UI-copy contracts before implementation rather than stripping punctuation from every message.
- Acceptance: All participating extensions follow the same callback-notification format, with focused copy checks for success, no-op and rejection outcomes; in-chat notice formatting and callback behavior remain unchanged.
