# Cap & Gown Meal Attendance System

**Start with `docs/HANDOFF.md`.** It is the orientation document for anyone —
person or agent — picking this project up: current state, how the person you
are working with works, the traps that have already cost time here, and the
things that look wrong but are deliberate.

Then `docs/specs/2026-08-16-meal-attendance-system-design.md` for the design
and the reasoning behind it, and `README.md` for how to run it.

**Go-live is 2026-09-02.** This system serves meals to ~200 students daily and
holds their names, photographs, and attendance records. Two habits matter more
than anything else here:

- **Never commit a roster or a photograph.** `*.csv` is gitignored for that
  reason; git history is permanent.
- **Verify by measuring, not by assuming.** Every serious bug in this project
  has been silent — a job that reported success while doing nothing, a
  threshold that would have ignored every swipe. Unit tests did not catch any
  of them.

---

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
