# PRIORS — a standard for skills that remember what was settled

*Version 0.3 · status: draft · this document is the standard; the bundled
keeper (`skills/priors/scripts/priors.mjs`) is its reference implementation.
Conforming implementations may be written in any language and must pass the
conformance fixtures in `tests/`.*

## 0 · Principle: the ratchet

**Learning locks; it never silently unlocks.** A prior loses force through
exactly two doors: the world it describes changes (its scope hash moves), or
a human decides (an explicit disposition). Everything in this spec exists to
enforce that ratchet against a stochastic process that would otherwise
re-sample its opinions on every run.

A corollary defines done-ness: a run is **quiescent** when it dispositions
every applicable prior and proposes nothing new. Quiescence is the
convergence state a stateless agent cannot express.

## 1 · What a prior is

A prior is a settled unit of judgment or learning, recorded as one JSON
object in an append-only ledger (`.priors/ledger.jsonl` in the target repo).

```json
{"t":"prior","id":"P-0017","ns":"code-review","type":"conclusion",
 "facets":{"scope":"content-hash","activation":"verify-phase",
           "obligation":"disposition-required","authority":"advisory",
           "lifecycle":"stale-on-scope-change"},
 "scope_ref":"src/api/upload.ts#handleUpload","scope_hash":"9c41ee2a07b1",
 "claim":"S3 client constructed per request; pool it at module scope",
 "direction":"hoist-resource","severity":"major","born":"run-003"}
```

Status is not stored on the record; it is **folded** from subsequent event
records (`{"t":"event","id":"P-0017","action":"disposition","to":"fixed",
"run":"run-004","by":"agent"}`). The ledger is append-only; nothing is ever
edited in place. `PRIORS.md` (rendered) is a projection for humans; the
JSONL is the truth.

## 2 · The five facets (the grammar)

Types are **not** primitive. The keeper implements exactly five facets;
every type is a named bundle of them. This is what lets unforeseen use
cases mint new types without changing any implementation.

| Facet | Question | Values |
|---|---|---|
| `scope` | what world-state does it depend on? | `content-hash` · `tool-version` · `env-fingerprint` · `repo-wide` |
| `activation` | when does it enter a run? | `run-start` · `verify-phase` · `propose-gate` |
| `obligation` | what must the run do with it? | `disposition-required` · `inject-as-instruction` · `veto-only` |
| `authority` | who may change it? | `advisory` · `binding` |
| `lifecycle` | how does it expire? | `stale-on-scope-change` · `challenged-on-failure` · `only-by-supersession` |

Coherence rules (enforced): `inject-as-instruction` requires activation
`run-start`; `disposition-required` requires `verify-phase`;
`veto-only` requires `propose-gate`; a `repo-wide` scope cannot use
`stale-on-scope-change`.

**Authority is never self-assigned.** A prior may choose how it activates,
never how much it binds: records are born `advisory`; only a human `decide`
event promotes to `binding`. (Poisoning defense: a hallucinated run can
propose, never legislate.)

The local CLI cannot authenticate process identity: a harness could call a
human verb dishonestly. Conformance therefore requires `decide` to be exposed
only after an explicit human instruction; the reference keeper additionally
allows decisions only between runs. What it enforces mechanically is that no
candidate or agent disposition can assign binding authority.

## 3 · Standard types (the vocabulary)

Shipped presets — stored *expanded* in the ledger so the JSONL is
self-describing without this table:

| Type | Bundle | Typical use |
|---|---|---|
| `conclusion` | content-hash · verify-phase · disposition-required · advisory · stale-on-scope-change | findings about a target (review findings, audit findings, clause flags, learned field-maps) |
| `behavioral` | tool-version *or* env-fingerprint · run-start · inject-as-instruction · advisory · challenged-on-failure | learned procedure ("use `--json`", "decrypt vendor-Y PDFs first") |
| `coverage` | content-hash(set) · propose-gate · veto-only · advisory · stale-on-scope-change | "scope S reviewed at depth D" — blocks below-floor dredging on unchanged scopes |
| `calibration` | repo-wide · run-start · inject-as-instruction · binding* · only-by-supersession | judgment tuning ("test-file `unwrap()` is accepted style"), doctrine, preferences, playbooks |

\* calibration records still *arrive* advisory and are promoted by `decide`.
New types (e.g. `preference`, `playbook`) are minted by naming a bundle —
five lines of registry, zero code. The full argument for
composition-over-declaration, with worked use cases (code review,
ratified landing-page decisions from a live ledger, design preferences,
legal playbooks, tool lessons): [docs/type-composition.md](docs/type-composition.md).

## 4 · Lifecycle

```
            propose(agent)                    decide(human)
candidate ────────────────▶ open ──┬───────▶ accepted | wontfix   (binding set)
                                   │ disposition(agent)
                                   ├─▶ fixed        (scope shows the issue gone)
                                   ├─▶ still-open   (unchanged; carried, same id)
                                   ├─▶ stale        (scope hash moved → re-judge, id preserved)
                                   ├─▶ reaffirmed   (same claim, new trusted hash, id preserved)
                                   ├─▶ challenged   (behavioral prior failed in the field)
                                   └─▶ obsolete-proposed → obsolete (human confirms)
reopen(human, with reason) reverses any terminal state — the only unlock.
```

Stale is **carry-forward, not amnesia**: the re-judgment either records a
`reaffirmed` event under the keeper's current trusted hash (same id, history
intact), marks the issue fixed, or proposes retirement with a reason. Hash
change never silently deletes and the model never supplies the replacement
hash independently of the run snapshot.

## 5 · The protocol (what a conforming run does)

1. **`relevant`** — the keeper (not the model) selects applicable priors
   from the complete scope map and records that map as the run's trusted
   snapshot. Deterministic exposure: the model never gets to "not find" a
   prior. Output partitions by activation: `inject` items are prepended to
   the working context; `verify` items become the obligation list; the
   selection and scope hashes are recorded for steps 3–4.
2. **disposition** — before proposing anything new, the run dispositions
   every `verify` item. The output must contain the table; you cannot
   disposition what you did not process — the table is the proof of
   reading.
3. **`propose`** — new candidates are submitted per finding only after all
   applicable verify items have been handled. The keeper derives the
   candidate's scope hash and changed/unchanged state from the recorded run
   snapshot; unknown scopes and mismatched candidate hashes are refused. It
   then rejects, with the conflicting prior cited: **duplicates** (same
   ns+scope+direction/claim in *any* status — dedup against the seen-set,
   not the accepted-set), **re-raises** (binding prior, unchanged hash),
   **reversals** (direction opposes an applied/accepted prior on an
   unchanged hash → returned as a *tradeoff escalation* for the human,
   never silently emitted), and **below-floor** findings (severity under a
   coverage prior's depth on unchanged scope; deeper requires an explicit
   new contract).
4. **`commit`** — refused unless every `verify` item was handled. A commit is
   an atomic, one-shot transaction recorded by a run event; retries return
   the original summary byte-for-byte and cannot append the run twice.
   Committed staging material is removed. A non-compliant run simply does not
   ledger: **fail-closed**. Only one uncommitted run may exist; `abort` is the
   explicit recovery door for abandoned staging.

### The influence guarantee, stated honestly

Attention inside a model cannot be forced. What this standard guarantees is
**observable compliance**: deterministic exposure (1), obligatory
disposition as work-product (2), mechanical veto (3), and fail-closed
recording (4). The model proposes; the ledger disposes.

## 6 · Determinism requirements

Canonical JSON (sorted keys, LF, no floats where integers serve);
sequential ids per ledger (`P-%04d`); scope hashes = first 12 hex of
SHA-256 over *normalized* content (whitespace-collapsed for text; raw
stdout for tool versions); all timestamps/ids stamped by the keeper, never
by the model; append-only JSONL; a keeper lock and single active run; atomic
ledger replacement at commit; staging under `.priors/runs/<run>/` removed
after the run is sealed; git is the durable transaction log. Same inputs ⇒
byte-identical ledger.

## 7 · Adoption levels (backporting)

- **L0 — wrapped, zero edits**: `/with-priors <skill> <target>`. Scope
  defaults to the whole target (one hash). The oscillation guarantee
  already holds.
- **L1 — one line**: the skill's frontmatter declares `priors: <ns>` and
  its body says "follow the priors protocol". Self-declared, orchestrator
  independent.
- **L2 — native**: the skill supplies its own scope extractor (per-section
  / per-hunk anchors), direction vocabulary, and severities.
  clarity-journey is the reference L2 adopter.

## 8 · Harness portability

The enforcement core needs only a shell and `node`. The ritual travels as:
SKILL.md (Claude Code, OpenClaw, Kimi and other Agent-Skills-compatible
harnesses), `adapters/AGENTS-snippet.md` (Codex), `adapters/
system-prompt.md` (anything else). A shell-less harness degrades to
advisory mode and is **non-conforming** — priors as pasted context, no
veto, and must be labeled as such.

## 9 · Forgetting — always a status, never an absence

Forgetting is three different operations; conflating them is how memory
systems rot. (Grounding: Anderson & Schooler 1991 — memory availability
rationally tracks *probability of need*; forgetting is an attention policy,
not data loss.)

1. **Semantic** — "no longer holds": `fixed`, `obsolete`, supersession.
   Covered by the lifecycle; history always retained.
2. **Attention** — "stop showing me this": an advisory `verify-phase` prior
   whose scope has been missing for **K = 5 consecutive runs** is
   **archived** — excluded from exposure, fully retained, and
   **auto-resurrected with its history** the moment its scope_ref reappears
   (a file restored from an old branch gets its findings back, not a fresh
   review). Deterministic, keeper-computed from `scope-missing` events,
   and loud (the commit summary reports resting priors). Binding priors
   never auto-archive — decisions don't expire from neglect. Repo-wide
   binding priors (calibrations, playbooks) have no hash tripwire, so they
   may carry `review_every: N`: after N runs without a human touch, the
   keeper surfaces a nudge ("still true? `decide <id> keep` — or retire").
   A nudge, never an auto-forget.
3. **Record** — true deletion: refused, except for content that should
   never have been recorded (secrets, PII). The human-only `redact` verb
   performs the **one sanctioned in-place rewrite**: the record's content
   is replaced by a tombstone (id, content hash, born-run), current run
   materializations containing that id are scrubbed, and a redact event is
   appended. Committed staging is already removed. The removal is itself
   remembered, and id sequence stays intact. Caveat stated honestly: the
   ledger lives in git; `redact` cleans current `.priors` data, and scrubbing
   git history is a documented separate step.

The unifying rule, sibling to the ratchet: a prior may stop *acting*, stop
*appearing*, or have its content *removed* — but the record that it existed,
and why it changed, survives in every case. Silent disappearance is the one
forbidden operation.

## 10 · Presentation rule

Implementations MUST keep the user-facing surface in plain language. The
terms of art in this spec (disposition, facets, quiescence) are for
authors and implementers; user output speaks in **fixed / carried / your
call / new**, and the first-run experience must require zero reading. A
correct implementation that confuses its user is non-conforming by intent.
