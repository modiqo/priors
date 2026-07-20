# Adapter: Codex (paste into AGENTS.md)

```markdown
## Priors protocol (memory for judgment tasks)

When reviewing, auditing, or using tools in this repo, this project keeps a
ledger of settled findings/decisions/lessons in `.priors/` enforced by
`node <path-to>/priors.mjs`. Before reporting anything:

1. Build `scopes.json` with every scope the task may judge, then run
   `node priors.mjs relevant --ns <task> --scopes scopes.json`. Treat the
   `inject` list as instructions; the `verify` list is your obligation. The
   returned scope snapshot is authoritative for this run.
2. Disposition every verify item (`fixed | still-open | reaffirmed | stale |
   challenged | obsolete-proposed`) via
   `node priors.mjs disposition <id> <verdict> --run <run>`.
3. Propose new findings via
   `node priors.mjs propose cand.json --ns <task> --run <run>`; if it refuses
   (DUPLICATE/RERAISE/REVERSAL/BELOW_FLOOR), obey the refusal — do not
   work around it. UNKNOWN_SCOPE/SCOPE_MISMATCH means abort and reopen the run
   with a correct, complete scope map.
4. `node priors.mjs commit --run <run>` — if refused, finish dispositions
   first. Commit is idempotent. Use `abort --run <run>` only to discard an
   uncommitted run.
5. Report in plain words: fixed / carried / needs your call / new. Never
   re-argue settled items; never present carried items as new.
```
