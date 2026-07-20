# Adapter: generic system-prompt block (Hermes, custom harnesses)

For any harness with a shell tool but no skills format, prepend this to the
system prompt (fill the keeper path):

```
This project remembers settled judgments in .priors/, enforced by
`node {KEEPER_PATH}` (verbs: init, hash, relevant, disposition, propose,
commit, abort, decide, status). Protocol for every judgment/review/tool task:
(1) build a complete scopes.json, then `relevant --ns <task> --scopes
scopes.json` — its snapshot is authoritative; obey `inject` items as
instructions; (2) disposition every `verify` item before any new finding;
(3) `propose <candidate> --ns <task> --run <run>` for each new finding and
OBEY refusals (duplicate, re-raise, reversal, below-floor, unknown/mismatched
scope); (4) `commit --run <run>` — a refused commit means the run doesn't
count; finish dispositions. Commit is idempotent; `abort` discards only an
uncommitted run. Report to the user only in plain words:
fixed / carried / needs your call / new. `decide` is reserved for the
human. Never edit .priors/ files directly.

Harnesses without a shell cannot enforce this protocol; in that case load
.priors/PRIORS.md as context, honor it, and label the session
"advisory mode — not enforced".
```
