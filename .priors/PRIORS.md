# Priors — what is already settled here

*Rendered by the keeper; do not edit — the truth is `ledger.jsonl`.*

| id | area | type | status | where | what |
|---|---|---|---|---|---|
| P-0001 | project-hardening | conclusion | fixed | skills/priors/scripts/priors.mjs#proposal-trust | Proposals trust agent-supplied scope hashes and change flags, allowing s |
| P-0002 | project-hardening | conclusion | fixed | skills/priors/scripts/priors.mjs#stale-reanchor | A stale disposition cannot record the new scope hash, so a reaffirmed pr |
| P-0003 | project-hardening | conclusion | fixed | skills/priors/scripts/priors.mjs#redaction | Redaction removes content from the ledger but leaves the sensitive claim |
| P-0004 | project-hardening | conclusion | fixed | skills/priors/scripts/priors.mjs#transactions | Commit is repeatable and non-atomic, so retries or concurrent writers ca |
| P-0005 | project-hardening | conclusion | fixed | skills/priors/scripts/priors.mjs#run-protocol | The keeper does not validate run identifiers, disposition membership, or |
| P-0006 | project-hardening | conclusion | fixed | skills/priors/scripts/priors.mjs#calls-status | Reversal escalations and review nudges counted by commit are not availab |
| P-0007 | project-hardening | conclusion | fixed | skills/priors/scripts/priors.mjs#hashing | The tool-version hash path normalizes text even though the standard requ |
| P-0008 | project-hardening | conclusion | fixed | adapters/AGENTS-snippet.md#propose-command | The Codex adapter omits required namespace and run arguments from the pr |
| P-0009 | project-hardening | conclusion | fixed | LICENSE | The repository declares MIT licensing but does not include the license t |
| P-0010 | project-hardening | conclusion | fixed | tests/invariants.test.mjs#adversarial-coverage | The suite lacks regression coverage for malformed scope data, retries, s |
