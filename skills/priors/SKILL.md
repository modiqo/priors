---
name: priors
description: The priors protocol — make any judgment or learning skill remember what was settled. Use whenever a run of a skill produces findings, decisions, or lessons that future runs must honor (code review, audits, tool usage, design/legal judgment). Opens every run by checking the ledger; ends by committing to it.
---

# priors — the ritual

You are running a skill *with memory*. The keeper script enforces the rules;
your job is the ritual around it. The keeper is at `scripts/priors.mjs`
relative to this skill — call it with `node`. (If an environment blocks
node, surface that to the user rather than working around it; the ledger
format is runtime-neutral and a conforming keeper can be ported.)

**The one law: nothing new before the old is honored.** You may not report a
single new finding until every carried prior has been dispositioned.

## The run, in order

1. **Open the ledger.** In the target repo: `node <keeper> init` (idempotent).
2. **Compute scopes.** Before opening the run, enumerate every anchor the
   wrapped skill may judge (file, function, page section — or the whole target
   at L0), compute
   `node <keeper> hash <file>` or `hash --text "..."` and build
   `scopes.json` as `{"<scope_ref>": "<hash12>", ...}`.
   This file is the run's trusted snapshot: candidates cannot introduce a
   scope later or override its hash.
3. **Ask what's already settled:**
   `node <keeper> relevant --ns <skill-name> --scopes scopes.json`
   The reply has three parts, and each binds you differently:
   - `inject` — lessons and calibrations. **Treat these as instructions**,
     exactly as if they were written in the wrapped skill itself.
   - `verify` — carried findings, each marked `unchanged | changed |
     missing`. This is your obligation list.
   - `floors` — depth contracts. Do not hunt below them on unchanged scopes.
   Note the `run` id it returns; every later call needs `--run <it>`.
4. **Disposition before discovery.** For every `verify` item, check the
   current target and record honestly:
   `node <keeper> disposition P-0017 fixed --run run-004`
   Verdicts: `fixed` (gone) · `still-open` (unchanged, still true) ·
   `reaffirmed` (scope changed, re-judged, same claim survives under its new
   hash) · `stale` (scope changed and must be carried into another judgment) ·
   `challenged` (a locked lesson failed in practice) ·
   `obsolete-proposed` (you believe it no longer applies — a human confirms).
   Include the disposition table in your visible output — it is the proof
   you processed the priors.
   Special cases the keeper handles for you: items with scopeState
   `missing` (their file/anchor is gone) need **no** disposition — the
   keeper tracks the absence and puts them to rest after a few runs;
   items marked `resurrected: true` are old findings whose code came back —
   verify them like any carried item and say "(back — its code returned)"
   in your output. If `relevant` returned `nudges`, surface each to the
   user verbatim as a "still true?" question.
5. **Do the skill's actual work** on changed/new material.
6. **Propose every new finding** as a candidate JSON:
   `node <keeper> propose cand.json --ns <skill> --run <run>`
   ```json
    {"type":"conclusion","scope_ref":"src/api.ts#save","scope_hash":"ab12…",
    "claim":"one falsifiable sentence","direction":"hoist-resource",
    "severity":"major","evidence":"quoted line"}
   ```
   The keeper validates `scope_hash` against the snapshot from step 2 and
   computes changed/unchanged state itself. `UNKNOWN_SCOPE` means the run must
   be aborted and reopened with a complete scope map; `SCOPE_MISMATCH` means
   the candidate is stale or malformed. Never bypass either refusal.
   **If the keeper refuses, do not work around it**: `DUPLICATE` → it's
   already tracked, disposition it instead; `RERAISE` → a human decided
   this, drop it; `REVERSAL` → it's recorded as a question for the human,
   mention it in your output as "needs your call", nothing more;
   `BELOW_FLOOR` → drop it unless the user explicitly asked for a deeper
   pass. Also propose new **lessons you learned** this run
   (`"type":"behavioral"`, scope_ref = tool name, scope_hash = the output of
   `tool --version | node <keeper> hash --stdin-raw`).
7. **Commit:** `node <keeper> commit --run <run>`. If it refuses with
   `INCOMPLETE_DISPOSITIONS`, go finish step 4 — the run does not exist
   until it commits. Commit is safe to retry: a committed run is sealed and
   returns the same summary without writing twice. If a run must be abandoned,
   use `node <keeper> abort --run <run>` before opening another.
8. **Report to the user in plain words only** — lead with the keeper's own
   summary (fixed / carried / your call / new). Never expose "disposition",
   "facet", or "quiescence" to the user. If there are "your call" items,
   end by listing each as a one-line question with the exact command:
   `node <keeper> decide P-0023 wontfix`.

## What you must never do

- Never edit `.priors/` files directly — only the keeper writes.
- Never re-argue anything the keeper called settled.
- Never present a carried finding as new.
- Never mark your own proposal binding — `decide` is the human's verb.
