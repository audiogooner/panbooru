# Stage 5 release review

Recorded 7 November 2026 on this development host (Darwin). The automated rows are the fixture run below. Numeric service objectives are blank because this run did not measure them.

## Fixture run

| Check | Result |
|---|---|
| Unit suite | `npm run test:unit -- --run` from `panbooru/`: 29 files, 119 tests passed (Vitest 4.1.12). Includes the live Gelbooru transport spec. |
| Backup and restore | `src/lib/server/library/backup.spec.ts`: 6 tests passed. Snapshot, incomplete copy, owner route, restore of favorites, album, and originals, a missing original, and a missing or wrong key. |
| Archive import resume | `src/lib/server/library/import.spec.ts`: 2 tests passed. Dry run and traversal rejection, then a resumed upload in a new process that does not duplicate the library or change the source directory. |
| Chromium browser | `npx playwright test src/routes/foundation.e2e.ts src/routes/library.e2e.ts src/routes/viewer.e2e.ts src/routes/a11y.e2e.ts`: 10 Chromium tests passed (foundation, library, viewer) and the keyboard journey passed on the Chromium keyboard project. |
| Firefox keyboard | The same command: the keyboard journey passed on Firefox. 12 Playwright tests passed in total. |

The Playwright command used one worker and the project’s preview server. It did not record search latency, scroll, decode counts, navigation delay, memory, or queue throughput.

## Service objectives

| Objective | Measured |
|---|---|
| Search latency, excluding upstream | |
| Search latency, including upstream | |
| Gallery scroll responsiveness | |
| Mounted and decode counts | |
| Viewer cached navigation delay | |
| Memory with fifty contexts | |
| Queue throughput | |
| Slow-connection behavior | |

The 5–50 GB library size discussed for deployment is a planning range, not a result from this run.

## Acceptance covered by the fixture run

| ID | Evidence in this run |
|---|---|
| A19 | Boundary spec passed: foreign-origin media and library writes are rejected, and secrets stay out of settings, the session, rendered pages, and credential logs. |
| A20 | Backup spec passed: a verified restore recreates favorites, album membership, and ready originals. A missing or wrong key keeps the library and reports the key unavailable. |
| A21 | Import spec passed: an interrupted upload resumes in a new process without a second favorite, album, or original, and the source directory hash is unchanged. |
| A22 | Keyboard journey passed in Chromium and Firefox for login, search, opening the viewer, favorite, tag replace, Shift-append, Ctrl-branch, and panel resize. |
