---
description: Prepare talking points and a demo script from the project's real history
---

Prepare me to present PRoblem in a technical walkthrough. Use only facts from this repository:
`README.md`, `docs/ARCHITECTURE.md`, `docs/adr/`, `docs/ROADMAP.md`, `.claude/`, and `git log`.

Write `docs/DEMO.md` with:

1. **Pitch** (30 seconds): the problem, who it is for, what it does.
2. **Demo script** (5 minutes): numbered steps through the running app, what to click and what to
   say at each step. Only features that are actually done according to the roadmap.
3. **Architecture walkthrough**: the diagram from `docs/ARCHITECTURE.md` and three things worth
   pointing at in the code, with `path:line`.
4. **Decisions I can defend**: one line per ADR with the trade-off.
5. **How I work with Claude Code**: the `.claude/` setup (agents, skills, commands, hooks) and why
   each piece exists.
6. **Likely questions** with short, honest answers, including "what would you do next?" and
   "what was hard?".

Do not invent features, numbers or history.
