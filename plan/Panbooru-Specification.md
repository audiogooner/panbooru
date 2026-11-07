# Panbooru
## Product, design and technical specification

> **Current authority — updated 18 October 2026:** read this specification together with [Panbooru UI decisions](Panbooru-UI-Decisions.md), which governs detailed UI behavior and later refinements. The sections below have been reconciled with that record. Fixed choices include a logo with artwork undecided, collection-based retention, image-derived viewer background, configurable shortcuts and mandatory user-disableable interface sounds. The local demo is an interaction test, **not a general visual reference or production implementation**.

**Edition:** 1.1 · **Requirements baseline:** 18 October 2026 · **Status:** specification for implementation planning.

> Panbooru is a single-owner, self-hosted web application for exploring Gelbooru, viewing media with minimal friction, and keeping a durable personal library. It combines independent exploration views with a server-owned library that is shared across the owner's devices.

### How to read this specification

- **Fixed (F):** explicitly selected by the user, including the current request. An implementation must preserve this behavior.
- **Recommended (R):** a concrete proposed implementation or UX default. It is actionable but is not represented as a previously finalized choice.
- **Deferred (D):** outside the initial release unless explicitly brought forward.
- **Open (O):** genuinely unresolved product detail or external fact. The relevant section states the consequence and a suggested way forward.
- **Historical (H):** reported evidence from the prototype or previous planning; not a claim about the future application.

Unqualified normative behavior in sections 3–7 describes fixed product requirements. Technical contracts in sections 8–14 are recommended implementation design except where explicitly marked fixed or security requirements. Exact endpoint names, schema names, timing values, dimensions, dependency versions and release labels are proposals.

## Contents

1. [Authority and provenance](#1-authority-and-provenance)
2. [Product scope and decision register](#2-product-scope-and-decision-register)
3. [Primary journeys and information architecture](#3-primary-journeys-and-information-architecture)
4. [Exploration, navigation and history](#4-exploration-navigation-and-history)
5. [Search and tag metadata](#5-search-and-tag-metadata)
6. [Gallery, viewer and visual design](#6-gallery-viewer-and-visual-design)
7. [Library, saving and retention](#7-library-saving-and-retention)
8. [Application architecture](#8-application-architecture)
9. [Data model and consistency](#9-data-model-and-consistency)
10. [Application API contracts](#10-application-api-contracts)
11. [Security and credential lifecycle](#11-security-and-credential-lifecycle)
12. [Media pipeline and background work](#12-media-pipeline-and-background-work)
13. [Failure modes and observability](#13-failure-modes-and-observability)
14. [Deployment, backups and migration](#14-deployment-backups-and-migration)
15. [Validation and acceptance](#15-validation-and-acceptance)
16. [Delivery roadmap and open questions](#16-delivery-roadmap-and-open-questions)
17. [Sources](#17-sources)

## 1. Authority and provenance

### 1.1 Requirements precedence

The current request is the latest authority. The complete available text history of **Bootstrap Booru Feasibility** was read back to its opening Bootstrap question. User decisions outrank assistant suggestions. Later decisions supersede earlier conflicting decisions. Ambient browser-context blocks are not requirements. Earlier rendered concepts and the actual userstyle were not available as inspectable design assets; no dimensions or colors are inferred from them. [C1–C8]

The attached handoff is a factual, dated baseline, not a standing prohibition on the later architecture. A preserved copy accompanies this document at [sources/milestone-0-handoff-2026-10-12.md](sources/milestone-0-handoff-2026-10-12.md). Citations give line ranges in that copy. The source is described in the request as 125 lines; the retrieved file contains 124 numbered lines. Its content is preserved without editorial changes. [H0]

### 1.2 Architectural evolution

| Sequence | Decision or observation | Current treatment |
|---|---|---|
| Initial exploration | Svelte client, custom CSS with own design system, Gelbooru first | Retained |
| Browser-first design | Browser-direct API; Dexie/IndexedDB and OPFS authoritative; integrated media proxy | Superseded storage and API boundary |
| Milestone 0 handoff, 12 October | Authenticated search returned HTTP 200 but browser could not read it because CORS header was absent | Historical blocker established; not a generic assertion that all endpoints fail everywhere |
| Subsequent choice “A” | Restricted server API proxy selected, initially forwarding browser-owned credentials | Establishes API direction; transient credential model later superseded |
| Self-hosting and server storage | Single-owner deployment, central SQLite/filesystem, UI-entered encrypted credentials | Current authoritative architecture |
| Final design choices | Flickr-like justified gallery; viewer replaces gallery; left-edge navigation reveal; right tags panel; image-derived dimmed/blurred viewer background | Current UI requirements (updated 17 October) |
| Final naming instruction | Panbooru | Fixed |

### 1.3 What Milestone 0 actually established

**H:** The handoff reports a runnable Svelte 5/SvelteKit/TypeScript diagnostic, normalized API contracts, restricted media endpoint, versioned Dexie/OPFS storage, a roughly 50-view fixture harness, and Node/Docker packaging. Its exact runtime pins are historical and must not be copied uncritically into a new release. [H0, lines 15–27]

**H:** Foundations passed with 76 deterministic tests. The user reported working Firefox storage and passing Playwright tests. Independent Chromium synthetic-storage and navigation evidence exists. The agent's Firefox runner failed before execution; that is not an application failure. [H0, lines 29–40, 77–103]

**H:** Authenticated browser search demonstrated the missing CORS response header. It did not verify the authenticated response schema, every endpoint, or an HTTPS deployment origin. [H0, lines 42–59]

**H:** The media allowlist intentionally contained no live hosts. Controlled streaming/security tests passed, but real media hosts, referrer requirements, range behavior and live video were unverified. Historical limits such as 32 MiB per response and 30 seconds total are diagnostic defaults, not production video requirements. [H0, lines 61–75]

**H:** The synthetic bytes belonged to browser storage. Surviving a container restart did not prove a server filesystem library. Navigation fixture coverage did not establish comprehensive scroll restoration or duplicated-tab behavior. [H0, lines 81–93]

**Current consequence:** retain reusable contracts and tests, replace browser authority, and verify live API/media access through the new server boundary. No evidence supplied here establishes that the proposed Milestone 0.1 or server-storage migration was implemented. Existing deployment-testing deferral remains historical context; this document runs no deployment tests and claims no new passes. New release gates below are future work. [C4–C6; H0, lines 105–111]

## 2. Product scope and decision register

### 2.1 Vision

Enable a continuous workflow: discover a post, follow an artist or character into another exploration context, navigate between media without full-page reloads, and retain selected originals with useful metadata. Panbooru is a viewer, explorer, downloader and personal manager. It reads from boorus; it does not upload, edit tags, vote, favorite remotely or otherwise write to a source. [C1–C3]

The first user is one owner who manages their own server. Different devices access the same library over HTTPS. Easy distribution remains a product goal; Docker is the initial delivery mechanism, not a promise that every nontechnical user already knows container administration. [C5–C6]

### 2.2 Fixed decisions

| ID | Fixed requirement | Implication |
|---|---|---|
| F01 | Final name Panbooru; logo planned, artwork undecided | Reserve logo placement without inventing artwork |
| F02 | Gelbooru-only MVP | Future adapter seam, no second source in initial implementation |
| F03 | Single-owner self-hosted web app | No registration, tenancy or public shared service |
| F04 | Svelte 5/SvelteKit, Node, Docker | One deployable application with backend |
| F05 | SQLite metadata and filesystem media authoritative on server | Browser eviction cannot destroy saved library |
| F06 | UI-entered API credentials, encrypted at rest with separate secret | Server owns outbound API authentication |
| F07 | Owner authentication and HTTPS | Protect all private API/media/library routes |
| F08 | Strict API and media proxy | Browser makes no direct Gelbooru API/media requests |
| F09 | support for at least 50 independent exploration views | Lightweight contexts, one active gallery/viewer |
| F10 | Exact tag gestures and reversible navigation | See section 4 |
| F11 | Flickr-like justified gallery; persistent left navigation there | Use source aspect ratios; allow slight cropping on full rows, leave last row unfilled |
| F12 | Immersive viewer, dimmed/blurred image-derived background | Left navigation hidden except reveal; optional resizable right metadata |
| F13 | Favorites and albums independent | Membership is many-to-many, no duplicate originals saved to disk   |
| F14 | Save snapshot and queue original retrieval | Background progress, explicit failure state |
| F15 | Saved content survives upstream changes/deletion after successful download while collection-retained | No remote deletion cascade |
| F16 | Shared central library across devices; independent active sessions | Shared data does not imply synchronized cursor/history |
| F17 | Desktop-first, Firefox primary | Mobile polish later; Chromium regression coverage |
| F18 | Highly minimal custom CSS with selective headless primitives | No Tailwind/Bootstrap visual system or gradient-heavy interface |
| F19 | Source-scoped categorized tags, cached and refreshed | Live category changes do not overwrite saved post snapshots |
| F20 | Library-wide exact-metadata-hash and media-content deduplication | Reuse records/objects across every save path, not only albums |
| F21 | Favorites/album membership defines retention; image-removal undo required | Last removal action stays recoverable for 60 seconds; no browsable bin |
| F22 | Interface sounds must be implemented, with user disable control | Independent from player volume; assets/platform/default policy open |

### 2.3 Initial usable release

**R — release boundary:** include secure setup/login, Gelbooru search and autocomplete, categorized tags, justified gallery, core image/video viewer, view navigation, browser history, saved searches, favorites, manual albums with customizable cover fans, collection selection/import tasks, image-removal undo, interface sounds, durable download queue, local library search, backups and migration support. Basic cache management and a derivative pipeline belong in the architecture; advanced optimization can ship after correctness.

**R:** Drizzle, Sharp, Bits UI, Vitest and Playwright are suitable candidates from prior planning. Selectively use them after compatibility review. The requirements do not finalize an ORM, SQLite driver, cryptographic package, justified-layout library or exact package versions. [C6]

## 3. Primary journeys and information architecture

### 3.1 First run and connection

1. Owner starts the persistent Docker service and opens its HTTPS origin.
2. Protected first-run setup establishes the sole owner's password.
3. Settings accepts Gelbooru user ID and API key. Pressing Validate starts validation; only successful validation automatically stores the encrypted replacement. Failure preserves the previous credentials.
4. The application reports configured/validated/error status without returning the stored key.
5. Owner enters tags and begins browsing. Library-only use remains possible when credentials are missing or upstream is unavailable.

**R:** Use a short-lived, locally supplied bootstrap token to prevent a remote visitor claiming an uninitialized instance. API credentials remain UI-entered; this bootstrap token is application setup protection, not Gelbooru configuration. See section 11.

### 3.2 Explore and branch

Search results fill the gallery. Open a post to enter the viewer. Open an artist in a background exploration view while continuing to browse the current result sequence. A sidebar item identifies the new context with a tag-category cue and readable title. Switching views restores each context's query, selected post, result sequence and position. Fifty views must remain practical, not merely technically constructible.

### 3.3 Save and collect

Favorite a post or add it to an album. Metadata is committed and the original download is queued. Items appear when metadata has loaded; original-media readiness does not gate gallery inclusion or import-task completion. Membership and media availability remain separate internal states; do not add a download-state filter or media-download counts to the collection-task UI. Closing the browser does not stop server work. Later, any authenticated device can search and view the same saved library without contacting Gelbooru for ready originals.

### 3.4 Application areas

| Area | Content and behavior |
|---|---|
| Exploration | Independent views, staged search, results and viewer |
| Albums | Grid of albums and their searchable contents; cover fans and pinning |
| Favorites | Searchable favorite subset using the same gallery/viewer |
| Saved searches | Query/filter/sort presets; grid, editable type and cover |
| Settings | Sticky section navigation, connection, preferences and customizable shortcuts |
| Background tasks | Progress at sidebar bottom; details popover, not a separate Downloads destination |

**F sidebar order:** logo/name, New search, exploration views, temporary unpinned albums, pinned albums, Albums, Favorites, Saved searches, Settings, and task progress when active. Do not show an EXPLORATION heading or a visible T hint beside New search. Sidebar width and album-section height are resizable. Ordinary collection destinations do not create exploration-list entries; explicit Shift-click creates separate collection-scoped searches. There is no navigable orphaned All Library destination. See UI sections 7–8 for open/pinned state and exact gestures.

## 4. Exploration, navigation and history

### 4.1 View contract

A view is an application exploration context, not a browser tab. It stores an ID, source, query, filters/order, loaded ordered post IDs, pagination state, selected post, gallery anchor/offset, gallery/viewer mode and customizable identity. Fifty is the expected workflow scale, not a fixed maximum. [C2–C3]

**F:** Support create, switch, close, inline rename, manual icon/color customization and reopen (Shift+T). The first tag determines automatic category icon/color, including mixed queries; the entire title uses that first tag's font color. Manual icon/color overrides are icon-specific. Custom titles replace the visible query label and survive query changes. Fifty contexts are a workflow scale, not a hard cap.

Only the active context mounts a gallery or viewer. Background contexts retain lightweight state rather than decoding media or playing videos. New active blank views immediately start the default all-post query. Background views created from tags use default filters without moving focus. **R:** bound/defer background fetch work to avoid request bursts, without changing these interaction outcomes.

### 4.2 Exact tag interaction matrix

These apply to interactive tags in the viewer, not autocomplete suggestions. There is no gallery tag list. Autocomplete insertion edits the pending input without submitting. A tag's source identity remains attached.

| Gesture | Required result |
|---|---|
| Primary click | Replace the current scoped query, reset filters to New search defaults, immediately search; focus input with trailing space |
| Shift + primary click | Append to current scoped query, preserve filters/order, immediately search; focus input with trailing space |
| Ctrl + click / Cmd + click | Create a new background view for that tag; do not activate it |
| Middle-click | Create a new background view for that tag; do not activate it |
| Browser Back | Restore the previous navigation/query state |
| Browser Forward | Restore the next history state |

No gesture in this table opens a real browser tab. Real browser tabs remain independently usable for the application. [C2–C3; H0, line 91]

**R — collision resolution:** Ctrl/Cmd or middle activation takes precedence over Shift; otherwise Shift appends; otherwise primary replaces. Handle each physical gesture once. Custom context menus apply to the item types/actions documented in UI section 12; do not bind background-view creation to secondary-click events. Keyboard access to equivalent actions remains an accessibility requirement to refine.

**R — append semantics:** add one whitespace-separated token, preserve the original query expression, avoid an exact duplicate positive token, and do not silently remove negated or conflicting terms. Complex conflicts remain visible for editing. Whether append should preserve duplicates is open; this is a proposed default, not a prior selection.

### 4.3 History state and restoration

**F:** Query changes and post navigation participate in browser history. Back undoes a tag replacement or append and restores the earlier query, results, selection and gallery position. Forward replays it. Opening and closing the viewer preserves the surrounding result context. Viewer next/previous changes media without reloading the document.

**R:** Maintain a navigation snapshot per history entry, keyed by context ID and revision. URLs represent source, query and optional post ID; large result sets remain in session state/cache. Use the supported SvelteKit navigation APIs for the selected version; the prototype's warning fix is evidence of a past repair, not a requirement to copy obsolete code. [H0, lines 89–93; T1]

| Action | Recommended history policy |
|---|---|
| Submit search; click/append tag; open post; next/previous post | Push one navigation entry |
| Switch existing view | Push context activation, restore destination state |
| Create background view | No active-history entry; current URL unchanged |
| Scroll, resize sidebar, pointer movement | Replace snapshot or persist transient state; never flood history |
| Explicit close viewer | Navigate to origin gallery; reuse origin entry when safe, otherwise push gallery fallback |
| Restore reload | Rehydrate current entry without adding duplicate history |

Browser history is linear across a tab; it is not fifty independent browser histories. Each entry identifies the relevant view. **O:** whether view switching should itself be undoable was not explicitly settled; the table proposes yes. If a historical view was closed, **R:** restore a temporary context from its snapshot rather than show a broken route.

Use a stable item ID plus intra-item offset for scroll restoration so justified-row reflow does not depend only on an obsolete pixel offset. If cached results have expired, refetch explicitly, keep query and selected post, and disclose that the result sequence changed. A direct post link without a context can show the post but must not fabricate a next/previous sequence.

### 4.4 Session and cross-device boundary

| State | Authority |
|---|---|
| Library, favorites, albums, tag cache, credentials, retained files | Server |
| Saved-search presets and their editable labels/types/covers | Server |
| Open-context identity and selection checkpoints | Per-workspace persistence; exact storage design recommended, not shared active state |
| Active view, active post, browser Back/Forward, pointer/zoom/scroll | Browser session |
| Reload checkpoint of current workspace | Browser session, recommended |
| Cached bytes/results | Evictable; never the library authority |

New browser tabs and devices have independent active exploration sessions. A duplicated tab may start with copied state but must receive a new runtime identity before mutations. Shared library changes use revision-aware updates and refresh/invalidation across clients; they must not move another device's active post. Full cross-device workspace resume is deferred. **F:** browser reload restores open views, temporary album entries, active context, queries, order, gallery scroll and viewer image; reset zoom/pan and video positions. Saved searches are shared reusable presets, distinct from active workspace contexts. Restoration after complete browser restart and closed-history lifetime remain open.

## 5. Search and tag metadata

### 5.1 Remote search

**F:** Begin with Gelbooru only. Preserve its query language, including advanced expressions, rather than replacing it with an incompatible simplified parser. The adapter normalizes results, pagination, dimensions, media variants, source IDs and tags. Avoid assuming counts or page availability when upstream omits them. [C2; H0, line 44]

**F:** staged Search-to-update, infinite scrolling with multiple-batch lookahead, embedded rating/sort/media icon filters, all ratings/media selected by default and Newest sorting. Sorting includes Newest, Oldest, Highest score and Random. The four UI rating labels are General, Sensitive, Questionable and Explicit. Typing `rating:` plus `g`, `s`, `q`, or `e`, then a space, sets that rating filter and removes the token from the query; the first token replaces the all-ratings default. Gelbooru has no `or` operator: one selected rating is sent as `rating:explicit` (full word); two or three selected ratings are sent as exclusions of the others, so General and Sensitive become `-rating:explicit -rating:questionable`; all four send no rating terms. `score:` and `id:` remain query text, pass through to the Gelbooru API, and have no special controls. Grouped query syntax is not supported. Live confirmation of the rating letters remains open. New blank views load default results immediately. Random batches suppress already-seen source/post IDs while retaining the existing sequence; this does not guarantee uniform sampling or exhaustive enumeration. See UI section 2 for source-documentation evidence and exact controls.

### 5.2 Autocomplete

**F:** Remote autocomplete, or the tag-search endpoint where appropriate, is the primary source. Cached suggestions can appear immediately while the server refreshes them. Use source-scoped category and count metadata. Avoid sending a lookup per displayed tag repeatedly.

**R:** Debounce typing, cancel superseded lookups, coalesce identical requests and reject stale responses with a request revision. Cache exact-tag batches separately from prefix/pattern results. Rank cached results consistently, then reconcile remote results without moving the active keyboard selection unexpectedly. When offline, label cached suggestions as potentially stale.

**F autocomplete:** Up/Down selects, selected Tab/Enter inserts with trailing space; Tab with none selected inserts the first suggestion; Enter without a selected suggestion submits. Completion replaces the caret token and preserves exclusion prefixes. Click inserts without submit. Escape dismisses without clearing. Tab does nothing when there are no suggestions.

**O:** debounce, minimum characters, TTLs, batch sizes and ranking are not finalized. Suggested starting values belong in configuration and performance experiments, not fixed product requirements. Respect verified upstream limits and backoff.

### 5.3 Tags and snapshots

Tag identity is `(source, source tag ID)` when provided, with a source-scoped normalized-name fallback. Names and categories are never global across boorus. Store raw category code and a normalized display category: general, artist, character, copyright, metadata or unknown, plus deprecated status. Deprecated tags display in their own final group in gray. The precise source-code mapping must be fixture-tested and live-verified; unsupported codes stay unknown instead of being guessed.

Saved post snapshots retain the tags present at save time. A separate referenced tag table supplies current classification, counts, deprecated status and fetched time. Refreshing an artist's category updates its appearance across the UI without rewriting the saved post's historical tag membership. A missing or deprecated tag does not delete the post-tag relationship. [C2]

**R:** stale-while-revalidate for tag metadata, batched on-demand refresh, optional low-priority background refresh of recently used tags. Keep failures retryable and retain old data. Never launch an unbounded crawl of the source's entire tag dictionary.

### 5.4 Local library search

Search the current album or Favorites without requiring upstream access. Autocomplete suggests only tags present on posts in that scope. A local rating filter keeps posts whose stored rating is one of the selected ratings. The Gelbooru exclusion translation in section 5.1 applies only when that filter is sent upstream. The media-type and sort controls stay the exploration controls; this search does not add a saved-date filter or a resolution sort. Index tag membership and identity; introduce SQLite FTS for textual fields only when needed. Do not implement grouping. `score:` and `id:` are remote passthrough operators, not local controls. Explain an unsupported local operator rather than returning misleading results.

## 6. Gallery, viewer and visual design

### 6.1 Visual direction

**F:** Extremely clean and minimal. Near-black gallery; viewer backdrop derived from a **low-resolution, blurred and dimmed rendition of the current image**. Foreground artwork remains sharp; update the backdrop when the image changes. Few thoughtfully placed controls, restrained surfaces, neutral sans-serif typography, no decorative gradients or large dashboard cards. Custom CSS controls the appearance. Selectively use accessible headless primitives for difficult interaction behavior. Earlier Catppuccin or gradient branding suggestions do not override the later minimal direction. [C7–C8]

**R — starting tokens, not approved exact styling:** gallery `#0b0b0d`, panels `#121215`, primary text `#eeeeef`, secondary text `#a3a3aa`, border `#29292f`, viewer backdrop from the current image with blur/dimming still to be tuned; a 4-pixel spacing base; compact controls around 32–36 pixels high; squircle-style gallery thumbnail corners with exact radii to be selected. Validate contrast and comfort in real compositions before adoption. Tag-category accents are semantic; they do not justify a multicolored decorative shell. Exact accent palette, font family, widths and motion timings remain design refinements.

Use subtle borders and whitespace to separate areas. Avoid gradients to make fading controls legible; a compact solid/translucent backing is sufficient. Inactive text must remain readable. Focus styling is deliberately more visible than resting controls.

### 6.2 Gallery composition

The persistent left sidebar follows section 3.4 and UI sections 7–8. In the main area, the search row has Save search on the left; an expanding input with rating/sort/media icons embedded at its right edge; Search outside; and Gallery options at far right behind a separator. Search hides on scroll down and returns on scroll up, reserving no gallery height while hidden. The floating backing is opaque and fades into place without shifting controls. Pending Search highlights without changing typography or dimensions.

**F:** Flickr-style justified rows use source aspect ratios. Allow slight cropping on full rows; keep the last row left-aligned without forcing it to fill. Layout must not oscillate during asynchronous loads or resize. Preserve an item-based scroll anchor during resize and thumbnail-size changes. Small thumbnails and a shared size slider support scanning.

**F tiles:** squircle geometry, borderless ordinary thumbnails, inset red favorite outline following the same shape with no hover changes; suppress that outline in Favorites-scoped galleries. No captions/titles. Hover/focus reveals top-right book-image then heart; bottom-left icon identifies video/animation. Hover stays static and does not brighten the image. Thumbnail failures retry once after one second, then expose per-item Retry. **R:** lazy-load and virtualize rows as scale warrants.

### 6.3 Viewer composition and reveal behavior

```text
┌───────────────────────────────────────────┬───────────────┐
│                                           │ Tags / info   │
│                blurred image backdrop     │ optional      │
│                                           │ resizable     │
│             fitted image/video            │               │
│                                           │ artist        │
│                                           │ character     │
│                                           │ copyright     │
│    sparse controls on interaction         │ metadata      │
│                                           │ general       │
│                                           │ deprecated    │
└───────────────────────────────────────────┴───────────────┘
  ↑ left-edge navigation reveal; no permanent gallery behind
```

**F:** The viewer replaces the gallery, rather than displaying as an overlay on visible thumbnails. The left navigation is almost entirely or completely hidden until the pointer approaches the far left. A right metadata/tag sidebar is optional, toggleable and resizable. Controls are sparse and fade on inactivity. Keyboard focus or interaction reveals needed controls. [C7]

**F:** the revealed left sidebar overlays the image without resizing it. B toggles it; outside click closes it while preserving the clicked action. Keep it open while hovered/focused and when switching through it to another viewer context; rendering must not dismiss it. Only a genuine departure or explicit dismissal closes it. The demo still has an unresolved immediate-dismissal bug. Exact edge-zone and timing remain open.

**F:** initial fit reserves right-panel space. At manual zoom, opening/resizing preserves zoom and focal point as bounds allow; artwork may extend behind the panel. Reset zoom/pan on image or view switching. Remember right-panel width/open state separately per view across reloads; new views start closed.

Sparse controls include previous/next, return to results, favorite, album, download/export, metadata toggle, fullscreen and fit/zoom access. Position counter is contextual: show a real loaded-sequence position; do not invent a total when unknown. Keep needed controls available while focused or operating a menu. An open right sidebar remains visible, and its top-right icon bar stays visible during inactivity and keyboard navigation. Otherwise arrow/A/D navigation hides sparse controls immediately. Exact error-state presentation remains open.

**F — zoom layering:** initial fit accounts for the open right sidebar. Manually zoomed artwork may extend behind the information/sidebar area rather than being clipped there. Every UI element remains above the artwork and interactive, including the info/tag panels, icon bars and navigation controls. The background blur applies to the low-resolution backdrop, not the full-resolution foreground image.

### 6.4 Images and video

**F images:** fit without cropping, native-resolution mode, pointer-centered zoom, panning, next/previous, keyboard navigation, fullscreen and neighbor prefetch. Preserve result context and avoid full-document loads. Originals are used for export and high-detail viewing; derivatives never replace retained originals.

**F zoom:** width ≥1920 px OR height ≥1080 px (configurable thresholds) qualifies for initial contain-fit; smaller images stay native unless they need shrinking to fit. This initial size is the minimum zoom. Pinch and Ctrl/Cmd-scroll zoom; drag/two-finger pan stays bounded per axis. Double-click at baseline goes to native size, or 2× baseline if already at/above native; double-click while zoomed resets. No trackpad next/previous navigation or swipe animation. Left/Right and A/D navigate even while zoomed.

**F controls:** top-right book-image, favorite, Download, Gelbooru page in new browser tab, fullscreen, details/tags toggle. Download initiates original file transfer rather than opening media. Edge buttons are translucent black circles with white icons and blur. F toggles fullscreen, I right panel, B left sidebar, W favorite, S album selector. Bindings are customizable; text entry retains normal editing behavior. Popover buttons toggle their own popovers closed; changing images closes the album selector.

**F video:** native browser decoding with a custom bottom playback bar. First-open autoplay with sound unless previously muted, automatic looping, remembered player volume/mute across reloads; no video-volume control in Settings. Returning within the browsing session restores position but stays paused; positions clear on reload. Space/click toggles playback, J/L seeks ±10 seconds, double-click toggles fullscreen; arrows/A/D navigate posts. Handle autoplay blocking and unsupported codecs with a clear fallback Play/download action. Transcoding remains deferred.

**F animation:** gallery video/animation thumbnails remain static. Supported original animated formats and source codecs still require verification; do not infer production format support from the still-image demo.

### 6.5 Accessibility and narrow windows

**R release requirements:** semantic landmarks; named icon buttons; visible keyboard focus; dialog focus return; keyboard-operable combobox, menus and sidebar splitter; non-color category labels; status text for queue state; restrained live-region announcements. When viewer opens, move focus to its navigation region and return it to the originating tile on exit. Provide accessible alternative media descriptions from available metadata, without inventing descriptions of artwork.

Use reduced-motion preferences to remove nonessential fades/transitions. Keep controls available through keyboard focus and touch-independent buttons. Pointer-only right-click and edge reveal always have explicit alternatives. Test at 200% zoom and with a screen reader in Firefox. Contrast should meet WCAG AA for text and interactive states (**R target**).

Desktop-first does not permit essential settings or login to become unreachable in a narrow window. **R:** collapse secondary controls and allow panel toggles at small widths, while deferring a purpose-built mobile navigation/viewer experience. Exact breakpoints and touch zoom behavior are open.

## 7. Library, saving and retention

### 7.1 Membership and durability

**F:** Favorites are separate from albums. A post can belong to multiple albums without duplicate original downloads. Favoriting saves metadata and queues the original. Saved metadata is a snapshot; optional synchronization is later. Successfully retained originals remain available after Gelbooru outage or deletion. [C2–C3, C6]

**F:** adding an unsaved post to any album saves its metadata and queues the original. Every save path uses global exact-metadata-hash and media-content deduplication. Repeated membership operations are idempotent.

| User action | Durable effect |
|---|---|
| Favorite | Ensure deduplicated snapshot/item; add favorite; ensure original job |
| Unfavorite | Remove favorite; keep other memberships; clean saved metadata/media if last membership, subject to undo recovery |
| Add to album | Ensure deduplicated item; add membership; ensure original job |
| Remove from album | Remove this membership; clean only if no album/favorite remains, subject to undo recovery |
| Delete album | Remove album and memberships; clean only uncollected items; never remove shared retained objects |
| Cancel collection import | Stop future additions; retain completed additions and continue their original downloads |
| Remote post disappears | Preserve locally retained bytes/snapshot while collection membership remains |
| Ctrl/Cmd+Z after image removal | Restore the last removal action without navigating, if it is still within 60 seconds |

There is no browsable orphaned All Library area and no remote-exploration deletion action. An open viewer is not a retention membership. Automatic cleanup must not race a new membership or delete shared bytes. Independent cover previews persist only while referenced by album/saved-search covers. Image-removal undo keeps the last removal action recoverable for 60 seconds, including after reload or from another device. A bulk removal is one action. A newer removal replaces that action and deletes the replaced snapshot and original immediately when nothing else retains them. When 60 seconds elapse, the same cleanup runs. Album-deletion undo remains unspecified.

A failed download cannot preserve bytes it never acquired. The UI must distinguish “saved metadata” from “original available locally.” A post deleted upstream while still queued may remain metadata-only permanently.

### 7.2 Snapshot versus refresh

Keep the save-time snapshot separate from transient remote cache. **R:** retain normalized fields and a bounded raw source payload with schema version, fetch time and provenance. Do not save secrets, full authenticated request URLs or headers in that payload.

Frequent tag-category refresh is fixed. Automatic changes to saved post tags, notes or translations are not. **D:** optional manual/bulk refresh with a diff and revision history. Any future refresh must be non-destructive: preserve original snapshot, local annotations and ready originals; remote deletion never becomes a local deletion instruction. Translation/notes display is contingent on verified source support; do not promise an editable overlay in MVP.

### 7.3 Albums and local management

**F:** manual album create/inline rename/delete, local search, multi-selection, sidebar pin/reorder, and customizable four-image covers (one primary plus three supporting images). Small evenly stepped fan geometry, hover expansion, tag-searchable cover editor and automatic border-color matching are specified in the [fan specification](Panbooru-Album-Fan-Specification.md). Automatic supporting-image updates stop at a threshold; manual choices remain fixed. Exact metric/threshold remains open. Smart albums are deferred.

**F saved searches:** store applied query, filters and sorting without scroll; automatic query name, editable label/type/cover, match-filled Save button and confirmation to delete. Opening always creates a new exploration view; Create album starts server enumeration/addition and original retention. Saved presets do not themselves retain originals. Keep these presets distinct from transient/reloadable contexts.

**F selection:** per-context selections survive navigation. Plain click toggles individual items; Shift selects/deselects ranges with clicked endpoint retained during range deselection. No drag selection. Ctrl/Cmd+A selects the entire query including unloaded results; server actions enumerate that query. Ctrl/Cmd+Shift+A clears but remains in mode. Collection viewer removal uses Ctrl/Cmd+Backspace on the displayed image; Ctrl/Cmd+Z restores membership without navigating. See UI sections 4 and 26.

Exporting an original downloads it to the current device and is distinct from retaining it on the server. Bulk originals download as one ZIP. **R:** prepare bounded server jobs rather than loading an album into browser memory. Interface sounds are mandatory to implement, user-disableable and separate from player volume; assets, platform policy and default enablement remain open.

## 8. Application architecture

### 8.1 Boundaries

```text
Owner browsers (independent sessions)
          │ HTTPS; authenticated same-origin requests
          ▼
Single SvelteKit / Node service
  ├─ owner authentication and application API
  ├─ Gelbooru adapter → restricted API egress
  ├─ restricted media transport → verified Gelbooru CDN paths
  ├─ library/search services → SQLite
  ├─ durable job worker → originals / derivatives / temp files
  └─ authenticated media serving → filesystem or bounded upstream stream
```

**F:** Server SQLite and filesystem are authoritative. The browser handles presentation, input, history and evictable cache. All source API/media traffic flows through the server. No direct third-party thumbnails, CSS background images or fallback URLs may bypass that rule. Cross-device access uses one server database, not a synchronization network.

**R:** one application image, one Node process with an integrated durable worker initially. Avoid Redis, separate DB service and independent API service until evidence justifies them. Prevent multiple worker instances from claiming the same job through database leases. Support graceful shutdown. Horizontal scaling is not MVP scope.

### 8.2 Module responsibilities

| Module | Responsibility |
|---|---|
| Source adapter | Search, post lookup, exact/pattern tags, normalization, capability declaration |
| Outbound transport | Destination validation, credentials, referrer policy, DNS/TLS, limits |
| Library service | Snapshot/save/membership transactions and retention |
| MediaStore | Temporary write, verification, atomic promotion, local streaming and removal |
| Job service | Durable state, lease, retry, cancellation, reconciliation |
| Navigation controller | Contexts, URL/history mapping, restoration, request revisions |
| Gallery/viewer | Layout and media interaction; no direct secret or persistence access |
| Auth/secret service | Owner login, session checks, key handling, encrypted credential access |

Keep source-specific parameter names outside generic UI components. Future adapter capabilities may include notes or distinct pagination, but implement only Gelbooru. Do not overbuild a universal query parser or cross-source search now.

**R proposed project areas:** `src/lib/server/{auth,secrets,db,library,jobs,media,sources}`, `src/lib/{navigation,components}`, application route handlers and tests. Validate the existing repository before moving files. This document has not inspected repository code and does not claim those paths already exist.

## 9. Data model and consistency

### 9.1 Proposed relational model

All dates use UTC timestamps internally; display local dates to the owner. Source post IDs should be stored as validated strings to avoid unsafe assumptions about numeric ranges. Use foreign keys, unique constraints and transactions.

| Entity | Essential fields / constraints |
|---|---|
| `owner` | Singleton ID, password hash, auth version, created/updated time |
| `sessions` | Hash of opaque token, owner ID, expiry, last seen, revocation |
| `source_credentials` | Unique source, ciphertext, nonce, auth tag, key version, validation status; no plaintext |
| `sources` | Stable source key, adapter identifier, enabled status; no arbitrary proxy base URL from ordinary requests |
| `remote_posts` | Unique `(source, remote_id)`, latest normalized cache, fetched time, remote availability |
| `saved_items` | Canonical metadata hash + hash/schema version with exact-match uniqueness; saved time, initial snapshot ID, retention state, revision; source identities/provenance referenced separately |
| `item_source_refs` | Item ID, source/post identity, remote locator/provenance; preserve distinct source references when metadata objects are reused |
| `post_snapshots` | Item ID, normalized snapshot, bounded raw metadata, source schema version, fetched/saved time, revision kind |
| `tags` | Source-scoped identity/name, raw/normalized category, count, deprecated status, fetched time |
| `snapshot_tags` | Snapshot ID, tag ID, historical tag name if needed; indexed reverse lookup |
| `favorites` | Unique item ID, favorited time |
| `albums` | ID, name, cover configuration, supporting-image manual/automatic state, match threshold status, pin/order, revision, timestamps |
| `album_items` | Unique album/item, optional order, added time |
| `media_objects` | ID, content hash, generated relative path, MIME, byte size, verification time, state |
| `item_media` | Item ID, role (original/thumbnail/variant), media object or remote locator reference |
| `derivatives` | Original ID, recipe version, dimensions, format, object ID; unique recipe key |
| `jobs` | ID, kind, item/recipe, deduplication key, state, attempts, next attempt, lease, progress, sanitized error |
| `saved_searches` | ID, label, editable type, source/query/filters/order, cover configuration, revision; no active pointer or scroll |
| `cover_previews` / references | Independently retained small media objects and album/saved-search references; cleanup at last cover reference |
| `workspace_checkpoints` | Optional persistence design for reloadable contexts/selection/panel state; distinct from saved-search presets; authority scope to refine |
| `removal_recovery` | Last image-removal action, its memberships, and recoverable object references; deleted after 60 seconds or when a newer removal replaces it |
| `settings` | Typed versioned settings; secret values excluded |
| `schema_migrations` | Applied version, timestamp, checksum |

**F — library-wide deduplication:** every save path (exploration, Favorites, albums, bulk/query-wide jobs and imports) deduplicates metadata and saved media. An exact **metadata-hash match reuses the existing item**, rather than saving it again; collection membership adds references. **Matching media content reuses one retained media object**, even when metadata differs. This is required, not an optional album-page optimization.

**R implementation:** compute a local cryptographic content hash such as SHA-256 for media; keep source-provided hashes as separate provenance. Define canonical metadata fields/serialization and hash versioning before implementing metadata deduplication. Use uniqueness constraints and transactional conflict handling across concurrent saves; do not merge distinct source provenance away. Shared media may be deleted only after its last retained reference is removed. Exact metadata hashing scope remains an open technical detail.

Indexes: source/post identity; source/tag name; snapshot-tag reverse lookup; favorite/save date; album/order; job state/next-attempt; derivative recipe; content hash. Use stable ID tie-breakers for paginated local search.

### 9.2 Transaction boundaries

**R save transaction:** canonicalize/hash metadata and reuse an exact match or create the item/first snapshot, preserve source provenance, ensure tag references, add favorite/album membership, insert deduplicated job, increment library revision; commit before returning saved state. Network retrieval occurs outside the transaction. If the transaction fails, neither a false favorite nor an untracked job is reported as successful.

**R media transaction:** stream to generated temporary file; verify actual byte count/hash/type; close and flush as supported; atomically rename within the same filesystem; commit ready object/reference. File and database operations are not a single atomic transaction, so recovery must cover the gap. A crash after rename but before DB commit leaves a recoverable orphan, not a ready item with missing bytes.

**R startup reconciliation:** reclaim expired job leases; mark interrupted writes retryable; remove stale temp files after a grace period; verify referenced files exist; flag missing/damaged originals; reconcile unreferenced final files conservatively. Do not delete an original merely because a concurrent transaction has not finished referencing it. Use a maintenance lock or generation/grace policy.

### 9.3 Concurrency

Shared owner data still has concurrent devices. **R:** revisions and `If-Match` for album/settings edits; conflicts return current revision and preserve user input. Favorite membership operations are set semantics rather than toggles on the server, preventing duplicate clicks from undoing each other. Job uniqueness plus transactional claim/lease prevents duplicate downloads. SQLite busy handling uses bounded retries; do not hold write transactions during upstream requests.

## 10. Application API contracts

**R:** The following route surface is proposed. All routes except minimal health/login/setup entry points require an owner session. All mutations require same-origin/CSRF validation and bounded bodies. None accepts arbitrary upstream endpoints. A different naming convention is acceptable if these contracts remain intact.

| Method and route | Contract |
|---|---|
| `POST /api/setup/owner` | Bootstrap proof + password; only before owner exists; atomic singleton creation |
| `POST /api/auth/login` | Password; rate-limited; issues session cookie |
| `POST /api/auth/logout` | Revokes current session |
| `GET /api/auth/session` | Owner/session status, no token disclosure |
| `GET /api/settings/gelbooru` | Configured/validated status, user ID if appropriate, key never returned |
| `POST /api/settings/gelbooru/validate` | Explicit Validate action; validate supplied credentials then atomically encrypt/save on success; preserve existing set on failure; no stored key returned |
| `POST /api/source/gelbooru/search` | Bounded query, pagination, supported filters; normalized posts + opaque continuation |
| `GET /api/source/gelbooru/posts/:id` | Validated ID; normalized post; no credential-bearing URLs |
| `POST /api/source/gelbooru/tags` | Bounded list of exact names/IDs; normalized cached/refreshed tags |
| `POST /api/source/gelbooru/autocomplete` | Bounded pattern/prefix; suggestions with source/category/freshness |
| `GET /api/media/:ref` | Session-bound access to server-issued reference; local or validated upstream bytes |
| `HEAD /api/media/:ref` | Same authorization and metadata behavior without response body |
| `POST /api/library/items` | Source/post ID plus destination membership; deduplicated snapshot + original queue, idempotency key; no orphan save |
| `GET /api/library/items` | Bounded local filters, order, cursor; no upstream dependency |
| `GET /api/library/items/:id` | Snapshot, memberships, media availability and job status |
| `PUT /api/library/items/:id/favorite` | Explicit boolean desired state; ensure save if creating favorite |
| `GET/POST /api/albums` | List/create manual albums |
| `PATCH/DELETE /api/albums/:id` | Revision-aware edit/delete; remove memberships and schedule safe last-reference cleanup |
| `PUT/DELETE /api/albums/:id/items/:itemId` | Idempotent membership add/remove |
| `GET /api/jobs` | Paginated queue/status/progress |
| `POST /api/jobs/:id/retry` | Requeue eligible failed/cancelled work |
| `POST /api/jobs/:id/cancel` | Cancel remaining work by job kind; collection import preserves additions and their retention downloads |
| `POST /api/jobs/:id/pause` / `resume` | Pause/resume collection additions without pausing already-added originals |
| `POST /api/collection-imports` | Enumerate applied whole-query selection/exclusions into album/Favorites; metadata-first progress |
| `GET/POST /api/saved-searches` | Shared query/filter/order presets with label/type/cover; no active-session cursor |
| `PATCH/DELETE /api/saved-searches/:id` | Edit preset label/type/cover or delete; leave open exploration contexts intact |
| `POST /api/removals/:id/undo` | Restore the last removal action's memberships without navigating while its 60-second recovery hold lasts |
| `POST /api/imports` | Bounded migration manifest/stream; resumable transfer protocol recommended |
| `GET /api/imports/:id` | Validation/progress/conflicts; no imported secrets |
| `GET /health` | Minimal process liveness; no library paths or secret state |

Use opaque media references generated from trusted normalized records; do not expose a generic `/proxy?url=...`. A signed reference is not an authentication substitute. Background download jobs must continue to resolve their durable locator after a browser's temporary media token expires.

**R response envelope:** successful JSON includes `data`, optional pagination/freshness/revision and request ID. Errors include stable `code`, safe `message`, `retryable`, request ID and optional retry delay. Suitable statuses: 400 invalid input; 401 owner session missing/expired; 403 forbidden/CSRF; 404 absent local resource; 409 revision conflict; 413 bounded input too large; 429 throttled; 502 invalid upstream response; 503 source/worker unavailable. An upstream credential failure gets a distinct code such as `SOURCE_AUTH_REQUIRED`, not an application 401 that logs the owner out.

A save can return 201 for first creation or 200 for an existing item, with media state `queued`; job retry/cancel can return 202. Do not return success/ready before original verification. Authenticated JSON and secret endpoints use private/no-store cache controls. Media may use authenticated private browser caching with explicit policy; never public shared cache by default.

**R:** initial queue/library updates may use bounded polling keyed by revision; SSE can replace polling later. Exact event transport is open. Never stream credential data in events.

## 11. Security and credential lifecycle

### 11.1 Trust and threat boundary

The owner trusts the host administrator, application process and mounted storage. Encryption protects a stolen database alone; it does not protect against full host compromise when the process can access both ciphertext and key. A browser that is logged in can access private content; XSS remains a serious boundary. HTTPS protects transport, not a compromised host.

**Required controls:** authenticate private endpoints and media, validate inputs, constrain outbound destinations, prevent credential logging, separate encryption key from database, and avoid direct browser upstream access. No multi-user permission system is needed.

### 11.2 Owner authentication

**R:** store a salted, adaptive password hash using a maintained password-hashing implementation, preferably Argon2id with resource parameters chosen on target hardware. Never encrypt passwords for recovery. Use high-entropy opaque sessions, store only token hashes, and set cookies `HttpOnly`, `Secure`, `SameSite=Lax` or stricter, narrow path/domain. Rotate after login/password change and support logout/revocation. Define session idle/absolute lifetimes before release; no values were finalized.

Rate-limit login/setup/test-credentials. Prevent owner setup races with a database singleton constraint. Bootstrap proof is supplied locally once, invalidated after setup, and excluded from routine logs. **O:** password recovery UX; **R:** local administrative reset command that revokes sessions, with no public password-reset endpoint. Reverse-proxy auth integration is deferred; built-in auth works without additional identity infrastructure.

### 11.3 Gelbooru secret handling

1. Owner submits user ID/API key over HTTPS to a dedicated body-based endpoint.
2. Server bounds input and validates through the fixed Gelbooru adapter only after Validate is pressed. Successful validation automatically saves; validation failure leaves the existing encrypted set unchanged.
3. **R:** encrypt stored credentials with AES-256-GCM, unique cryptographic nonce per encryption, authentication tag and key version. Authenticate source/record version as associated data.
4. Store ciphertext in SQLite. Store the master key in a distinct persistent secret mount/file with restrictive owner-only permissions, or a supplied Docker secret. Never put it beside a database export or bake it into the image.
5. Decrypt only inside server code when needed; do not serialize plaintext into SSR data, hydration state, errors, analytics or browser storage.
6. The settings UI returns status only, never the stored key. Clear the submitted key from client form state after success; show/hide applies only to newly typed unsaved text. Replacement requires a new entry. No Remove credentials UI is provided.
7. Rotation re-encrypts transactionally under a new version and preserves a recoverable backup until verified. If a key is missing or authentication fails, fail closed; do not generate a new key over existing ciphertext.

Generate a key only on an actually fresh installation. Back up key material separately and encrypted; losing it makes existing credential ciphertext unrecoverable but must not destroy the library. Owner can re-enter credentials. Do not derive the encryption key solely from a login password, which complicates resets and background work.

The browser necessarily contains freshly entered plaintext before submission; clear form state after success and never claim browser JavaScript cannot see that entry. The server must redact upstream credential query parameters if the source requires them. Disable URL/body capture in reverse proxy logs, tracing, error reporting and test artifacts for these paths. [C6; H0, line 59]

### 11.4 API and media egress

- API destinations are fixed HTTPS origin/path and supported operation/parameter allowlists. Browser input never chooses a host, scheme or API path.
- Media destinations are selected from normalized source records and checked against exact verified HTTPS hosts, ports and path shapes. Do not enable a broad wildcard merely because a URL came from the API.
- Reject URL userinfo, IP literals, ambiguous encodings, unauthorized ports, fragments and unexpected query parameters. If a real CDN needs query strings, allow only verified fields; never pass credentials through a media URL.
- Resolve and validate all destination addresses against private, loopback, link-local and special-use ranges; pin the approved connection address with TLS hostname verification to resist DNS rebinding. Apply equivalent protections to API egress.
- Reject redirects by default. If needed later, revalidate each hop and never forward secrets across origins.
- Server supplies a source-specific `Referer` header for media as required by Gelbooru. Never trust or forward the browser's referrer as policy. Exact value and affected CDN operations must be verified; the handoff did not establish them. API referrer behavior is separate.
- Forward only deliberately supported media headers such as a valid single byte range and media Accept. Never relay owner cookies, browser Authorization, arbitrary headers or API credentials to the CDN.
- Allow only supported passive raster/video MIME types; reject HTML/SVG/script and inconsistent responses. Use `nosniff`; treat source text as escaped data.
- Enforce per-operation bytes, concurrency, bandwidth, DNS/connect/idle limits and cancellation. Original video downloads need a distinct budget from thumbnails, not the old diagnostic 32 MiB/30-second cap.

[H0, lines 63–75] is a reusable controlled-test baseline. New owner authentication, source-generated referrer and durable server downloads must be tested explicitly. Referer handling is a compatibility requirement, not permission to disable validation.

### 11.5 Browser and storage defenses

**R:** restrictive CSP allowing application-owned script/style/media connections only; no third-party analytics or remote font dependency. Validate mutation Origin and use CSRF tokens where appropriate; deny cross-origin API access. Configure the public application origin explicitly and trust forwarded headers only from the configured reverse proxy. `SameSite` alone is not the entire CSRF defense.

Generated internal media paths prevent path traversal; never use raw tag names or source filenames as filesystem paths. Reject symlink escapes and archive traversal during imports. External source links use safe protocols and `noopener`/referrer protections. Authentication applies to partial-range requests and derivatives as well as originals. Public health responses expose no configuration or data.

## 12. Media pipeline and background work

### 12.1 Three storage classes

| Class | Policy |
|---|---|
| Browsed upstream media | Bounded stream via proxy; not automatically permanent |
| Temporary cached bytes / derivatives | Size-bounded, evictable and regenerable |
| Saved originals / snapshots | Retained while album/Favorites membership remains; automatic last-membership cleanup with undo recovery; never cache-evicted while retained |

**F:** Original downloads happen server-side and continue when the browser closes. **R:** prefer local ready bytes; otherwise stream validated upstream media. Keep original and derivative paths separate. Disk status distinguishes retained originals from cache and temporary work.

### 12.2 Durable queue contract

**R job states:** `queued → running → verifying → succeeded`; retriable failures enter `retry_wait`; terminal failures `failed`; cancellation uses `cancel_requested → cancelled`. Media availability is separate: `not_downloaded`, `queued`, `downloading`, `verifying`, `ready`, `failed`, `missing`, `cancelled`.

Use transactional claims, expiring leases/heartbeats and deduplication keys. Persist progress periodically without excessive writes. Retry transient network/5xx errors with bounded exponential backoff and jitter; respect upstream retry delays. Pause credential-dependent work on authentication errors. Do not repeatedly retry deleted resources, unsupported formats or permanent policy rejection. User retry can re-evaluate a changed source URL.

Media-transfer cancellation aborts that transfer, removes/quarantines partial files and preserves retained metadata. Collection-import cancellation instead stops future additions while completed additions and their original-download jobs continue. Pausing an import likewise stops additions without stopping those downloads. Collection-task progress/counts reflect metadata added, not media completion; no media-state filter is exposed there. Retry cannot race cancellation into a falsely ready object. A source URL expiring can trigger a bounded post lookup without overwriting saved snapshots. Interrupted partial downloads may restart from zero; resumable transfer is optional and requires validator/range integrity checks.

### 12.3 Image optimization and prefetch

**F:** server ownership enables optimization for bandwidth-limited clients; originals remain authoritative. **R:** use Sharp or equivalent to generate thumbnails and viewport variants with recipe/version keys. Limit dimensions, decoded pixels, memory, concurrency and processing time. Preserve original color/orientation information; normalize display orientation consistently. Do not flatten animation without labeling the derivative as a static preview.

**R:** prioritize visible media, then adjacent viewer posts, then gallery lookahead, then low-priority derivative work. Cancel stale speculative work. Prefetch a small configurable neighbor window rather than all fifty views; exact count/budget is open. Avoid speculative full-video downloads. Neighbor decode/cache hits should eliminate unnecessary blank frames, while a slow next image receives a clear loading state rather than showing the wrong previous post as current.

Derivatives are disposable. Generation failure falls back to an authorized original/proxied representation and reports an actionable problem only when viewing is blocked. Low-bandwidth modes and exact output formats/quality settings are recommendations to evaluate, not fixed decisions.

### 12.4 Streaming and range behavior

Local and upstream media paths support GET/HEAD and valid single Range behavior. Verify 200, 206, 416, `Content-Range`, length, cancellation and seek behavior. Do not report byte ranges for a transformed derivative using the original's length. An upstream server ignoring Range may require a safe 200 fallback; never fabricate a 206 response. Avoid buffering a full original in application memory. Queue retention and viewer streaming can share a completed file, but in-progress partial files must not masquerade as complete originals.

## 13. Failure modes and observability

| Failure | Required or recommended response |
|---|---|
| No credentials / expired key | Explain connection status, preserve library access, stop auth retry loop |
| Upstream rate limit/outage | Keep query/context, retain cached results labeled stale, back off |
| HTTP 200 with HTML/malformed API JSON | Adapter validation error; never interpret as empty successful results |
| Media host not approved / unsafe DNS | Fail closed with safe explanation; no browser-direct fallback |
| Referrer incompatibility | Surface source transport error; verify policy rather than weaken egress |
| Remote deletion before original ready | Preserve metadata, mark unavailable and retryable only when appropriate |
| Remote deletion after ready | Serve local original and snapshot |
| Disk full / read-only mount | Stop writes cleanly, retain snapshot/memberships and failed job; never mark ready |
| Process crash mid-write | Reconcile temporary/promoted bytes and expired leases on startup |
| Missing/corrupt retained file | Flag repair needed; avoid claiming offline durability; restore/re-download if possible |
| Lost encryption secret | Disable source connection; permit owner login/library and credential replacement |
| DB locked / concurrent edits | Bounded retry or conflict response; preserve input and state |
| Expired owner session | Prompt login, retain non-secret UI context, deny API/media requests |
| Unsupported video codec | Clear fallback and original export; no false playback promise |
| Browser history snapshot evicted | Restore URL query/post with disclosed context loss, not a fabricated sequence |
| Migration interrupted | Resume/import report, no source deletion, no duplicate completed files |
| Backup failure | Clear failure status and actionable reason; never mark partial backup complete |

**R:** structured logs with request/job IDs, safe error codes, latency and byte counts. No API keys, owner passwords, session tokens, raw upstream authenticated URLs or default logging of queries/tag lists. Keep metrics limited to queue depth, errors, disk capacity, cache size and response/processing latency. Owner diagnostics can include sanitized host-policy status. Exact retention and telemetry policy is open; default to local-only diagnostics without third-party telemetry.

## 14. Deployment, backups and migration

### 14.1 Deployment contract

**F:** self-hosted Node/Docker application with persistent SQLite and filesystem. **R:** Compose example with one application service and a separately configurable HTTPS reverse proxy; no external DB/Redis required. Use a non-root image, pinned tested dependencies/lockfile and persistent mounts. Keep secrets outside the image and database directory. Default bind exposure should be local/private until HTTPS/auth setup is complete.

Proposed storage layout:

```text
/data/db/panbooru.sqlite
/data/media/originals/
/data/media/derivatives/
/data/cache/
/data/tmp/
/data/backups/        # optional staging; not the only backup copy
/run/panbooru-secrets/master.key   # separately persisted secret mount
```

The secret mount must survive replacement of the container; `/run` in this example is a mount location, not an instruction to keep the only key in ephemeral container storage. Generated originals and temp promotion should share a filesystem for atomic renames. SQLite belongs on storage with supported locking semantics; do not casually mount the database on a network share.

**R operator flow:** configure data/secret volumes and application origin, start service, establish HTTPS and bootstrap owner, enter Gelbooru credentials in UI, verify authenticated search and approved media transport, then create a test save and restore it from backup. Document storage capacity and permissions. The discussed 5–50 GB library is a planning range, not a verified capacity guarantee. [C3; H0, line 83]

Graceful shutdown stops new job claims, aborts/drains active streams and leaves recoverable jobs. Minimal liveness and owner-visible readiness distinguish process health from DB/key/storage readiness. For upgrades, take a backup, run versioned migrations once, and fail closed on unsupported newer schemas. Do not promise that an older image can open a migrated database.

### 14.2 Backups and restore

**R release requirement:** backup database, retained originals, independently referenced cover previews, a manifest of hashes/schema/application version, and separately protected encryption key. Regenerable cache/derivatives can be omitted; cover previews whose originals were cleaned cannot be regenerated and must be backed up. A database alone is not a media backup; original files alone lose collection structure.

Use a SQLite-supported consistent backup mechanism rather than copying only a live database file and ignoring WAL state. The official backup API provides a database snapshot; coordinate it with media retention so garbage collection cannot remove objects referenced by that snapshot. [T2]

**R simple first implementation:** enter maintenance mode, pause job finalization/deletion and DB mutations, take DB snapshot plus referenced-file manifest, protect referenced originals while copying, then release maintenance mode. Mark backup complete only after verification. Encrypt exports containing credentials and keep key backup separately from ordinary DB exports. Keep at least one backup outside the live host/storage volume. Frequency, retention and recovery objectives remain open operational choices.

Restore into an empty test location; validate manifest/schema/hashes, restore the correct secret if needed, check memberships and local viewing with upstream blocked, then switch the deployment. Record missing files rather than silently dropping library records. Test restore before advertising backups as reliable.

### 14.3 IndexedDB/OPFS prototype migration

**H:** Existing prototype data is browser-origin-owned Dexie and OPFS, not automatically readable by the Node server. The new server cannot enumerate another origin's browser storage. A changed domain/port creates a different origin; migration needs an exporter running under the old origin. [H0, lines 20, 77–93]

**R migration sequence:**

1. Inventory actual prototype schema/version and MediaStore behavior before implementation. Do not assume diagnostic schemas equal this proposed schema.
2. Run a bounded exporter in the original browser/origin. Export favorites, albums, saved-post metadata, source-scoped tags, any existing saved-query presets/identity data and available original bytes. Report missing/failed OPFS entries. Exclude credentials and session history by default.
3. Produce a versioned manifest with stable source/post IDs, relationships, sizes and checksums. Stream large files or bounded chunks; never collect a 50 GB library in browser RAM.
4. Authenticate to the destination and create an import session. Validate schema, file bounds, path safety and totals; show dry-run conflicts/missing bytes.
5. Upload verified chunks/files with resumable session state. Map old IDs to new IDs; apply the same exact metadata-hash and media-content deduplication as every save path, preserving source/post provenance idempotently. Preserve original save timestamps and provenance where known.
6. Import bytes through the same temporary-write/hash/promotion path used by downloads. Commit memberships/snapshots in recoverable batches. Duplicate imports do not multiply favorites, albums or originals.
7. Report imported, skipped, conflicted and missing items. Imported records without album/Favorites membership require an explicit destination decision; do not silently create a permanent orphan collection. Retained metadata-only records may queue an original fetch with owner visibility; do not call them restored originals.
8. Verify representative items and full manifest totals, including upstream-blocked library reads. Keep original browser data until the owner explicitly removes it after successful verification and backup.

**O:** old-version compatibility span, archive/chunk format, album-name conflict policy and saved-query/workspace migration fidelity. **R:** preserve conflicting metadata as an imported snapshot; do not overwrite newer central data silently. Enter fresh Gelbooru credentials through new settings. Old browser storage ceases to be authority only after import verification, never just because a new server started.

## 15. Validation and acceptance

The original specification ran no application tests. Later demo edits received syntax and selected pure-logic checks; these do not establish production functionality, browser performance or visual correctness. Historical passes remain attributed to the handoff. Scenarios below remain production release gates.

### 15.1 Test layers

**R:** unit tests for normalization, query/tag actions, category mapping, navigation reducer and retention rules. Controlled integration tests for SQLite transactions, job lease/retry, encryption tamper/rotation, streaming/ranges and filesystem failure recovery. Firefox-first end-to-end journeys with Chromium regression coverage. Live authenticated checks are separate, opt-in and sanitized; fixtures never stand in for verified CDN behavior.

Security suites cover arbitrary URL rejection, redirects, private and mixed DNS answers, rebinding, malformed URLs, path traversal, active MIME, oversized/chunked responses, stalled DNS/connect/idle phases, cancellation and leaks. Source credentials must be absent from browser storage, returned API payloads, SSR HTML, application URLs, logs and media requests. A credential-entry body is expected; tests must reflect the new architecture rather than retaining the old assertion that credentials never reach the server. [H0, lines 63–75, 101]

### 15.2 Traceable acceptance scenarios

| ID | Scenario and pass condition | Requirement |
|---|---|---|
| A01 | Fresh setup can be claimed once only with bootstrap authorization; subsequent unauthorized setup is denied | F03, F07 |
| A02 | Validate explicitly tests and auto-saves/replaces Gelbooru credentials only on success; stored key never returned; failure preserves previous set; stored ciphertext differs; tampering/lost key fails closed | F06 |
| A03 | Real authenticated search, post lookup, exact tags and autocomplete work via server with sanitized evidence | F02, F08, F19 |
| A04 | Verified approved live media renders with required server Referer; unsafe/unapproved hosts remain blocked | F08 |
| A05 | Fifty views retain independent query, selection and positions; only active view mounts media; background creation causes no focus jump | F09 |
| A06 | Every gesture in section 4 produces exactly its stated result, including middle/modifier activation, autocomplete distinction and collection scope | F10 |
| A07 | Back restores `landscape sunset` after clicking `forest`, including results/position; Forward restores `forest` | F10 |
| A08 | Shift-append and viewer next/previous are reversible; no full-document reload, history warnings or stale result overwrite | F10 |
| A09 | New/duplicated tabs and two devices navigate independently while sharing a favorite/album change | F16 |
| A10 | Gallery is justified with intrinsic ratios and persistent left navigation; resize retains a useful anchor | F11 |
| A11 | Viewer replaces gallery, backdrop uses a blurred/dimmed low-resolution version of the current image, zoomed artwork extends behind UI while all controls remain above and interactive, edge reveal works, right panel resizes, keyboard controls remain discoverable | F12 |
| A12 | Fit/native zoom, pan, focal-point zoom and prefetch work without stale media flashes; original export remains original bytes | Viewer requirements |
| A13 | Supported live video seeks using authenticated 206/416 handling; leaving viewer stops playback | Video requirements |
| A14 | Favorite returns metadata/membership plus queued state; browser closure does not stop server download | F13–F14 |
| A15 | Interrupted/disk-full/hash-failed write never becomes ready; restart reconciles and retry succeeds safely | F05, F14 |
| A16 | Ready item remains searchable/viewable after upstream blocked/deleted; pending failed item is labeled unavailable | F15 |
| A17 | Last-membership removal/album deletion cleans only unreferenced saved objects; undo restores image membership without navigation; shared objects/covers remain safe | F20–F21 |
| A18 | Frequent tag-category refresh updates presentation without replacing saved snapshot membership | F19 |
| A19 | Owner cannot retrieve another secret via SSR/API/logs; unauthenticated and cross-origin mutation/media attempts fail | F06–F08 |
| A20 | Verified restore recreates metadata, favorites, albums and ready originals; wrong/missing key has explicit recovery path | Backup requirement R |
| A21 | Repeated/interrupted old-origin import resumes without duplicates; source data remains untouched | Migration requirement R |
| A22 | Keyboard-only and Firefox screen-reader paths cover search, tag branching, viewer, panel resizing, favorite and login | Accessibility R |

### 15.3 Performance evidence and release review

**R:** measure on a named desktop/browser/server and representative library/media set. Record search latency excluding/including upstream, gallery scroll responsiveness, mounted/decode counts, viewer cached navigation delay, memory with fifty contexts, queue throughput and slow-connection behavior. Exact numeric service objectives are open; do not invent a guaranteed 50 ms navigation time or library size from prototype evidence.

Review gallery, viewer, empty/error states and focus states separately at typical desktop sizes and narrow windows. Confirm minimalism with actual media content: no visible gallery underneath; top-right bar remains visible while right panel is open; logo placement reserved with artwork undecided; no decorative gradient shell. A design review should select final tokens and control placement before claiming pixel-level completion.

## 16. Delivery roadmap and open questions

### 16.1 Recommended dependency order

| Stage | Deliverable | Exit evidence |
|---|---|---|
| 0 — Baseline audit | Inspect existing repo/schema, preserve handoff and reusable tests, record changed boundaries | Clear inventory; no invented Milestone 0 closure |
| 1 — Secure central foundation | Owner setup/login, encrypted UI credentials, SQLite/filesystem abstractions, restricted API transport | A01–A04 and new-boundary security checks |
| 2 — Navigation and visual foundation | Gallery/viewer designs, lightweight contexts, history/restoration, tags/cache | A05–A11; Firefox interaction review |
| 3 — Durable library | Save transactions, queue, recovery, favorites, basic albums and local search | A14–A18, two-device shared library |
| 4 — Media completeness | Zoom/pan/fullscreen, bounded prefetch, image derivatives, video/ranges | A12–A13; real source transport evidence |
| 5 — Release hardening | Import, backups/restore, accessibility, deployment documentation, storage/security checks | A19–A22 and recorded release review |
| Required UI completion | Saved-search/cover workflows, selection/query imports, configurable shortcuts, interface sounds and image-removal undo | Current UI decision record and Firefox acceptance review |
| Later | Other boorus, mobile redesign, smart albums, metadata refresh UI, advanced optimization/transcoding, installer | Separate scoped requirements |

These stages replace conflicting historical milestone labels; they are proposed planning labels rather than claims about already completed work. Live integration depends on verified API responses and media destinations. Design can proceed in parallel conceptually, but this request authorizes document creation only, not application implementation or deployment.

### 16.2 Genuine open details

| Question | Consequence / recommended next step |
|---|---|
| Exact live API behavior, limits, CDN host/path set and Referer value | Block live-access signoff; verify through restricted server with sanitized owner-authorized checks |
| Source mapping for chosen rating labels | All UI ratings/media default selected and Newest sort are fixed; verify source mapping, especially General/Sensitive |
| Batch lookahead/resource budgets | Infinite scroll is fixed; select limits and preload defaults through measurement |
| History on view switching/closed views | Adopt documented recommended policy in section 4 unless owner chooses otherwise |
| Unsaved workspace persistence beyond reload | Keep active sessions independent; centrally save explicit views first |
| Duplicate/negated token append | Use section 4 proposed rule, document complex-expression behavior |
| Final typography, palette, panel widths, row height, fade/reveal timing | Resolve in separate gallery/viewer review; image-derived blurred/dimmed backdrop is selected, but exact treatment remains open |
| Shortcut capture/platform conflicts | Defaults and current gestures are fixed in UI record; validate Firefox/macOS behavior and customization conflicts |
| Supported video/animated formats | Autoplay/loop/player volume persistence are fixed; verify codecs, autoplay blocking and playback controls |
| Remaining album details | Cover fans/customization and bulk ZIP are fixed; unspecified fields and content-order refinements remain open; smart albums deferred |
| Undo recovery window/mechanism | Decided 7 November 2026: last removal action, including one bulk removal, recoverable for 60 seconds; then last-membership cleanup. No browsable bin |
| Interface-sound assets/platform/default policy | Implementation with disable setting is required; actual Apple assets cannot be assumed licensed |
| TTLs, concurrency, byte/time budgets and cache capacity | Measure source limits and host resources; separate browsing and original-video budgets |
| SQLite driver/ORM and exact runtime packages | Pin compatible maintained versions after repository audit; historical handoff pins are evidence only |
| Password recovery, session lifetimes and key rotation UX | Resolve before remote-access release; local recovery preferred initially |
| Backup frequency/retention, recovery-time/data-loss objectives | Owner operational choice; restore test required regardless |
| Migration format and old schema compatibility | Inspect actual Dexie/OPFS versions; preserve provenance and resume safely |
| License/distribution and current source-policy compatibility | No license or legal assurance was finalized; verify source terms before distribution, without assuming API access grants redistribution rights |

No unanswered item changes the fixed architectural choice: Panbooru is a single-owner server-backed application, not the old browser-authoritative prototype. Panbooru will have a logo; its artwork remains open.

## 17. Sources

### Conversation requirements

All conversation citations refer to [Bootstrap Booru Feasibility](chatgpt-conversation://6accf93c-85f4-83eb-9e53-a1dc26cfa458). Turn identifiers below allow precise retrieval. Quoted phrases are short user-authored decision anchors; assistant proposals remain recommendations unless subsequently selected.

- **C1:** opening custom-client intent, read-only source access, favorites/albums/viewer; user turn `e312a0b1-e3c2-4386-9863-0ab5ab1d8324`. Custom CSS preference: `bef78914-fbe6-4a1c-87b2-e722ab216a7f`.
- **C2:** detailed 50-tab workflow, middle-click, tag categories, snapshot durability, desktop priority and Gelbooru/Danbooru direction: `b459d1d8-cd43-4bed-bce8-328e9cce079d`. Gelbooru-only start: `01541840-dcfd-4ddc-b8a9-b1bdba92df09`.
- **C3:** selected answers and exact tag/back behavior: `f5974e84-03a7-4122-994d-bb99fee91106`. The selected answer mapping is recorded in the assistant's response there; it is distinguished from additional proposals in that response. Integrated SvelteKit choice “B”: `eb835a1a-2b08-4379-b10f-0589d7e406a0`.
- **C4:** attached Milestone 0 handoff: `e39d7032-7ff5-4ebd-9723-06f8230fcbae`; subsequent API-proxy choice “A”: `77d010b0-715b-4528-b904-fb2a73d62fb1`; follow-up plan request: `53fe114a-419d-4cf8-9378-fb701db39507`.
- **C5:** proxy/referrer and distribution concerns: `0f8f625f-9ae3-4ad8-99ec-5bc7c48995ae`; final self-hosting choice: `bbe05bce-2758-42cd-b69f-228f20cf821e`.
- **C6:** server-authoritative storage and cross-device rationale: `14aaafc3-75af-43f4-8dd4-d5993ff03155`; single-user credential security: `1e32040a-005d-4792-9bba-6cd17ca98d6f`; UI credential entry: `e1ee507d-554f-49f3-ab55-73696daa4d33`; consolidated outline request/response: `01181dda-e07c-4436-91b6-0574e2d40141`.
- **C7:** less clutter and darker backgrounds: `f7c29df0-c401-4340-999c-3787de32080c`; justified gallery/replacement viewer/left-edge reveal/right sidebar: `0864232f-a973-42c1-9d75-0eceb165b641`; historical viewer-background instruction (superseded by C9): `fe799dbc-e46a-4b6d-b075-cfe1050fd641`; separate gallery-design focus: `db80b2fd-3bdb-4192-976a-fb803f039dcb`.
- **C8:** clean minimal overall design: `c87468ad-060d-4d58-af66-d8f47657837e`; historical naming/design instruction: `45a990d2-ce15-4624-bf90-4e4fa9efc2cb`. Later user decisions in the current UI record supersede the old no-logo and other earlier design instructions.

### Current UI requirements

- **C9:** [Panbooru UI decision record](Panbooru-UI-Decisions.md), user-approved decisions through 18 October 2026 in the current chat, including later prototype review and explicit corrections. This is the detailed UI authority; it does not turn prototype bugs/constants into requirements.

### Historical evidence

- **H0:** [Controller handoff: Milestone 0 Gelbooru explorer, 12 October 2026](sources/milestone-0-handoff-2026-10-12.md). Retrieved attachment `Pasted text(20261012-210623).txt`, preserved as Markdown source. Line references in this document point to that copy. Repository filenames mentioned there are historical references, not files independently inspected for this specification.

### Primary technical references

Checked 15 October 2026. These support narrow implementation guidance; they do not convert a recommendation into a user decision.

- **T1:** [SvelteKit navigation API](https://svelte.dev/docs/kit/$app-navigation), [SvelteKit routing](https://svelte.dev/docs/kit/routing), [SvelteKit v3 migration](https://svelte.dev/docs/kit/migrating-to-sveltekit-3). Select supported navigation behavior for the actual installed version; do not assume historical warning-fix code is current.
- **T2:** [SQLite online backup API](https://www.sqlite.org/backup.html). Used for the consistent database-backup recommendation; media-file coordination is Panbooru's proposed application responsibility.
- **T3:** [Gelbooru API wiki](https://gelbooru.com/index.php?id=18780&page=wiki&s=view). Implementation reference for the source API; this document does not assert live authenticated endpoint/format verification or quote current source policy as legal approval.

---

**Deliverable boundary:** this specification defines the product and proposes implementable technical contracts. It creates no application, performs no live authenticated probes, and supplies no logo assets.
