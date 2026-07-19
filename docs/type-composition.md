# Types are composed, not declared

*How priors avoids defining types upfront — and why the type you haven't
imagined yet already works. Companion to [PRIORS.md](../PRIORS.md) §2–3;
every example marked ● below is a real record from a live ledger.*

## The trap this design avoids

The obvious way to build a memory system is to enumerate what it remembers:
`type: finding | decision | lesson`. That enum is born obsolete. The first
real week of use produces things that fit none of the boxes — a team's
style preference, a firm's negotiation playbook, a rule about *how to
measure* — and then every new use case means new keeper code, a spec
revision, and a migration. The type list becomes the bottleneck through
which all future use cases must beg passage.

So priors doesn't define types upfront. **It defines five properties, and
types are formed by recombining them.**

## The CSS analogy

CSS doesn't hard-code "button" or "card." It implements a small set of
properties — color, border, padding, display — and a *button* is just a
named bundle of property values someone found useful. You still design in
buttons and cards (nobody thinks in raw properties day-to-day), but when
tomorrow's component arrives — a chip, a toast, a skeleton loader — the
browser engine doesn't change. New vocabulary, same grammar.

priors is built the same way. The keeper (the enforcement engine) never
contains `if type == "conclusion"`. It implements exactly five properties;
a type is a stylesheet class: a named, reusable answer-set.

## The five properties

Every prior answers five questions. The answers are the closed set — the
grammar the keeper enforces:

| Property | The question it answers | Allowed answers |
|---|---|---|
| `scope` | what part of the world does this depend on? | a content hash · a tool version · an environment fingerprint · the whole repo |
| `activation` | when does it enter a run? | at the start (as instructions) · at the verify step (as an obligation) · at the propose gate (as a veto) |
| `obligation` | what must the run do with it? | disposition it · obey it as instruction · use it only to refuse proposals |
| `authority` | who can change it? | advisory (agent may challenge) · binding (human only) |
| `lifecycle` | how does it expire? | when its scope's hash moves · when it fails in practice · only by explicit supersession |

Coherence rules keep nonsense combinations out (an instruction that
activates *after* the work is done, a repo-wide scope that claims to go
stale on a hash change) — the keeper validates the bundle, not the name.

## Watch types form, use case by use case

### Code review

Three different kinds of memory emerge — nobody declared them; the work
shaped them:

```json
{"type":"conclusion",  "scope":"content-hash","activation":"verify-phase","obligation":"disposition-required","authority":"advisory","lifecycle":"stale-on-scope-change"}
```
*"S3 client constructed per request in `upload.ts#handleUpload` — pool it."*
Depends on that exact code (content hash); must be re-checked each run
(verify + disposition); the agent may later argue it's obsolete
(advisory); dies when the code changes (stale-on-scope-change).

```json
{"type":"coverage", "scope":"content-hash","activation":"propose-gate","obligation":"veto-only","authority":"advisory","lifecycle":"stale-on-scope-change"}
```
*"Reviewed `src/api` at depth major, run-003."* Never shown to the user,
never dispositioned — it exists only to refuse below-floor dredging on
unchanged code. Same grammar, opposite temperament: a prior that is pure
veto.

```json
{"type":"calibration","scope":"repo-wide","activation":"run-start","obligation":"inject-as-instruction","authority":"binding*","lifecycle":"only-by-supersession"}
```
*"`unwrap()` in test files is accepted style here — don't flag it."*
Depends on nothing hashable (repo-wide); rides into every run as if
written in the skill itself; only a human ever retires it.

### Landing-page review — ratified decisions (● live ledger, play.modiqo.ai)

The clarity-journey ledger contains both ends of the spectrum, formed from
the same five properties:

● **P-0001** (`conclusion`): *"the 'join the list' buttons record no one —
label promises membership, click delivers reassurance."* Pinned to the
pricing page's copy hash. When the buttons became Stripe checkout doors,
the hash moved, the run re-checked it, and the ledger said `✓ 1 fixed` —
exactly the lifecycle the bundle declares.

● **P-0008** (`calibration`): *"when hashing the hero, strip the live
animation's text first — it varies per frame."* A lesson about *how to
measure*, discovered mid-run. No enum anticipated "measurement rule";
the bundle `{repo-wide · run-start · inject}` expressed it without anyone
touching the keeper.

● **P-0009** (`calibration`, ratified → binding): *"no commitment
discounts at launch; annual invoicing at the posted rate; multi-year is
enterprise-only."* This is a **ratification**: it entered advisory (the
agent proposed the record), and the human's `decide accepted` flipped one
property — authority — from advisory to binding. Ratifying a review
decision isn't a special feature; it is a single property transition the
grammar already had. Any future proposal for an annual toggle now dies at
the propose gate with P-0009 cited.

### Design work — a type nobody planned: `preference`

*"Client rejected rounded corners twice — sharp geometry, always."*
Neither a finding about a file nor a tool lesson. Minted in one registry
line: `{repo-wide · run-start · inject · binding-after-decide ·
only-by-supersession}` — behaviorally a calibration, named differently
because designers think in preferences, not calibrations. Vocabulary is
free; grammar is fixed.

### Legal review — another: `playbook`

*"Our fallback: liability cap = 12 months' fees; venue: Delaware."* A
firm's negotiation positions as a subscribable bundle — org-wide scope,
injected into every contract review, binding. The "playbook" concept —
which sounds like it would need a feature — is five property values.

### Tool use — `behavioral`

*"Vendor Y's PDFs are encrypted — `qpdf --decrypt` before parsing."*
Scope = the tool/vendor fingerprint (not a content hash!); injected at
run start; expires by *failing in practice* (`challenged-on-failure`) —
a lifecycle no target-content type uses, sitting in the same grammar.

## Minting a type: the whole procedure

1. Answer the five questions for the new kind of memory.
2. Give the bundle a name people will actually say.
3. Add it to the preset registry — five lines of data, zero code.

The keeper validates coherence and enforces behavior from the properties;
the ledger stores records *expanded* (properties inline), so even a reader
who has never seen your type name knows exactly how the record behaves.

## The one property that refuses composition

`authority: binding` cannot be self-assigned in any bundle — records are
born advisory, and only a human `decide` promotes them. A type is free to
choose how it activates, what it obliges, and how it dies; it is never
free to declare itself law. That single exception is what keeps an open
type system from becoming an open door.

---

**The claim, compactly:** define the grammar, not the vocabulary. Five
enforced properties; types as named bundles; new use cases mint new names
without touching the engine — and the live ledger above shows it working:
a finding, a measurement rule, and a ratified pricing doctrine, all
different "types," all the same five questions answered differently.
