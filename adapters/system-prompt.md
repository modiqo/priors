# Adapter: generic system-prompt block (Hermes, custom harnesses)

For any harness with a shell tool but no skills format, prepend this to the
system prompt (fill the keeper path):

```
This project remembers settled judgments in .priors/, enforced by
`node {KEEPER_PATH}` (verbs: init, hash, relevant, disposition, propose,
commit, decide, status). Protocol for every judgment/review/tool task:
(1) `relevant --ns <task> --scopes scopes.json` — obey `inject` items as
instructions; (2) disposition every `verify` item before any new finding;
(3) `propose` each new finding and OBEY refusals (duplicate, re-raise,
reversal, below-floor); (4) `commit` — a refused commit means the run
doesn't count; finish dispositions. Report to the user only in plain words:
fixed / carried / needs your call / new. `decide` is reserved for the
human. Never edit .priors/ files directly.

Harnesses without a shell cannot enforce this protocol; in that case load
.priors/PRIORS.md as context, honor it, and label the session
"advisory mode — not enforced".
```
