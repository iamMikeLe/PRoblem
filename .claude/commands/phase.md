---
description: Start or continue a roadmap phase using the ship-feature workflow
argument-hint: <phase number, e.g. 1>
---

Work on **Phase $ARGUMENTS** of `docs/ROADMAP.md`.

1. Read the phase in `docs/ROADMAP.md` and list its open items (`- [ ]`).
2. If the phase has no open items, say so and suggest the next phase.
3. Take the open items in order and run each through the `ship-feature` skill. Group items that
   only make sense together (e.g. a schema and the endpoint using it).
4. Before the first item, show the architect's plan for the whole phase and wait for my approval.
5. After each item, tick it in the roadmap and give a two-line status.
