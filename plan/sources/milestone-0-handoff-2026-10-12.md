# Controller handoff: Milestone 0 Gelbooru explorer

Date: 2026-10-12 (Europe/Zurich)  
Repository: `/Users/nils/Projects/Private/booru-client`  
Diagnostic origin: `http://localhost:5173`

## Conclusion and controller decision

The diagnostic implementation is runnable, and local storage works in Firefox according to the user's direct verification. The user also reports that all Playwright tests passed in their environment. **The chosen browser-direct Gelbooru API architecture is blocked by a demonstrated authenticated CORS failure.** The required post-search request returned HTTP 200, but the browser refused access because the response lacked `Access-Control-Allow-Origin`.

This is a useful feasibility failure, not completion of all original acceptance criteria. Further deployment verification is **deferred at the user's direction**; existing Node/Docker evidence is retained below. Do not spend further time on deployment testing unless requested.

The controller must decide how to address API access before expanding the explorer. An upstream-supported CORS fix preserves the current boundary. A controlled server API intermediary is another possible direction, but it would receive API credentials and change the fixed privacy/architecture decision. No such proxy has been authorized or implemented. Changing frontend headers, using `no-cors`, or disabling browser security would not establish readable browser-direct responses.

## Implemented deliverables

- Svelte 5 / SvelteKit 3 / TypeScript diagnostic application with custom CSS and separate API, media, storage and navigation sections. Native diagnostic controls were sufficient; no Bits UI component was needed yet.
- Browser-only Gelbooru adapter, normalized post/tag contracts, cancellation/stale-response handling, bounded requests and sanitized errors.
- Integrated restricted media stream endpoint, currently closed to all real upstream hosts pending verified media URLs.
- Versioned Dexie metadata, an asynchronous OPFS MediaStore boundary, verified save states, recovery and synthetic storage probes.
- Fixture navigation harness with approximately 50 lightweight views, one active view rendered, saved-view persistence and browser history integration.
- Pinned runtime/dependencies/lockfile, Node adapter, non-root Dockerfile with health check, credential-free configuration example, setup documentation and separate probe scripts.
- Deterministic unit/controlled integration tests and Firefox/Chromium Playwright projects.

Initial repository was empty on `main`. The coordinator scaffolded and established contracts, then three implementation workers owned API, proxy and storage independently. No credential-receiving API proxy or additional booru adapter was introduced.

Runtime pins: Node 24.21.0, npm 11.19.0. Principal dependencies: Svelte 5.57.2, SvelteKit 3.0.1, adapter-node 6.0.0, Vite 8.3.4 and Dexie 4.4.6. Exact direct dependency versions and transitive resolution are in `package.json` and `package-lock.json`.

## Gate assessment under the latest user direction

| Gate                | Status                                        | Findings                                                                                                                                                                                                                                                                                         |
| ------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0 — foundations     | Pass                                          | Clean lockfile install, typecheck, formatting check, 76 deterministic tests, production build and SSR/hydration succeed.                                                                                                                                                                         |
| 1 — browser API     | Blocked                                       | User-verified authenticated search returns HTTP 200 but lacks the CORS response header. Other authenticated operations and an HTTPS hosted origin remain unverified.                                                                                                                             |
| 2 — media proxy     | Blocked for live media                        | Implementation and 56 controlled security/stream tests pass. No verified API media hosts or live media bytes; production allowlist deliberately empty.                                                                                                                                           |
| 3 — local storage   | Conditional                                   | User confirms storage works in Firefox; Chromium checksum/reload and failure handling are independently verified. Firefox restart retention, persistence permission outcomes and private-mode details were not specified. Basic Firefox storage is no longer an unverified feasibility question. |
| 4 — integrated flow | Blocked                                       | Fixture navigation and synthetic local-storage flows pass. Full live API → media proxy → OPFS flow cannot run through the current API boundary.                                                                                                                                                  |
| 5 — deployment      | Conditional; further testing deferred by user | Node/Docker build/run, container health, Chromium production flows and bytes surviving container restart were already verified. Remaining original deployment acceptance checks are not claimed as passed.                                                                                       |

The original full Firefox restart and live-media acceptance criteria have not been established by the general statement “storage works.” This qualification is a record of evidence, not a request to repeat testing. Deployment checks are deliberately deferred, not failed.

## API observations

The browser adapter supplies bounded post search/pagination, single-post lookup, batched exact tags and pattern tags. It preserves the Gelbooru query expression and source tag categories, validates shapes, handles empty/malformed/HTML responses, uses `credentials: 'omit'`, limits concurrency/retries and avoids indefinite authentication retries. Credentials remain in browser memory; there is no remember-credentials option.

Agent-run anonymous probes in Chromium 156.0.8078.4, on development and built Node at the fixed origin:

| Operation                                   | Result                     |
| ------------------------------------------- | -------------------------- |
| One-post search with a general-rating query | Unreadable Fetch TypeError |
| Single post lookup                          | Unreadable Fetch TypeError |
| Exact tag lookup                            | Unreadable Fetch TypeError |
| Pattern tag lookup                          | Unreadable Fetch TypeError |

Those generic errors alone did not identify their cause. A separate anonymous command-line HEAD returned 401 HTML, without an observed CORS allow-origin header; command-line access does not prove browser CORS.

The subsequent user-run **authenticated** diagnostic search returned HTTP 200 and a specific missing-`Access-Control-Allow-Origin` browser error. This establishes the relevant CORS failure. It does not establish the returned body shape, all authenticated endpoints, or every possible deployment origin. Browser version and exact origin for that user-run observation were not captured. No authenticated request was replayed by the agent.

No HTTPS test origin was supplied. Sanitized anonymous observations are in `docs/live-probes.json`. No authenticated HAR or trace was saved. An API key appeared in a user-pasted console URL; it is deliberately omitted from every repository report. Rotation was advised; rotation status is unknown.

## Media proxy findings

`/api/media` accepts GET/HEAD and one media URL. Required controls implemented and tested:

- HTTPS, exact approved host/path, approved port; reject URL credentials, queries/credential parameters, fragments, malformed encodings and IP literals.
- Reject private, local, link-local and conservatively identified special-purpose DNS addresses. All resolved answers must pass; the TLS request uses a pinned approved address with hostname verification.
- Abort stalled DNS waits and prevent late DNS answers from connecting after cancellation/timeout.
- Reject redirects and active MIME types, including HTML/SVG; only required raster-image and MP4/WebM types are permitted.
- Forward only explicit media Accept and single Range headers. No caller cookies/authorization/referrer are forwarded.
- Stream with byte, concurrency, request and bandwidth limits; cancellation tears down upstream work. Controlled tests cover HEAD, 200/206/416, range validation, declared/chunked oversize and total timeout.
- Same-origin/local-only checks, `nosniff`, no durable upstream media storage and no upstream request logging. Restrictive application CSP and escaped remote text.

Defaults: 32 MiB per response, 3 concurrent requests, 30 requests/minute, 64 MiB/minute; connect 5 seconds, idle 10 seconds, total 30 seconds. Budgets are process-local. They do not establish public hosting readiness or authenticate server callers.

**Verified real media hosts, path shapes, formats, referrer needs and CDN range/video behavior: none.** The empty production allowlist is intentional. Controlled fixture behavior must not be presented as live CDN evidence. Live rendering, proxied saving, seeking and real transport connect/idle behavior remain unverified. Public hosting access controls and trusted reverse-proxy configuration remain outside the demonstrated result.

## Storage findings

User findings: storage works in Firefox; all Playwright tests pass in the user's environment. Detailed browser versions, commands, restart procedure and persistence grants/denials were not supplied.

Independent Chromium evidence: OPFS, secure context and Web Locks available. A 256 KiB deterministic synthetic file closes, reads back, matches SHA-256 and receives a ready Dexie record. The checksum is `31a1f9dea0169551092d05e8bf4a446228c8c3eb4c9b713c66adcb7fd53c89be`. Verified bytes survive reload and a container restart at the same origin. Read remains local with Gelbooru requests blocked. Diagnostic deletion removes bytes and metadata.

One isolated Chromium quota estimate was approximately 10.7 GB, with 73728 bytes of IndexedDB usage before the probe. This is not a capacity guarantee. No large media library, disk-fill test or extrapolation to 50 GB was used. Synthetic files cap at 1 MiB; diagnostic media saves cap at 16 MiB.

Save lifecycle: pending → writing → ready only after close, size and checksum verification; failures retain retryable failed state and independent metadata. Seven controlled storage tests cover failure injection before write, during write, before ready commit, quota failure and reconciliation. Recovery checks ready records, marks interrupted/missing/damaged files failed and removes orphan bytes. Origin-wide Web Locks serialize mutations/recovery; unavailable locking disables writes. Display object URLs are revoked on replacement/unmount.

Real Firefox restart persistence, explicit persistence grant/denial, private browsing and simultaneous two-tab writes remain unspecified/unverified. Small-file storage success does not guarantee durable retention or large-library capacity.

## Navigation and warning fix

The fixture harness supports tag replacement, Shift append, Ctrl/Cmd/middle-click background views, view switching, selection/results state, Back/Forward and session reload. It renders one active view rather than 50 galleries/searches. Explicit saved views persist in Dexie and restore query/results/selection. Active exploration uses tab-local sessionStorage; shared library data uses origin storage. Each page load receives a new runtime session identity, avoiding a shared active-session record for duplicated tabs.

The user observed `push_state_deprecated` while restoring a saved view. All deprecated pushState/replaceState calls were migrated to `goto(..., { state, shallow: true })`, with `replace: true` for initial/scroll snapshots and `reset: false` to retain the harness's restoration behavior. A browser regression assertion verifies history deprecation/conflict warnings are absent. Comprehensive scroll restoration and real duplicated-tab checks remain incomplete.

## Test and deployment evidence

Latest agent-run validation: typecheck, production build and formatting pass; **76 Vitest tests pass** (11 API, 56 server, 7 storage, 2 navigation). Five Chromium browser scenarios pass: history/reload, OPFS read during upstream outage, independent/background views, credential-input isolation and saved-view/selection restoration. The original five browser flows also passed against Node production and the final container before the subsequent shallow-goto migration; the migration was rechecked against the user's running development server and built successfully.

The agent's Playwright Firefox 157.0 installation exits before test execution with “Could not find profile folder,” including attempts using system temporary storage and `/tmp`. This tooling failure does not contradict the user's successful Firefox storage/test results. Agent-run Firefox failures are not application test failures. The user's test suite success is recorded as user evidence rather than attributed to the agent's runner.

A synthetic credential marker is absent from app-origin request URLs/bodies and local/session storage. API fixtures verify credentials stay on Gelbooru requests and cookies are omitted. This is not a complete real-key authenticated-flow audit.

Already completed deployment evidence: Docker engine 29.8.2 builds the pinned image, runs as non-root `node`, reaches healthy status and serves `/health`. Five Chromium flows pass on Node/container. A separate controlled container-restart probe verifies origin-owned bytes remain readable after restart. Disposable verification containers were removed. Further deployment testing is explicitly deferred by the user. No new server was started for this handoff.

## Recommended controller action

1. Treat basic Firefox local storage as feasible based on the user's verification. Retain narrower unknowns without requiring more deployment work.
2. Resolve the browser-direct API CORS decision first. Keep the API adapter, media security boundary, storage layer and deterministic tests as reusable foundations.
3. If an intermediary is approved, explicitly revise the credential/privacy boundary and scope its authentication, logging, caching and outbound allowlist before implementation. Do not silently route API credentials through the existing media endpoint.
4. Obtain verified media URLs under the selected API architecture, then enable only exact proven media hosts/path shapes. Live-media verification follows that dependency.
5. Do not label Milestone 0 fully passed. Carry forward the CORS blocker and remaining live-media/restart evidence gaps; honor the user's deployment-testing deferral.

## Repository references

- `README.md`: setup, local run, tests and manual handoff.
- `docs/feasibility-2026-10-12.md`: detailed dated evidence and follow-ups.
- `docs/live-probes.json`: sanitized anonymous browser observations.
- `docs/decisions.md`: architectural/recovery decisions.
- `src/lib/api.ts`: browser API adapter.
- `src/lib/server/README.md`: restricted media policy and limits.
- `src/lib/storage/README.md`: storage exports and recovery contract.
- `tests/navigation.spec.ts`: browser proof and history-warning regression.

This handoff is prepared for delivery to the controller; it has not been sent to another chat or external recipient.
