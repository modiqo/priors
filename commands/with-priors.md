---
description: Run any skill with memory — it honors what previous runs settled before saying anything new
argument-hint: "<skill-name> <target>"
---

# /with-priors — zero-edit memory for any skill

Arguments: `$ARGUMENTS` — first token is the skill to wrap, the rest is its
target.

1. Invoke the `priors` skill and follow its ritual exactly, with
   `--ns <wrapped-skill-name>`.
2. At L0 (the wrapped skill knows nothing about priors), use the coarsest
   scope: one `scope_ref` = the target itself, hash = the whole target's
   normalized content. If the wrapped skill emits its own anchors (files,
   sections), prefer those — finer scopes converge faster.
3. Run the wrapped skill normally between the disposition step and the
   propose step. Convert each of its findings/conclusions/lessons into
   candidate JSON for `propose`.
4. Report with the keeper's plain-language summary first (fixed / carried /
   your call / new), then the wrapped skill's own output for the new items
   only. Carried items get one line each, marked "(carried — same as last
   run)".
5. If this is the first run (empty ledger), say so in one line: "First run —
   from now on, this is remembered."
