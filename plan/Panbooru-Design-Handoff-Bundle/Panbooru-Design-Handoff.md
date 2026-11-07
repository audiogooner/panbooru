# Panbooru — handoff for precise visual design

**Prepared:** 18 October 2026 · **Next phase:** design language and precise visual specification

## Start here

The owner considers the UI interaction work largely finished. The next phase is to develop a coherent, clean visual language and turn it into a precise, implementation-ready design specification **together with the owner**. Refine appearance, hierarchy, geometry, component states and motion. Preserve the agreed interaction model; do not restart product discovery or implement the production app by default.

**Critical distinction:** the existing HTML prototype tested whether the UI decisions worked. **It is not a general visual reference.** Its arbitrary colors, fonts, dimensions, spacing and incidental styling are not approved design tokens. Specific visual outcomes explicitly accepted by the owner remain requirements, as listed below and in the decision record.

## Authoritative files

All paths below are relative to this handoff's directory. Read these files rather than relying on a cached conversation summary.

| File | Role / precedence |
|---|---|
| [Panbooru-UI-Decisions.md](Panbooru-UI-Decisions.md) | Current detailed interaction authority. Read first, especially sections 1–3, 7–10, 14, 16–17, 20 and 23–26. |
| [Panbooru-Album-Fan-Specification.md](Panbooru-Album-Fan-Specification.md) | Focused cover-fan rules. The UI record wins if they diverge. |
| [Panbooru-Specification.md](Panbooru-Specification.md) | Product/technical context, revised to edition 1.1 on 18 October. Fixed decisions versus proposed implementation contracts are labeled. |
| [panbooru-ui/README.md](panbooru-ui/README.md) | Prototype scope, known omissions and verification limits. |
| [panbooru-ui/index.html](panbooru-ui/index.html) | Local interaction demo. Use to understand behavior, not to inherit its appearance wholesale. |
| [sources/milestone-0-handoff-2026-10-12.md](sources/milestone-0-handoff-2026-10-12.md) | Historical technical baseline and CORS blocker; not a design reference or current implementation claim. |

**Precedence:** latest explicit owner instruction → current UI decision record → focused fan extract → product/technical specification → recommendations. Prototype behavior, assistant suggestions and generated mockups never override explicit decisions.

Canonical workspace:
`/Users/nils/Documents/Codex/2026-10-15/referenced-chatgpt-conversation-this-is-an-2`

Canonical editable documents are directly under `outputs/`. Older extracted bundle directories, old search demos and files under `work/` are not the current authority. Use the current top-level files and freshly rebuilt ZIPs.

## Product context to preserve

- **Panbooru** is the final name. It **will have a logo**, but no artwork is selected. Reserve placement; do not resurrect the old instruction to exclude a logo or invent approved artwork.
- Desktop-first, **Firefox primary**, particularly macOS keyboard/trackpad behavior. Responsive refinement is later, while essential controls must remain usable in narrow windows.
- Single-owner, self-hosted Svelte 5/SvelteKit Node/Docker app. Gelbooru-only MVP; other sources later.
- Server SQLite/filesystem is authoritative, shared across the owner's devices. All source API/media requests pass through the protected server. The local demo does not implement this architecture.
- Custom CSS and selectively accessible headless primitives. Do not impose Bootstrap/Tailwind styling or a generic dashboard shell.
- Whole-library metadata/media deduplication; Favorites and albums independently retain content. Last-membership removal triggers safe cleanup, with a recoverable mechanism needed for undo. Saved searches are presets, not downloaded collections.

## Settled visual direction

### Overall

Highly minimal, rounded, quiet and media-focused. Avoid decorative or gradient-heavy UI, redundant headings and explanatory filler. Gallery background is near-black. The exact palette, typography and scale are **not yet selected**.

The owner approved several specific refinements; these are constraints for the new visual system, not approval of the whole demo:

| Area | Approved direction |
|---|---|
| Viewer backdrop | Low-resolution version of the current image, blurred and dimmed; sharp foreground. This replaces the earlier pure-black viewer requirement. Exact blur/dimming remains open. |
| Viewer layering | At initial fit, right info panel reduces image area. Zoomed image can extend **behind** it. Every UI element stays above the image and interactive. |
| Thumbnail corners | Squircle-style rounding, Firefox-compatible, consistent across aspect ratios. Exact radii/smoothing not selected. |
| Ordinary thumbnails | Borderless; no titles, descriptions or captions. No image-brightness hover effect. |
| Favorite outline | Persistent red inset outline following exactly the thumbnail geometry; no hover change, no pale corner fringes, no tile-size change. Suppress in Favorites-scoped galleries. |
| Thumbnail actions | Hover/focus: top-right **book-image then heart**, left-to-right. Heart filled red when favorited. Bottom-left icon only for video/animated media. Thumbnails remain static on hover. |
| Gallery geometry | Justified rows, small thumbnails with adjustable size; slight cropping allowed for full rows, last row allowed to stop before right edge. Stable layout, no flashing/reflow loops. |
| Search composition | Save button left; expanding field containing rating/sort/media icons at its right; Search outside right; Gallery options far right behind vertical separator. |
| Search surfaces | Opaque controls and opaque floating backing. No translucency/blur in the gallery search row. Floating backing fades in smoothly without shifting controls. |
| Pending search | Highlight the **button itself**, without changing font weight, dimensions or layout. Saved-search button has a separate blue saved state. Exact pending color open. |
| Popovers | Filter popovers left-align with their button, clamp viewport, subtle entrance; **not centered on cursor or button**. Re-click opener closes, another opener replaces. |
| Settings navigation | Compact sticky internal side navigation; a single highlight moves smoothly to target, no left-border stripe or intermediate item stepping. Settings title in fixed search/header area. |
| Cover fans | Four total images: one primary plus three supporting, mostly behind primary, small evenly stepped rotations/offsets. Subtle expansion on hover. Mockups did not establish correct geometry. |
| Removal feedback | Efficient downward fade with gentle tilt/slight shrink; next enters from right, previous from left if last. Transform/opacity only, respectful of reduced motion. Current 480 ms demo timing is provisional. |

## Core composition and behavior not to redesign accidentally

### Gallery and navigation

Persistent gallery sidebar, horizontally resizable. Top-to-bottom:

```text
Logo and name
New search
[Exploration views]
[Temporary unpinned albums — dashed border]
[Pinned albums — solid border]
Albums
Favorites
Saved searches
Settings
[Task progress — when active]
```

Use separators/spacing according to the UI record. **No EXPLORATION heading and no visible T hint beside New search.** Album section independently scrolls and resizes vertically. Bottom destinations stay anchored.

Ordinary albums/Favorites/Saved searches/Settings navigation does not create exploration-list rows. Open unpinned albums appear at the top of the album group with a dashed border. Pinning makes it solid. Active navigation, open/pinned state, selection badges and temporary viewer-created marks are **different semantic states** and must remain distinguishable.

View titles use one first-tag-category font color throughout, including custom titles. Actual tags/autocomplete use each tag's category color. Single-line titles truncate with full-name tooltips. Exact icon artwork and category shades remain open.

Exploration pages have no content heading/subheading. Album contents and Favorites have one heading and no generic subtitle. Settings has its fixed header title.

Search is staged until Search/Enter; new blank views immediately load default all-post results. Search row hides on scroll down, returns on scroll up, overlays without moving tiles, and reserves no vertical space while hidden. Focus/autocomplete keeps it visible.

### Viewer

Viewer replaces the gallery. Hidden left navigation reveals at the left edge or B; it overlays without resizing the image. Switching from that sidebar into another viewer context **must keep it revealed**. Actual outside click/dismissal or genuine pointer/focus departure may close it.

Top-right icons in order: **book-image, heart, download, Gelbooru page, fullscreen, details/tags toggle**. No plus for the album action. Edge next/previous are translucent black circles with white icons, only near the relevant edge and not over other UI. Viewer surfaces have backdrop blur; this does not apply to the opaque gallery search row.

Right stack: separate icon bar, then details, then tags; details and tags share one scroll region. When right panel is open, the icon bar remains visible. Right-panel width and open state persist per view. New views start closed.

Tag groups: **artist/red → character/green → copyright/light pink → metadata/yellow → general/blue → deprecated/gray**. Bold labels, alphabetic within groups, empty groups hidden, names wrap, muted counts right. Do not turn category colors into decorative shell colors.

No trackpad next/previous navigation. Preserve pinch/modified-scroll zoom and two-finger panning while zoomed. Zoom resets when changing image/view. The resolution threshold defaults are 1920 px width **OR** 1080 px height; see the decision record for exact fit/native/double-click behavior.

### Selection and collection feedback

Selections persist per context across navigation; indicate selection mode/count in sidebar. Plain click toggles; Shift selects/deselects ranges with clicked endpoint staying selected during deselection. No drag-to-select. Dragging images adds to sidebar albums/Favorites without switching destinations.

Sticky selection bar replaces search, exit at left. Whole-query Select All includes unloaded results and supports exclusions. Do not introduce a remote deletion action.

Ctrl/Cmd+Backspace removes selected collection images in gallery, or displayed collection image in viewer. Ctrl/Cmd+Z restores the last removed membership **without navigating to the restored image**, with a small rising/fading preview. Production recovery/window is open; do not invent a finalized trash duration.

Successful ordinary membership changes do not show success toasts. Background-view creation does: green, single line, immediately left of source tag, animating outward, **Opened in background + Open**. Viewer-created sidebar marks appear only in that viewer session and clear on exit; never show in gallery.

### Playback, sounds and Settings

- Custom video playback bar; first-open autoplay/loop, remembered volume/mute. Revisits within session restore position but stay paused; positions clear on reload.
- **Volume/mute are controlled only in the player**, persisted across reloads. No video-volume setting.
- **Interface sounds are mandatory to implement**, with a setting allowing users to disable them. Keep separate from player volume. One restrained sound per completed action, including bulk actions. Assets, Apple-device policy and default enablement remain open; do not assume Apple sound redistribution rights.
- Settings preferences autosave. Credentials are an exception: explicit **Validate**; success auto-saves; failure preserves previous set. Stored key never returns to client. No Remove credentials UI.

## The actual visual-design work remaining

Create a new editable **Panbooru-Design-Specification.md** alongside these files. It should translate the approved direction into concrete, reusable design decisions. Do not assign exact numbers as approved before the owner selects them.

| Workstream | Decisions/deliverables needed |
|---|---|
| Foundations | Typography family/weights/sizes/line heights; spacing scale; density; neutral surfaces; semantic/category palette; contrast targets; borders; shadow/elevation; icon style. |
| Geometry | Shared corner system including squircle recipe, inset outline alignment, control/dialog radii, hit targets, row heights, sidebar and panel bounds. |
| Gallery shell | Exact sidebar rhythm, row states, separators, logo placeholder/name, search/control grouping and floating state, thumbnail gaps and selection styling. |
| Viewer | Backdrop treatment, glass-surface darkness/blur, control sizes/offsets, reveal zones, details/tag rhythm, panel layout, video bar, loading/error states. |
| Collections | Album/saved-search card grid, four-image fan geometry, headings/counts, empty covers, cover editor, pin/temporary/active state, selection. |
| Components | Buttons, icon buttons, inputs, autocomplete, checkbox states, popovers, menus, dialogs, tooltips, splitter affordances, progress/task details and notifications. |
| Motion | Duration/easing families, fade/reveal, moving Settings indicator, fan hover, popover entrance, removal/restoration, reduced-motion alternatives. |
| Accessibility | Focus styling, contrast, keyboard equivalent interactions, meaningful non-color cues, resizing/reordering and dialog focus. |
| States and handoff | Default/hover/focus/active/disabled/pending/error/selected states, component anatomy, token names, layout rules and acceptance examples. |

**Recommended process, not yet a finalized design:**

1. Read the source files and produce a short visual brief separating fixed constraints, candidate directions and genuine questions.
2. Start with foundations and one representative **gallery shell**. Compare a small number of deliberate alternatives, preferably in directly viewable HTML/CSS if helpful. Do not ship a giant unexplained token table or fifteen near-identical boards.
3. Select typography, density, surface hierarchy and corners with the owner, then document selected values. Mark alternatives and unapproved values explicitly.
4. Apply that language to viewer, collection grids, popovers/dialogs and Settings. Use representative states rather than just attractive default screens.
5. Validate Firefox squircle outlines, overlay/search geometry, content contrast, focus, reduced motion and scaling. Do not declare a browser pass without actually observing it.
6. Keep UI behavior decisions in the existing UI record. Put precise visual tokens/component rules in the new design specification and cross-link them. Update only affected files/bundles after approval.

Avoid revisiting settled actions just to make a proposed layout easier. If a visual treatment truly requires changing behavior, identify the conflict and let the owner decide.

## Prototype and evidence limits

The current demo has 60 sample posts using bundled generated landscape SVGs. It stores browser-local state, simulates tasks locally and has no real API, login, database, server downloads, sound assets or production video implementation. Production tasks run on the server. Some restore/selection/shortcut/drag/accessibility paths remain simplified.

**Known unresolved bug:** sidebar may still close immediately when switching from its revealed viewer state into another viewer context. Two attempted repairs did not satisfy user review. Do not claim this was fixed or adopt that behavior as intentional.

Syntax and selected pure-logic checks passed for recent edits. There has been **no agent browser visual QA**: the computer-use tool rejected the local file URL. No alternate path was used to bypass that restriction. User supplied the visual feedback. If the next environment blocks a preview, report it honestly and respect the restriction.

The historical Milestone 0 handoff reports browser-authenticated API CORS failure and controlled-test successes, not verified production server integration. Preserve its factual citations; no need to reopen that architecture during visual refinement.

## Maintenance conventions for the next chat

- Preserve canonical filenames and authority labels. Latest owner corrections win.
- Keep **Fixed**, **Proposed/recommended**, **Deferred** and **Open** separate. Demo constants and incomplete implementation are not proof of an approved choice.
- Remove superseded requirements rather than accumulating contradictory amendments. The current specifications were reconciled on 18 October; do not recover older extracted copies over them.
- Favor concise, focused review questions. Make visual options concrete before asking the owner to choose.
- Do not create another chat, publish a site, implement the production application or design a final logo unless requested. Local design studies are appropriate when authorized by the owner.
- No need to implement interface sounds or production recovery just to refine their visual controls.

## Copyable starting prompt

> Continue Panbooru visual design from the attached/readable **Panbooru-Design-Handoff.md**. Read the current UI decision record, focused fan spec and product specification it links to. The interaction design is largely settled; the next goal is a coherent, minimal, rounded visual language and a precise editable **Panbooru-Design-Specification.md**, developed with me. The existing HTML prototype is an interaction test, **not a general visual reference**. Preserve explicitly accepted visual constraints, but do not inherit its arbitrary styling. Start with a concise visual brief and a small, concrete gallery-shell/foundations exploration. Distinguish proposals from approved tokens, and carry selected choices into component/state specifications. Do not implement the production app or reopen settled interactions.
