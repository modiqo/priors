# Adapter: Codex (paste into AGENTS.md)

```markdown
## Priors protocol (memory for judgment tasks)

When reviewing, auditing, or using tools in this repo, this project keeps a
ledger of settled findings/decisions/lessons in `.priors/` enforced by
`node <path-to>/priors.mjs`. Before reporting anything:

1. `node priors.mjs relevant --ns <task> --scopes scopes.json` — treat the
   `inject` list as instructions; the `verify` list is your obligation.
2. Disposition every verify item (`fixed | still-open | stale | challenged |
   obsolete-proposed`) via `priors.mjs disposition <id> <verdict> --run <run>`.
3. Propose new findings via `priors.mjs propose cand.json`; if it refuses
   (DUPLICATE/RERAISE/REVERSAL/BELOW_FLOOR), obey the refusal — do not
   work around it.
4. `priors.mjs commit --run <run>` — if refused, finish dispositions first.
5. Report in plain words: fixed / carried / needs your call / new. Never
   re-argue settled items; never present carried items as new.
```
