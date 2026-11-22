---
name: write-adr
description: Write an Architecture Decision Record for PRoblem in docs/adr/. Use when a change chooses between real alternatives (library, storage, protocol, security model), when the user asks why something was built a certain way, or when the architect agent flags a decision.
---

# Write an ADR

ADRs explain *why*, so the decision can be defended later.

1. Find the next number: `ls docs/adr`. Files are `NNNN-kebab-title.md`.
2. Use this template, at most one page:

```md
# NNNN. <Decision as a short statement>

- Status: accepted | proposed | superseded by NNNN
- Date: YYYY-MM-DD

## Context
The problem and the forces at play (constraints, requirements, what hurts today).

## Options
1. **<Option>**: pros / cons, one or two lines each.
2. ...

## Decision
What we chose and the main reason.

## Consequences
What gets easier, what gets harder, what we must now watch out for.
```

3. Link it from `docs/ARCHITECTURE.md` (Decisions section) and, if it supersedes an ADR, update
   that ADR's status.
4. Be honest about the downsides. An ADR with no cons is not credible.
