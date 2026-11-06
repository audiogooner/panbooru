# Panbooru — local UI prototype

Open **index.html** in a desktop browser. Keep the adjacent `style.css`, `app.js`, `sample-downloads.js` and `assets` directory together. No installation, server or credentials required. The ZIP contains the complete folder.

This is a local interaction test, not a general visual reference or production implementation. Only explicit written decisions are authoritative. All artwork is bundled sample SVG illustration; all state is stored locally in the browser under `panbooru-ui-v1`. Nothing connects to Gelbooru or uploads data. Settings includes **Reset sample data**.

## Try it

- Search `landscape`, `forest`, `water` or `mori`. Search changes stage until Search/Enter. Suggestions insert with Tab/Enter; filters are popovers.
- Hover thumbnails for album/favorite actions. Favorite borders stay red. Album picker supports multiple memberships and inline creation.
- Shift-click to enter multi-select; ordinary or Cmd/Ctrl-click toggles items; Shift-click selects/deselects ranges. Selections persist per context. Drag selected images onto sidebar albums or Favorites.
- Resize the left sidebar and its album section. Open Albums to see compact four-image fans. Secondary-click an album for its menu, including Edit cover. Drag supporting images to reorder; drop one onto the primary to swap.
- Click a thumbnail to enter the image-derived blurred/dimmed viewer. Use Left/Right or A/D to navigate, double-click to zoom/reset, drag to pan, or Ctrl/Cmd-scroll to zoom. `I` opens details/tags; resize the panel. `B` reveals the left sidebar; `F` requests fullscreen.
- Viewer icon order: album picker, favorite, download, external source, fullscreen, details/tags. Download exports the sample SVG; external-source actions explain that sample art has no real booru page.
- Tag click replaces and searches; Shift-click appends; Cmd/Ctrl/middle-click creates a background view. Middle-click a sidebar view closes it. `T`, `Shift+T`, `Shift+W` create/reopen/close contexts.
- Save an applied query with the bookmark button. Open Saved searches, edit a cover or create an album from a saved search to see a **local simulation** of the task-progress UI.

## Provisional values and deliberate scope limits

The decision record remains authoritative. Exact colors, dimensions, row heights, blur, timing, preload default and fan transforms are provisional for review.

- No real API, authentication, server SQLite/filesystem, downloads queue, ZIP assembly or color-analysis pipeline. Task progress is a browser-local simulation and does not survive closure; production tasks must run on the server as specified.
- Sample data contains images only. Video/animation playback and platform trackpad gestures are not production-verified. Trackpad next/previous navigation is disabled. Two-finger scrolling pans zoomed images; pinch or Ctrl/Cmd-scroll changes zoom.
- The cover editor's Auto-select uses a sample subset, not border-color analysis. Candidate selection replaces the last support slot when full. Independent cover caching/cleanup is not implemented.
- Batch loading, query-wide selection and restoration operate over a fixed 60-post sample dataset. No remote query snapshot/exhaustion guarantees, network-error injection, retries or unloaded server enumeration.
- Browser-history handling and gallery scroll restoration are simplified; resize preserves the current browser scroll position rather than implementing the final item/offset anchor algorithm.
- Drag-out delayed unpinning, all keyboard-accessible reorder/resize paths, task error states and complete shortcut customization are not finished. The shortcut editor covers a representative subset; additional approved shortcuts still use their specified defaults. Per-action Reset UI remains to be added.
- No credential input is provided. The Settings connection section only describes the selected Validate-before-save flow.
- Viewer removal from albums/Favorites supports Ctrl/Cmd+Backspace and session-only Ctrl/Cmd+Z restoration without navigating. Removal uses a downward fade/tilt; undo shows a small rising preview. No production recovery/retention policy is implemented.
- Known bug: switching through the revealed sidebar to another viewer may dismiss the sidebar immediately; the specification requires it to remain open.
- Interface sounds are required for production but not implemented in this demo.
- Some context-specific controls, browser reserved-key handling, touch behavior and focus details require refinement. This is desktop-first.

## Verification

JavaScript syntax, pure sample-data filtering/sorting/exclusion, source-label behavior, new-view defaults, unique HTML IDs, icon references and all 30 asset files were checked. Browser visual/interaction QA was not completed: the computer-use tool rejected the `file:` URL under its URL policy. No alternate browser path was used to bypass that restriction.

## Files

- `index.html` — shell and inline icon definitions
- `style.css` — provisional visual treatment
- `app.js` — sample-data interactions and browser-local state
- `sample-downloads.js` — embedded sample artwork for local file downloads
- `assets/scene-*.svg` — original code-generated sample landscape illustrations
