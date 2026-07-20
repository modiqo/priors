# priors

**Agent memory that closes the loop.**

Most memory systems help an agent *find* something it saw before. Priors goes
one step further: it records what was learned or decided, determines whether it
still applies to the current world, and makes the next run account for it
before new advice can be accepted.

The data stays as plain text in the target repository. The agent proposes;
a small deterministic keeper validates, records, and—when necessary—refuses.

> **The one law:** nothing new before the old is honored.

## Why this exists

Repeated agent work often gets worse in a very specific way:

- a code review reports the same issue under new wording;
- a dismissed suggestion returns because the model sampled a different opinion;
- a design or pricing decision is treated as fresh territory next week;
- a tool lesson is rediscovered—and paid for—every session;
- a rerun cannot say what was fixed, what still holds, and what is genuinely new.

Priors turns those loose memories into a ledger of settled state. On a later
run, the useful output becomes:

```text
Checked against 35 priors:
  ✓ 22 fixed — nice work
  → 9 carried — same issues, same code
  ? 4 need your call
New this run: 3
```

Once everything converges, the agent can finally say:

```text
Everything settled still holds. Nothing new.
```

## The 60-second mental model

Think of `.priors/ledger.jsonl` as an append-only case file:

```text
run-1 | agent found     | pricing button records no email
run-2 | agent observed  | the button is unchanged; issue still open
run-2 | human decided   | leave it as-is for launch
run-3 | keeper refused  | same suggestion on the same page state
run-5 | page changed    | previous judgment must be checked again
```

Old lines are not rewritten. Later events answer earlier records, so the
current state can always be reconstructed without erasing how it got there.

Before a run, the keeper selects every applicable prior. During the run, old
findings must be checked. At proposal time, settled decisions and review-depth
contracts can veto candidates. At the end, the keeper refuses to seal a run
that left required work unresolved.

That is the difference between remembering text and remembering consequences.

## What makes Priors different

| Ordinary agent memory | Priors |
|---|---|
| Retrieves context that looks relevant | Deterministically selects applicable records from a trusted scope snapshot |
| The model may ignore retrieved text | Applicable findings create a required disposition list |
| A timestamp approximates staleness | Content, tool, and environment fingerprints show when the world changed |
| A decision is another prompt fragment | A human decision can mechanically block the same proposal on unchanged state |
| Records are updated or deleted in place | Events are appended; prior history remains reconstructable |
| “Remembered” means retrieval succeeded | A run does not count unless the keeper can commit it |

Priors is not trying to be a universal personal-memory database. It is for
judgment and learning that should change what a future run is allowed or
required to do.

## Where it composes

The keeper does not hard-code every domain noun. It implements a small
behavioral grammar, and domain types are names for useful bundles of that
behavior:

| Domain name | What it can mean in Priors |
|---|---|
| `finding`, `audit-gap`, `clause`, `research-conclusion` | Re-check this claim against the exact target state |
| `coverage`, `baseline`, `depth-contract` | Refuse lower-value rediscovery on an unchanged scope |
| `preference`, `doctrine`, `playbook`, `policy` | Inject a durable rule at the start of future runs |
| `lesson`, `tool-recipe`, `environment-quirk` | Reuse a learned procedure until it fails in practice |

These names can differ while their runtime behavior is composed from the same
five facets:

| Facet | Question |
|---|---|
| `scope` | What world-state does this depend on? |
| `activation` | At what phase should it enter the run? |
| `obligation` | What must the run do with it? |
| `authority` | Is it still challengeable, or has a human made it binding? |
| `lifecycle` | What event makes it eligible for re-judgment or retirement? |

See [Types are composed, not declared](docs/type-composition.md) for the
complete model, grounded examples, coherence rules, and a larger use-case
catalog.

## Example use cases

### Code and security review

A finding is pinned to a function or file hash. Unchanged findings are carried
under the same identity; changed code forces re-judgment. A human `wontfix`
decision blocks the same issue from being re-raised on the same code state.

### Product and design decisions

“Keep the headline terse” or “sharp corners are intentional” can begin as an
agent-proposed preference. If a human accepts it, future runs receive it as a
durable instruction. Reversing it becomes an explicit trade-off question, not
fresh unsolicited advice.

### Legal and operational playbooks

Negotiation fallbacks, review policies, or escalation rules can be injected at
run start. They remain visible and auditable, and the agent cannot promote its
own suggestion into binding policy.

### Tool and environment learning

“Use `--json` with this CLI,” “decrypt Vendor Y PDFs first,” or “run these
tests in memory” can be scoped to a tool version or environment fingerprint.
If the procedure fails, the agent challenges it once and sends it back for a
human keep-or-retire decision.

### Repeated external audits

You do not need to own the target. Keep one directory per site, contract set,
or client. Priors records *your* observations and compares them with the next
captured state: fixed, carried, touched by changes, or new.

### Critical workflows

The same grammar is useful in high-assurance work, provided the boundary is
clear: Priors can deterministically surface prior observations and policies,
require dispositions, and refuse an incomplete run. It is not the system that
proves, authorizes, or executes the critical action.

| Workflow | Useful composition | What remains outside Priors |
|---|---|---|
| **Hardware verification** | RTL findings that require re-checking, sign-off review baselines, injected verification policy, and EDA-tool recipes | Simulation, formal proof, coverage closure, equivalence checking, and release sign-off |
| **Robotic process automation (RPA)** | Workflow defects, automation review coverage, operating rules, and browser/API environment lessons | Credentials, idempotency, transaction limits, runtime interlocks, and human approval |
| **Finance** | Reconciliation exceptions, model-risk findings, close-review baselines, accounting policy, and data-provider procedures | The books and records, segregation of duties, transaction authorization, limits, and regulatory sign-off |
| **Other safety-critical domains** | Scoped findings, depth floors, human-accepted doctrine, and tool-specific procedures | The domain's certified evidence, accountable decision maker, and operational control plane |

For example, a prior can require an agent to re-check a counterexample after
RTL changes. It cannot establish that the design is correct. A prior can inject
“never submit a payment after validation fails” into an RPA run. It cannot
replace a pre-submit approval gate. A prior can carry a reconciliation
exception into the next close. It cannot authorize a journal entry or trade.

The detailed composition guide walks through these boundaries and shows when a
new domain name is enough versus when a new trusted engine behavior is needed.

## Install

Requires Node.js 18 or newer.

### Claude Code

```bash
claude plugin marketplace add conikeec/priors
claude plugin install priors@priors-marketplace
```

The same commands work inside Claude Code when entered as slash commands.

### Other agent harnesses

```bash
git clone https://github.com/conikeec/priors
cd priors
./install.sh
```

| Harness | Integration |
|---|---|
| **Claude Code** | Native plugin, or the generic installer |
| **OpenClaw** | Agent Skill installed by `install.sh` |
| **Kimi CLI** and Agent-Skills harnesses | Use `skills/priors/` |
| **Codex** | Add `adapters/AGENTS-snippet.md` to the target `AGENTS.md` |
| **Hermes / shell-capable agents** | Add `adapters/system-prompt.md` to the system prompt |

The ledger format is the same across harnesses. If `.priors/` is committed,
agents using different tools converge on the same history. If it is kept out
of version control, it remains local; sharing follows the repository policy
you choose.

## Use it with an existing skill

Priors wraps work you already perform; the wrapped skill does not need to be
rewritten.

```text
/with-priors code-review src/
/with-priors clarity-fold https://example.com
```

The first run behaves like a normal run and quietly starts the ledger. The
second run is where memory becomes visible.

## What happens during a conforming run

1. **Snapshot the world.** The harness enumerates every scope the run may
   judge and hashes it before proposals begin.
2. **Load applicable priors.** The keeper partitions them into instructions,
   verification obligations, and proposal-time vetoes.
3. **Honor old work first.** Every applicable finding is recorded as fixed,
   carried, reaffirmed on changed state, challenged, or proposed obsolete.
4. **Validate new proposals.** Unknown scopes, spoofed hashes, duplicates,
   settled re-raises, reversals, and below-floor findings are refused.
5. **Commit atomically.** The run is sealed only when all obligations are
   complete. Retrying a committed run returns the original result rather than
   writing twice.

The complete protocol and conformance requirements are in
[PRIORS.md](PRIORS.md).

## What is enforced—and what is not

The keeper mechanically enforces:

- deterministic exposure from the ledger and the recorded scope map;
- no new proposals while prior obligations remain open;
- candidate hashes derived from the run snapshot, not trusted from the model;
- duplicate, re-raise, reversal, and coverage-floor checks;
- append-only event history, single active run, locking, and atomic commit;
- no binding authority through the candidate or agent-disposition paths.

The keeper cannot prove that a stochastic model paid attention internally.
It instead requires observable work products and refuses non-compliant state
transitions. A local process also cannot cryptographically prove that the
caller of `decide` is human, so conforming harnesses expose that verb only in
response to an explicit human instruction.

This boundary is intentional: **Priors guarantees observable compliance, not
model cognition.**

## Three terms worth knowing

- **Prior:** a recorded unit of judgment or learning.
- **Carried:** still applies under its current identity; it is not new.
- **Your call:** the agent may propose, but only the human decision path can
  make a judgment stick or reopen one.

Prefer pictures? Follow the [six-part visual tutorial](docs/tutorial/).

## Repository map

| Path | Purpose |
|---|---|
| `skills/priors/SKILL.md` | The harness-independent run ritual |
| `skills/priors/scripts/priors.mjs` | Dependency-free reference keeper |
| `PRIORS.md` | Technical standard and conformance contract |
| `docs/type-composition.md` | Why types are behavioral bundles rather than a closed enum |
| `tests/invariants.test.mjs` | End-to-end and adversarial invariant tests |
| `adapters/` | Codex and generic system-prompt integrations |

## Status

Version 0.3: hardened reference keeper, standard, wrapper, adapters, invariant
tests, and visual tutorial. Reference adopters include code review and
[clarity-journey](https://github.com/modiqo/clarity-journey) for repeated site
audits.

The project is intentionally small: the standard is the product, the keeper
is the executable reference, and the ledger remains readable without a
service.

[MIT](LICENSE)
