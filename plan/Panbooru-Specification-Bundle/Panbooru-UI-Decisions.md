# Panbooru — UI decision record

Updated 18 October 2026; consolidated after prototype review, after the user confirmed satisfaction with the prototype functionality. This is the current UI behavior baseline, incorporating the complete decision discussion and subsequent prototype refinements through approved squircle thumbnails, embedded search filters and the button-aligned animated popovers and current removal/undo behavior. It records agreed behavior, not a production-completion or exhaustive verification claim. Latest explicit user decisions take precedence. Remaining unanswered details and recommendations are separated at the end.

**Authority:** use this record for current UI behavior. **The prototype is not a visual reference**: it tested interactions; only explicit written decisions, including the newly approved image-background direction, carry authority. It supersedes conflicting UI recommendations in the older product/technical specification. Explicitly requested and accepted prototype refinements are recorded here as decisions. Unspecified demo constants, sample-data limitations and generated cover mockup inaccuracies do not become requirements merely because they appear in the prototype. The companion [album fan specification](Panbooru-Album-Fan-Specification.md) provides a focused extract; this record is authoritative if they diverge.

**Contents**

1. [Identity and overall direction](#1-identity-and-overall-direction)
2. [Gallery search row](#2-gallery-search-row)
3. [Thumbnail layout and appearance](#3-thumbnail-layout-and-appearance)
4. [Multi-selection](#4-multi-selection)
5. [Thumbnail actions and opening media](#5-thumbnail-actions-and-opening-media)
6. [Album picker](#6-album-picker)
7. [Sidebar structure and resizing](#7-sidebar-structure-and-resizing)
8. [Sidebar destinations and active state](#8-sidebar-destinations-and-active-state)
9. [Album grid and pinning](#9-album-grid-and-pinning)
10. [Saved searches](#10-saved-searches)
11. [Dragging media onto destinations](#11-dragging-media-onto-destinations)
12. [Shared custom context menus](#12-shared-custom-context-menus)
13. [Background-task visibility](#13-background-task-visibility)
14. [Settings](#14-settings)
15. [View closing and return history](#15-view-closing-and-return-history)
16. [Exploration, tag interactions and restoration](#16-exploration-tag-interactions-and-restoration)
17. [Viewer](#17-viewer)
18. [Retention and membership](#18-retention-and-membership)
19. [Prototype refinement summary — accepted behavior](#19-prototype-refinement-summary--accepted-behavior)
20. [Remaining decisions](#20-remaining-decisions)
21. [Recommendations still awaiting selection](#21-recommendations-still-awaiting-selection)
22. [Coverage and next review](#22-coverage-and-next-review)
23. [Approved thumbnail corners and favorite outlines](#23-approved-thumbnail-corners-and-favorite-outlines)
24. [Approved filters inside search](#24-approved-filters-inside-search)
25. [Final search-row and popover refinements](#25-final-search-row-and-popover-refinements)
26. [Collection removal, undo and automatic viewer transitions](#26-collection-removal-undo-and-automatic-viewer-transitions)

## 1. Identity and overall direction

- Product name: **Panbooru**.
- Panbooru **will have a logo**. Its design is undecided; reserve a logo position without defining artwork.
- Highly minimal interface with a more rounded aesthetic.
- **All icon-only buttons have tooltips showing the action name and keyboard shortcut when one exists**, e.g. **Fullscreen  F**. Actions without shortcuts show their name only. Keyboard shortcuts are rendered as simplified key visualizations.
- **Inline renaming saves on Enter or clicking away**, and **Escape cancels**.
- **Reject empty or whitespace-only names** during renaming, keep the previous name and show a **small inline validation message**.
- **Duplicate album names are allowed**; albums retain independent identities.
- Gallery background is near-black. The viewer uses a **low-resolution, blurred, dimmed version of the current image as its background**.
- Desktop-first; Firefox is the primary browser.

## 2. Gallery search row

- Search sits above the thumbnail gallery, in the main area to the right of the sidebar.
- The row spans the available main-content width. The search field expands into space left by the Search button.
- **Rating, sorting and media-type filters sit inside the search field at its right edge**, as compact icon buttons sharing the input's outer background and outline. The query input expands into the remaining space. **Search stays outside on the right**, with save-search on the left. Gallery options sit at the top-right, separated from the search controls by a vertical line.
- Each filter button opens a selection popover. **Left-align search-filter popovers with their activating button**, for both pointer and keyboard activation, clamping to the viewport edges. Add a **subtle fade-and-scale entrance animation**, originating at the button-aligned anchor, and respect reduced-motion preferences. Exact timing remains provisional.
- Filter popovers **stay open while selecting options** and close on **outside click or Escape**. Selecting options stages filter changes; it does not bypass Search-to-update.
- Filters are **rating**, **sorting** and **media type**.
- Rating and media type allow multiple selections. Sorting allows one selection.
- **Deselecting the last selected rating or media-type option counts as selecting all options** in that filter, rather than blocking deselection or producing a no-results filter.
- Sorting options are **Newest, Oldest, Highest score and Random**, defaulting to **Newest**. **Random is available in remote exploration, albums and Favorites**.
- In Random mode, **preserve the accumulated result sequence while scrolling and navigating**, and start a **fresh random sequence when Search is submitted**.
- Remote random order cannot be guaranteed stable. **Filter out incoming posts already shown in that view's current result sequence**, using source/post identity, so later batches do not repeat them. This filters new results; it must not prevent deliberate previous/next navigation back to an existing image.
- Reset the per-view duplicate set for a newly submitted random search. This provides nonrepeating displayed results, **not a mathematical guarantee of uniform randomness or complete enumeration** of a changing remote dataset. Exact exhaustion detection remains unspecified.
- **Verified documentation, 17 October 2026:** Gelbooru's [API documentation](https://gelbooru.com/index.php?id=18780&page=wiki&s=view) states that website search metatags work in the API; its [search cheatsheet](https://gelbooru.com/index.php?id=26263&page=wiki&s=view) documents `sort:random` and optional `sort:random:SEED` (0–10000). Thus random API sorting is documented, though no live authenticated test was performed here. Seeded order can change when the upstream database changes; it is not a durable snapshot.
- Media-type options are **Images, Animated images and Videos**, with **all selected by default**.
- Rating options are **General, Sensitive, Questionable and Explicit**, with **all selected by default**. Exact mapping to source-supported ratings must be verified during implementation.
- Filter icons change to reflect selected options. The accepted proposed multiple-selection treatment is a combined icon with a count badge and a tooltip listing selected values. Exact artwork remains undecided.
- Changes to query or filters **do not update results immediately**. Search or Enter submits the pending state.
- Submitting a **different search immediately returns the gallery to the top and replaces the previous results with loading placeholders** while the new results load. This differs from incremental batch-load failures, which preserve existing results.
- A successful search with no matches shows a quiet **No results** message. Keep the query and filters available to edit; do not automatically alter the query.
- Name/keyword filtering on the **Albums and Saved searches grids** also shows **No results** when nothing matches. Preserve the filter so it can be edited or cleared; this differs from having no albums or saved searches at all.
- If the **initial search fails**, show a **compact error message with Retry** in the gallery. Preserve the query and filters; do not present the failure as No results.
- The **Search button itself receives a filled-background highlight** whenever query/filters differ from the applied search.
- Highlighting **does not change the Search button's font weight or dimensions**. Keep typography, padding and border widths constant so the pending state causes no layout shift.
- The highlight clears when the search starts or when changes are reverted to the applied state. It must not remain until results finish loading.
- The demo's purple highlight is provisional, not a finalized product color.
- The whole search row hides on downward scrolling and returns on upward scrolling. **While hidden, it reserves no vertical space: the gallery fills the available height up to the top of the main area.** When revealed again it overlays the gallery rather than shrinking or shifting it.
- When the search row reappears on upward scroll, it **overlays the thumbnails without shifting the gallery layout**. Keep the top-of-page search row compact and without an outer background. When it **floats over thumbnails, enclose all controls in one tightly fitted rounded container** rather than disconnected surfaces or a full-width rectangular strip. **The search bar and its controls are opaque, with no backdrop blur or transparency**. Keep button/input borders, and use a slightly lighter opaque backing behind the controls. **Preserve control positions, spacing, padding and dimensions between states**. Saving/unsaving the search must not remove the backing while scrolled. Retain **blue for the saved-search button** and the **distinct pending Search highlight**, with stable font weight and dimensions. Exact opaque colors remain provisional. The **overlay backing fades in/out smoothly when entering/leaving the scrolled state**, instead of appearing abruptly. Only the transition fades; the resting surface is opaque. Do not shift or resize controls. Respect reduced motion; exact duration remains provisional.
- **Keep the search row visible while the search input is focused or autocomplete is open**, overriding scroll-down hiding.

### Search autocomplete keyboard behavior

- **Up/Down** selects an autocomplete suggestion.
- With a suggestion selected, **Tab or Enter inserts it with a trailing space** rather than submitting the search.
- With autocomplete suggestions showing but **no item selected, Tab inserts the first suggestion**, also with a trailing space.
- **Enter submits the query when autocomplete is not showing or when no autocomplete item is selected**.
- Inserting a suggestion edits the query; it does not itself submit. The existing Search-to-update and pending-button-highlight rules apply.
- The autocomplete dropdown **initially has no suggestion selected**, so Enter submits the typed query unless the owner first selects a suggestion.
- **Clicking an autocomplete suggestion inserts it with a trailing space without starting a search**, matching keyboard suggestion insertion. This differs from clicking a tag in the viewer, which immediately searches.
- **Escape closes autocomplete and preserves the typed query**. Clicking outside also closes it without discarding the query.
- Autocomplete suggestions show **category-colored tag names on the left** and **smaller, muted post counts on the right**, matching viewer tag styling.
- Completion **replaces the tag token at the caret**, preserving other query tags and any **`-` exclusion prefix**. For example, completing `-blue_h` inserts `-blue_hair `, including the trailing space.
- Tab does nothing when no autocomplete results are available

## 3. Thumbnail layout and appearance

- **Exploration galleries have no page heading or subheading**. **Album-content and Favorites galleries have one heading** (album name or Favorites), with **no subtitle or generic description** such as Your collection.

- Flickr-style **justified rows**, based on source aspect ratios. **Allow a small amount of thumbnail cropping to keep completed rows filled to the right edge**. The **last row may remain unfilled and left-aligned**; do not stretch or crop its thumbnails merely to reach the right edge. Avoid excessive cropping; the exact crop tolerance remains to be tuned.
- Results use **infinite scrolling**, loading more as the owner approaches the bottom. Preserve the gallery position when returning from the viewer.
- **Preload multiple result batches ahead** to support fast gallery scrolling. Exact lookahead count and resource budgets remain unspecified; result-batch preloading does not imply downloading every full-resolution original.
- If loading another batch fails, **keep existing results visible** and show a **compact Retry action at the bottom** of the gallery. Retrying continues loading rather than clearing the current results.
- Prefer **smaller thumbnails for scanning more results**, with a size adjustment available.
- The adjustment changes target row height using a **compact slider in a gallery-options popover**, separate from search filters. Changes **update the layout immediately without rerunning the search**. Exact slider range remains undecided.
- Open Gallery options from a **sliders-icon button at the top-right of the search row**, with a **vertical separator between it and the search controls**. It remains separate from the filters embedded inside the search field. This replaces the rejected floating bottom-right placement.
- The chosen thumbnail size is **shared across galleries** (exploration, albums and Favorites) and **remembered across browser reloads**. Cross-device preference sharing remains unspecified.
- Adjusting thumbnail size **preserves the current gallery scroll anchor**, keeping the owner at the same place while justified rows reflow.
- Grid thumbnails use **squircle-style corner rounding**, with consistent corner geometry across aspect ratios and a Firefox-compatible implementation. Exact production radii remain to be selected; the direction is approved.
- No visible titles, descriptions, captions or other thumbnail text.
- Videos and animated images have a small identifying icon at the **bottom-left**. Ordinary still images have no media-type icon.
- Thumbnails remain **static on hover**, including video and animated-image thumbnails. Hover does not start playback.
- If a thumbnail fails to load, **automatically retry once after 1 second**. If that retry also fails, show a **retry icon on that particular thumbnail**, leaving the rest of the gallery usable.
- **Ordinary grid images have no border**. Favorite indicators remain a separately specified exception; do not add default outlines around every thumbnail.
- Favorited images have a persistent **red border**. The border does not change thumbnail dimensions. **Suppress this border in Favorites galleries**, including separate Favorites-scoped search views, because every displayed item is favorited. Heart state remains filled red.

## 4. Multi-selection

- **Shift-clicking an image or album enters multi-select mode**. The visual selection indicator remains open.
- Use familiar file-selection gestures, with the explicit rules below taking precedence over any Finder analogy.
- **Clearly indicate multi-select mode on the corresponding left-sidebar entry**, including inactive views and collection destinations. Use a visible check/count badge (or All for whole-query selection) distinct from the active-page highlight, so a selection remains apparent after navigating away.
- In multi-select mode, **Shift-click selects or deselects a contiguous range** according to the clicked endpoint's prior state: unselected selects the range; selected deselects the other range items **but keeps the clicked endpoint selected**. **Cmd/Ctrl-click toggles an individual item** without clearing the other selected items, following Finder-style modifier behavior.
- In multi-select mode, **ordinary click adds an unselected item or deselects a selected item**, preserving all other selected items. Cmd/Ctrl-click also toggles individual items. **Shift-click takes precedence and toggles the whole contiguous range uniformly**: an unselected endpoint selects the range; a selected endpoint deselects the other range items **while remaining selected itself**. The clicked endpoint becomes the range anchor for subsequent actions. Other items outside that range are unchanged.
- Provide **Deselect all in the sticky selection bar**. It clears selected items, whole-query selection/exclusions and the range anchor, but **keeps multi-select mode open**. Exit or Escape still clears selection and leaves the mode.
- **Confirmed default:** **Ctrl/Cmd+Shift+A deselects all**, clearing whole-query selection/exclusions and the range anchor while **keeping multi-select mode open**. Suppress it during text entry; the binding is customizable in Settings.
- **Ctrl/Cmd+Backspace removes selected images from the current album or Favorites gallery; in its viewer it removes only the displayed image**, inactive during text entry and customizable in Settings. See section 26 for automatic advance, animation and undo. **Remote exploration has no delete action at all**, including toolbar, menus and keyboard shortcuts. Collection removal follows the established last-membership retention-cleanup rule; it never deletes upstream posts.
- **Escape clears selection and exits multi-select mode**.
- **Navigation preserves multi-selection separately for each view/context**. Switching away and back restores selected items, whole-query selection/exclusions and multi-select mode, rather than clearing them. Image and album selections remain separate; images and albums cannot be selected together. A new context starts without a selection.
- **Successful bulk actions preserve selection and keep multi-select mode active**, allowing another action on the same items. **Deleted items are removed from the selection**; do not retain references to deleted items. **If deletion leaves nothing selected, exit multi-select mode automatically and restore the normal search bar.**
- Removing selected images from the **current album or Favorites immediately removes them from that gallery and its selection**, even if they remain saved in another collection. If no selected items remain, exit multi-select mode and restore search. Failed membership changes still follow the existing rollback/error rules.
- **Do not support drag-to-select**, including marquee/range dragging.
- Dragging images remains available for **adding to albums or Favorites**, as specified in the destination-drop rules; dragging does not create a selection. Existing sidebar reordering and album pinning gestures remain unchanged.
- **Dragging a selected image carries all selected images together**. Dropping onto an album adds every selected image to it; dropping onto Favorites favorites every selected image. The current destination remains unchanged, following existing drop behavior.
- Multi-select mode shows a **compact, sticky action bar at the top, replacing the search bar**. It stays available while scrolling rather than following search-row scroll hiding.
- Put an **exit button at the left** of the selection bar. It exits multi-select mode and clears selection, matching Escape.
- For images, the bar shows the **selection count** and **album, favorite, download and context-specific removal actions**. Use `book-image` for the album action. Album selections instead use the album bulk actions below.
- The **bulk favorite action favorites all selected images unless every selected image is already favorited**. If all are favorited, it unfavorites them all. Mixed membership therefore becomes fully favorited rather than toggling each image independently.
- **Bulk image download delivers the selected original files as one ZIP archive**, rather than separate browser downloads. Single-image download remains an immediate original-file download.
- For **album multi-selection**, offer **Pin/Unpin and Delete** bulk actions. Deleting selected albums uses **one confirmation dialog for the selection**, following the simple album-deletion style without retention-cleanup explanations. **Bulk Pin pins all selected albums unless all are already pinned**, in which case it **unpins them all**. Mixed pin states become fully pinned rather than toggling each album independently.

### Select All and unloaded query results

- **Cmd/Ctrl+A selects the entire current query and automatically enters multi-select mode**, even when selection mode was not already active, provided no text input is focused. The **Select All checkbox in the sticky top bar** selects the same whole-query scope, including unloaded results.
- All loaded matching images show selected immediately. Images loaded subsequently also appear selected while that whole-query selection remains active.
- Whole-query selection is a query-scoped operation, not a materialized list limited to currently rendered thumbnails. Selection remains owned by its originating view and is restored on return.
- A collection action such as **Add to album** on a whole remote exploration query starts a **background task that fetches metadata for all query results**. Add each post to the target collection as its metadata becomes available, and queue/download its original media to the server.
- **Library-wide deduplication applies to every save path**, not only local album actions: remote exploration saves, Favorites, album additions, bulk/query-wide jobs and imports all reuse existing records/media when exact matches exist. If the **metadata hash matches 1:1 with an existing item**, do not save another metadata item; add/reuse collection references instead. **Saved media is also deduplicated by content**, independently of metadata identity.
- The scope of Cmd/Ctrl+A in the Albums grid remains the current grid's album selection; no remote-query metadata task is involved.
- Deselecting individual images after **Select All creates explicit exclusions**. Whole-query actions apply to every matching result **except those excluded images**, including results not yet loaded.
- Query-wide actions use the shared background-task progress and cancellation rules. Show counts without percentages while totals are unknown, as specified under background tasks. Result-set changes during enumeration, retry checkpoints and whole-query ZIP behavior remain open. No exact point-in-time snapshot guarantee is implied for a changing remote query.

## 5. Thumbnail actions and opening media

- Hover reveals two actions in the **top-right**, ordered left to right: **book-image**, then **heart**.
- The same actions are available on keyboard focus.
- Heart controls favorite membership; the **`book-image` icon** opens the album picker. Use `book-image` for this album action **everywhere**, replacing all earlier plus-icon proposals.
- The **heart is outlined when not favorited and filled red when favorited**, in both thumbnails and the viewer. The gallery's persistent red favorite border remains as specified.
- Outside multi-select mode, clicking the thumbnail outside its action buttons opens the viewer in the **current exploration or collection context**. In multi-select mode, ordinary click retains the separately specified selection behavior.
- Returning from the viewer restores the gallery's scroll position.
- Thumbnail action buttons act on the item without opening its viewer.

## 6. Album picker

- Clicking the **`book-image` album-action button** opens a compact picker beside the button, in both thumbnails and the viewer.
- **Pressing the same album-selector button again closes its open picker**. **Navigating to a different image closes the album selector**, so it cannot remain attached to the previous image.
- **Using or focusing the album-selector button must not disable Left/Right or A/D image navigation**. Those shortcuts still close the picker and navigate; normal text-entry and control-specific key handling remain exceptions. Keyboard S uses the same picker open/close behavior as its button.
- The viewer uses the **same album picker behavior** as thumbnails: immediate membership changes, multiple album selection and inline album creation.
- In the **bulk image album picker**, an album containing **some but not all selected images** shows an **indeterminate checkbox**. Clicking it adds **all selected images** to that album.
- Picker contains a searchable album list with checkboxes, allowing membership in multiple albums, plus **Create album**.
- Checkbox membership changes save immediately.
- Picker stays open while multiple selections are made.
- Clicking outside or pressing Escape closes the picker.
- Create album reveals a name field inside the picker.
- Enter creates the album, adds the current post to it and returns to the list with the new album checked.
- Album creation rejects empty/whitespace-only titles and allows duplicate names. In the picker's inline creation flow, exact validation presentation and cancellation details remain unspecified.

## 7. Sidebar structure and resizing

- Sidebar width is adjustable by dragging its **right edge** and **persists across browser reloads**.
- Resizing the left sidebar **preserves the gallery's current scroll anchor** while the justified layout reflows.
- Sidebar remains visible in gallery mode.
- Layout, from top to bottom:

```text
Logo and name
────────────────
New search
[Exploration views]
────────────────
[Temporary albums — dashed]
[Pinned albums — solid]
Albums
Favorites
Saved searches
Settings
[Task progress — when active]
```

- Do not display an **EXPLORATION** heading above the view list or a visible **T** hint beside New search; the shortcut remains available.
- Bottom destinations remain anchored at the bottom; exploration views scroll when space is insufficient.
- The **temporary/pinned album section scrolls independently and is vertically resizable**, allowing the owner to adjust the space allocated to it. **Albums, Favorites, Saved searches and Settings stay fixed at the bottom** rather than scrolling with album entries. Resize it using a **draggable divider between the album section and exploration-view list**. Its **height persists across browser reloads**. Exact resize bounds remain unspecified.
- Exploration views support drag-and-drop reordering within their list.
- Pinned albums support drag-and-drop reordering within their list.
- Exact resizing limits, keyboard reordering behavior are not yet specified. Cross-device width sharing remains unspecified.

## 8. Sidebar destinations and active state

- **Albums**, **Favorites**, **Saved searches** and **Settings** open in the main-content area to the right of the sidebar, replacing the current content.
- They **do not create entries in the exploration-view list**.
- Their corresponding sidebar item uses the same active highlight as an active exploration view. The previously active destination loses that highlight.
- **Pinned albums also open directly in the main-content area and do not create exploration-view entries.**
- Opening an **unpinned album does not create an exploration-view entry**. Instead, it appears **at the top of the pinned-album list with a dashed border**, indicating that it is open but not pinned.
- Opening an already-open unpinned album activates its existing album entry rather than creating a duplicate.
- **Switching back to an already-open album or Favorites restores its query, filters and scroll position**. An album that was not already open starts at the top, including a pinned album whose open context was closed. Shift-click still creates a separate blank collection search. **Ordinary reopening after explicit closure starts fresh**, without restoring the old query, filters or scroll position. **Shift+T restores the closed state** instead, as specified for supported closed contexts.
- Pinning this temporary album entry changes its **dashed border to a solid border**. Active highlighting remains separate from pinned/open status.
- Pinning through an action/menu moves the temporary album to the **top of the pinned group**, below any remaining temporary albums.
- Dragging a temporary album into the pinned group **pins it at the drop position**, rather than automatically moving it to the top.
- **Unpinning the currently active album keeps it open and active**, moving it to the **top of the temporary album group** with a **dashed border**. It does not switch destinations or create an exploration-view entry.
- Temporary unpinned album entries have a **close button shown on hover or keyboard focus**, like exploration views. Closing removes the temporary sidebar entry; it does not delete the album or its contents.
- Closing an active temporary album entry returns to the **most recently active available view or album in navigation history**, skipping closed entries, with a **new active blank exploration view** when no available destination remains. Closing an inactive temporary album entry leaves the current destination unchanged.
- Temporary unpinned albums appear **above pinned albums**, with the **newest opened temporary album first**. Activating an already-open album does not change its position.
- A selected pinned album receives the normal active highlight.
- **Pinned and temporary album rows show a small cover thumbnail beside the album name**. Keep names on one line, truncate overflow with an **ellipsis**, and show the **full album name in a tooltip**.
- Sidebar album thumbnails show **only the primary cover**; reserve the fan effect for larger grid tiles.
- Album-section borders now indicate pin status: dashed for opened unpinned albums and solid after pinning.

### Favorites contents

- Favorites uses the **same justified thumbnail gallery and thumbnail actions** as exploration results and album contents.
- **Tag search is restricted to favorited items**.
- An empty Favorites collection shows **No favorites yet**. A filtered search with no matches instead uses **No results**.

### Album contents

- Inside an album, use the **same justified thumbnail gallery and thumbnail actions** as exploration results.
- **Tag search is restricted to the current album**, rather than querying all saved items or the remote source.
- An empty album gallery shows **This album is empty**. A filtered search with no matches instead uses **No results**.
- In an album or Favorites viewer, if the current post is **removed from the collection being viewed**, advance to the **next image**. If it was the last, use the **previous image**; if none remain, **return to that collection's gallery**. Unfavoriting while viewing an album does not trigger this unless album membership is also removed. Existing failure rollback rules still apply.

## 9. Album grid and pinning

- The **Albums page uses a grid** of albums.
- When no albums exist, show **No albums yet** and a **Create album** button that opens the title-entry dialog.
- Default album ordering is **most recently updated first**, with additional sorting options for **name** and **creation date**. Exact alternative sort directions and which changes count as updates remain unspecified.
- **Create album on the Albums page opens a dialog with a title input**, rather than adding an editable empty tile. This is separate from inline album creation inside the image album picker.
- That dialog has **Create / Cancel** buttons; **Enter creates** the album and **Escape cancels**.
- **Reject empty or whitespace-only titles when creating an album**. Keep the creation dialog open and show an **inline validation message**; duplicate album names remain allowed.
- After successful creation from this dialog, **stay on the Albums grid** rather than opening the new album.
- The Albums grid has an **album-name search field that filters immediately as the owner types**. This is separate from tag search inside an album and does not require Search/Enter to apply.
- Album covers use a **compact fan with one primary image and three supporting images**. Use the first available image as primary and automatic border-color matching for the supporting images, as specified under Saved searches for both cover types.
- Supporting images sit **mostly behind the primary cover**, with small offsets and **small, regularly stepped rotations**, rather than spreading far to one side. Avoid irregular or scattered angles.
- Hover **slightly explodes the stack**, increasing supporting-image separation/rotation subtly. Exact transforms and animation timing remain unspecified.
- Use **four images total: one primary cover and three supporting fan images**. Generated mockups do not define geometry.
- For albums with **fewer than four images**, use only the **available distinct images**; do not duplicate images to fill the fan. Empty albums use their specified placeholder.
- Removing a chosen cover image from the album **does not automatically replace that cover image**, including in manually configured covers. **Keep the small cover preview stored independently**, so the cover stays intact even if the original is deleted under the collection-retention rule. This does not retain the full original or its saved-library membership.
- **Automatically clean up independent cover previews when no album or saved-search cover references them**. A preview shared by multiple covers remains until the last reference is removed.
- The owner can choose an image belonging to the album as its **primary cover image** and manage which album images appear in the fan.
- **Automatic border-color matching runs by default** as images become available; manual supporting-image selection overrides it. Stop automatic changes once the color-match threshold is reached.
- Cover customization opens in a **small dialog with a live preview** of the fan.
- In the cover editor, the **primary cover is displayed large at the top center** of the panel.
- The **fan images appear below it in a centered, left-to-right row**.
- Fan images are **draggable to reorder within the fan**. Reordering the fan does not automatically change the separately displayed primary cover.
- Dropping a fan image onto the primary cover **swaps the two images**: the dragged image becomes primary, and the previous primary takes the dragged image's exact position in the fan row.
- **Images from the cover candidate/search results can also be dragged onto the primary cover**. If already present in a supporting slot, swap with that slot; otherwise use the candidate as primary. **Highlight the primary cover as a valid drop target** while dragging over it. All such changes remain provisional until Save.
- Dialog changes are provisional until **Save**. **Cancel or Escape** discards the changes.
- The **fan-image selector is searchable by tags**, scoped to images within the album. Exact matching/operator rules and submission behavior remain to be specified.
- The album **title appears below the cover**; the **item count appears below the title**, smaller and visually subtler.
- An **empty album** shows a **quiet rounded placeholder with the `book-image` icon**, its title below, and **Empty** in place of an item count (not “0 items”).
- Until the matching threshold is reached, update automatic supporting-image choices as new posts are added. Manually chosen supporting images are not replaced.
- Each album's menu offers **Pin / Unpin**. Pinned albums appear in the sidebar's pinned-album section.
- Dragging an album from the Albums grid onto the pinned-album section at the bottom of the sidebar also **pins it**.
- Pinned albums can be reordered by dragging within that section.
- Dragging a pinned album outside the sidebar uses a **macOS Dock-style removal interaction**: after a short wait outside the sidebar, a **Remove** label appears.
- Dropping outside after removal is armed **unpins** the album. It does not delete the album or its contents.
- Releasing before the **Remove** label appears cancels removal and keeps the album pinned. Dragging back inside the sidebar also cancels removal.
- The pinned-album list is **reorderable by drag and drop**. Reordering changes its sidebar order without unpinning the album.
- Exact removal delay and outside-distance threshold remain unspecified.

## 10. Saved searches

- Add a **Saved searches** destination **beneath Favorites and above Settings** in the sidebar.
- Provide a **save-current-search button to the left of the search field**. The exploration-view context menu also retains its Save search action.
- If the query consists of **only one artist tag**, label the action **Save artist**. If it consists of **only one character tag**, label it **Save character**. Other queries use **Save search**. Filters/sorting do not themselves turn a single-tag query into a mixed-tag query.
- Save the **query, filters and sorting**, but **not the scroll position**. Saving alone does not download matching originals.
- When there are no saved searches, show **No saved searches yet**, with a **short hint pointing to the save button beside the search field**.
- The Saved searches page supports **keyword search** and **filtering by type** (search, artist, character). **Keyword and type-filter changes update the grid immediately**, without Search/Enter. Exact keyword matching remains unspecified.
- Present saved searches in a **grid similar to Albums**, using the **same fanned-cover visual direction** (one primary plus three supporting images, compact regularly stepped rotations, subtle expansion on hover).
- Saved-search covers are **customizable**, as album covers are. How remote cover candidates are sampled remains to be specified; store the selected small previews independently, under the cover-preview retention rule; a cover must not imply that query originals were saved.
- For albums and saved searches, **automatically selected supporting cover images are recalculated as new posts are added**, using border-color similarity to improve the match. **Manually selected supporting images stay fixed** and are not replaced by automatic updates. Automatic updates concern supporting images, not replacement of the primary cover.
- For **saved searches**, recalculate when the saved search is **opened and new results are fetched**; do not poll in the background just to improve cover matching.
- For automatic album/saved-search fans, **stop automatically updating once a color-match threshold is reached**. The threshold value, scoring method, and any manual restart/reset behavior remain unspecified. Manual supporting-image choices remain protected regardless of score.
- On saving a search, use the **first result as the primary cover** and automatically choose supporting images using the **border-color matching selection introduced for album covers**, rather than simply taking the next results. Use **three supporting images plus one primary, four images total**, as explicitly reconfirmed.
- **Automatically run the cover-selection step when creating an album too**, once images are available. Empty albums retain their placeholder. Exact timing for background-populated albums remains unspecified.
- **Create album from saved search** opens a **title dialog**. After confirmation, create the album and start a **background task to enumerate all posts matching the saved query, filters and sorting**, add them as their metadata loads, and download their originals to the server. Reuse existing saved metadata/media rather than duplicating them. Use the shared task-progress and cancellation behavior. The destination shown after confirmation remains unspecified.
- **Clicking a saved search opens and activates a new exploration view**, using its saved query, filters and sorting. Always create a new view, even if another view of the same saved search is already open; do not reuse it.
- Place each newly opened saved-search view **at the top of the exploration-view list**, matching New search.
- Opened saved-search views use the **normal applied-query-based title**, not the saved search's custom name. Existing single first-tag-derived title coloring and independent manual view-renaming rules apply.
- Saving a search **happens immediately without a name dialog**, automatically using the **query as its name**, including artist/character searches.
- When the open search **matches an existing saved search by query, filters and sorting**, show the **save-search button colored/filled in**. This prevents duplicate saves through that action. Matching is independent of a custom saved-search name.
- Clicking the filled save-search button opens a **confirmation to delete the matching saved search**, rather than creating another copy. **Context-menu Delete uses the same confirmation**, with **Cancel / Delete** actions. Exact confirmation wording remains unspecified.
- **Deleting a saved search leaves its already-open exploration views untouched**. Their queries, filters and navigation remain available; the save button no longer shows a saved match unless another saved search matches.
- Saved-search tiles use the shared **context menu** with **Open, Rename, Edit cover, Change type, Create album and Delete**.
- **Change type** lets the owner classify a saved search as **Search, Artist or Character**, independently of its query. The selected type is persisted, shown on its tile and used by the type filter. Changing type does not alter the query, filters or sorting. The prototype presents the choice in a small **Save/Cancel dialog**; changes commit on Save and Escape cancels, following shared dialog behavior.
- **Rename edits the saved-search name inline beneath its cover**, following the album inline-rename interaction (Enter saves, Escape cancels). Renaming changes its label, not its stored query.
- Saved-search pinning and editing the stored query/filter values after saving remain unspecified. **Saving and matching use the applied query, filters and sorting**, not pending edits. Unsubmitted changes do not alter which saved search the button represents.

## 11. Dragging media onto destinations

- Dragging a thumbnail onto a **pinned album** adds that post to the album.
- **Temporary unpinned album entries also accept dragged thumbnails**. Dropping adds the post to that album without switching views, pinning it, or changing its temporary status.
- Dragging a thumbnail onto **Favorites** favorites the post.
- Dropping onto an album **only adds the post**: it does not open the album, create a view or switch the active destination.
- Dropping onto Favorites likewise leaves the current destination and gallery position unchanged.
- Dragging a selected image carries the complete image selection. Membership updates follow the shared optimistic-update, rollback and partial-failure rules. Exact drop-target visuals and duplicate-membership feedback remain open.

## 12. Shared custom context menus

- The context menu of an **exploration-view sidebar item** includes **Add to album** and a separate **Save search** action. They are distinct actions. **Save search preserves the query and filters as a reusable saved search, without downloading its results**. Its grid, automatic query naming and later inline renaming are specified under Saved searches. Whether the view-menu Add to album uses the whole applied query directly, and whether it considers any active selection exclusions, remains to be specified.

- Introduce a **shared application-wide base style and implementation for custom context menus**. Per-item actions depend on context.
- Context menus normally open below/right of the cursor. **Flip above the cursor when space below is insufficient, and to its left when space to the right is insufficient**. Evaluate each axis independently and keep the menu within the viewport.
- **All popovers and context menus close on outside click or Escape**. When dismissed with Escape, **return keyboard focus to the control/item that opened them**.
- **Every button that opens a popover also closes it when clicked again while its own popover is open**. Clicking a different popover button replaces the current popover with that button's popover. This shared toggle rule includes filters, Gallery options, album selectors and task details; text-input autocomplete is not a button toggle.
- **Dialogs close on Escape or Cancel and ignore outside clicks**, preventing accidental dismissal of edits. Cancel/Escape discards provisional edits as specified for each dialog.
- **Each Escape press affects only the topmost active UI layer**. For example, dismiss an open picker/menu/dialog first, then exit fullscreen on a later press, then leave the viewer on another. Do not cascade a single keypress through several layers. Inline editing and selection consume Escape according to their own dismissal rules when they are the active layer.
- **Album tiles:** hover expands the cover fan slightly and provides other restrained hover feedback; it does not reveal a three-dot action button. Exact additional hover effects remain unspecified.
- **Album tiles open a custom context menu on secondary click**, containing **Open, Rename, Edit cover, Pin/Unpin and Delete**. **Delete is separated at the bottom**.
- **Rename album edits the title inline beneath its cover**; Enter saves and Escape cancels.
- **Images also open this shared custom context menu**, with **Add to album**, **Favorite/Unfavorite** according to current membership, **Download**, **Open booru page in a new browser tab**, and **Remove from album** when applicable. Add to album uses the `book-image` icon. More actions may be added later; final ordering and other icons remain unspecified.
- **Automatic retention cleanup:** a post is saved only while it is favorited or belongs to at least one album. When it has **no album memberships and is not favorited**, automatically remove its retained server media and saved-library metadata; do not leave an inaccessible orphaned library item.
- Deleting an album shows a simple **Delete this album?** confirmation with **Cancel** and **Delete album** buttons. Do not include orphaned-image counts or explanations of server retention cleanup.
- Deleting an album **closes its sidebar entries and all collection-search copies scoped to that album**. If the active destination is closed, return to the **last available destination** using existing close-history rules, or a newly created empty-query search view if none remains (which immediately loads default results). Independent remote exploration views, including saved-search-derived views, remain unaffected.
- Removing an individual image from an album or unfavoriting remains **immediate**, without that album-deletion dialog.
- Apply this rule to **unfavoriting, removing from an album and deleting an album**. Deleting an album removes its memberships and automatically deletes only posts with no remaining collection membership. Posts still favorited or in another album remain saved.
- Cleanup must not disrupt a concurrently added membership or delete a shared file still retained by another saved post. An open search/viewer does not itself count as a collection membership. Album-deletion confirmation is specified above; image-removal undo is specified in section 26. Album-deletion undo remains unspecified.
- Keyboard context-menu activation remains a proposed accessibility refinement; dismissal and focus-return behavior are confirmed above.

## 13. Background-task visibility

- **Background tasks execute on the server, not in the browser**. Reloading or closing the browser does not interrupt running tasks or resume paused tasks. On reconnect, the UI displays the server's current task states and progress.
- Show a **progress bar at the bottom of the sidebar** for background-task activity, rather than the proposed activity button.
- **Clicking the progress bar reveals details about all running tasks**.
- Task details appear in a **popover above the progress bar**, with **per-task progress** and **Cancel/Retry actions** as appropriate to each task's state.
- Each collection-import task shows its **destination album/Favorites and the number of posts whose metadata has loaded and been added**. **Do not show media-download counts/states or provide a media-download-state filter** in this task UI. This supersedes the earlier media-download progress proposal.
- Collection items appear once their **metadata is loaded**, regardless of whether original-media downloading has finished. Downloads still run on the server under the existing retention rules.
- Collection-import completion is based on **metadata collection/additions**, not original-media download completion; do not add a separate Downloading media phase to this UI.
- When the metadata total is unknown, show **counts without a percentage** and use an **indeterminate progress bar** until a meaningful total is available.
- Background collection-import tasks also offer **Pause/Resume**. Pausing **stops new collection additions** while **original-media downloads for already-added posts continue**. Resume continues the paused import rather than starting a duplicate task.
- The task popover also offers **Pause all / Resume all for collection-import tasks**, alongside per-task controls. These controls do not pause original-media downloads for posts already added.
- **Cancelling a background import/collection-add task preserves everything already added** and stops the remaining work; it does not roll back completed additions. **Original-media downloads continue for posts already added to an album or Favorites**, even after the query-import task is cancelled. Cancellation stops further query additions, not the retention downloads for completed additions.
- A finished task briefly shows **Completed**, then automatically leaves the popover. **Failed tasks remain until retried or dismissed**.
- Task completion **temporarily turns the sidebar progress bar green**. Exact green-indication duration and its transition back to ongoing progress remain unspecified; the red-priority rule below still applies.
- A failed task **turns the progress bar red**, and it remains **clickable for details even while other tasks continue**. **Red takes priority over green** until failures are retried or dismissed.
- **Hide the progress bar when there are no tasks or failures**, after any temporary completion indication.
- Exact aggregation for multiple tasks and remaining task-detail content remain unspecified.

## 14. Settings

- Settings is one page with sections for **Appearance, Gallery, Viewer, Playback, Downloads, Keyboard shortcuts and Gelbooru connection**.
- The **Keyboard shortcuts** section lists the agreed bindings and lets the owner **customize them**. Previously selected bindings are defaults, not immutable assignments.
- **View-switching shortcuts are unassigned by default**. Do not use Ctrl+Tab / Ctrl+Shift+Tab, preserving browser-tab navigation.
- **Click a binding to capture a new key combination**. **Flag conflicting bindings** and offer **Reset to default for each action**. **Block conflicting assignments until resolved**; do not silently replace another action's binding. **Escape cancels key capture**, preserving the previous binding. A small **Clear** action leaves the shortcut **unassigned**. Conflict scope across contexts remains unspecified.
- Use a **single scrolling Settings page with its own compact sticky side navigation** beside the settings content, separate from the main application sidebar. Section links jump to their sections and highlight the current section. The active item has **no left-border accent**. Use **one background highlight that slides smoothly to the destination item**, rather than lighting intervening items step by step during a section jump. Respect reduced motion.
- Put the **Settings title in the fixed header area where the search row normally sits**, so its section navigation starts directly below that header without a title-induced upward shift.
- **Exploration galleries have no page heading or subheading**. **Album-content and Favorites galleries have one heading** (album name or Favorites), with **no subtitle or generic description** such as Your collection.
- **Settings preferences save automatically** rather than requiring a page-wide Save action. Credential replacement is the explicit Validate-before-save exception below; dialog edits keep their own Save/Cancel behavior.
- **Implementing interface sounds is a fixed requirement, not an optional or deferred feature.** Provide an **Interface sounds** setting so the user can disable them, independent of video playback volume/mute. Use restrained sounds for completed deletion and add/move actions, with one sound per completed action, including a bulk action. Apple-device-only playback is feasible as an option, but the sound assets and platform/default policy remain undecided. Do not assume permission to bundle Apple’s actual system sounds; original or appropriately licensed assets, or user-supplied files, remain implementation options.
- After a successful settings save, show a **brief, subtle Saved indicator**. If saving fails, show an **inline error** rather than claiming success.
- **Gelbooru credentials must validate successfully before being saved automatically**. Editing credentials alone does not replace the saved credentials; validation failure preserves the previously saved set.
- Credential validation starts **only when the owner presses Validate**, not automatically while typing or leaving the fields. Successful validation automatically saves those credentials.
- The API-key input is **masked by default**, with a **show/hide toggle only for newly entered, unsaved text**.
- After validation and storage, clear the client-side key input and show **Credentials saved** status. The **stored key is never returned to or viewable by the client**; replacement requires entering a new key. The show/hide control cannot reveal a stored key.
- **Do not provide a Remove credentials button** in Settings.
- Validation progress/error presentation and retry behavior remain unspecified.

## 15. View closing and return history

- An exploration view's close button appears only when its sidebar row is hovered or keyboard-focused.
- Closing an inactive view leaves the current content unchanged.
- Outside text entry or controls consuming the key, **Shift+W closes the active exploration view or collection context**, following the same history-return behavior as middle-click. Temporary album entries close; pinned-album and Favorites shortcuts remain, with pin status unchanged.
- Closing the active exploration view returns to the **most recently active available view or album from navigation history**, not the adjacent sidebar item.
- Closed entries are skipped.
- If closing leaves no available destination, **automatically create and activate a new empty exploration view**, using New search defaults and focusing the search input. This is a real view-list entry and immediately loads all posts using New search defaults.
- Albums opened through pinned destinations participate as return destinations even though they do not have exploration-view entries.
- Whether Favorites, Settings and the Albums index are also eligible close-return destinations has not been explicitly settled.

## 16. Exploration, tag interactions and restoration

Gestures depend on the target: tags, thumbnails and sidebar destinations have distinct contracts.

| Interaction | Result |
|---|---|
| Click a tag | Immediately search for that tag in the current view, replacing the previous query; focus/keep focus in the search input with one trailing space and the caret at the end, ready to type the next tag |
| Shift-click a tag | Append the tag to the active query and immediately run the updated search; focus the search input with one trailing space and the caret at the end |
| Ctrl/Cmd-click a tag | Create a background exploration view for that tag directly below the current view, without switching to it |
| Middle-click a tag | Create a background exploration view for that tag directly below the current view in the view list, without switching to it |
| Browser Back | Undo navigation/query changes and restore the previous context |
| Browser Forward | Restore the next navigation state |
| Switch exploration views | Restore the destination view's independent context |

- Context retains its query, results, selected post and scroll position. **Switching to an already-open view or album restores its position**. **Only a completely new view or an album that was not already open starts at the top**. Pinned status alone does not determine whether an album is already open. Returning from the viewer to the same gallery also restores its position. Reload and Shift+T restoration retain their separately specified rules.
- Switching exploration views restores each view's **gallery/viewer mode and selected image**, but **resets image zoom and pan to its initial display state**. Existing gallery-scroll restoration still applies.
- **Restore all open exploration views and temporary album entries after browser reload**, including their queries, list order and the active destination. This workspace restoration does not override the separate rule that video playback positions are cleared on reload.
- Reload also restores **gallery scroll positions and the open image in the viewer**. Reset image zoom and pan to its initial display state rather than restoring manual zoom.
- Clicking **New search** creates a blank exploration view at the top of the view list, activates it and focuses the search field.
- Outside text entry or controls consuming these keys, **T opens a new empty exploration view**, using the same behavior as New search. **Shift+T reopens the last closed view**. No Ctrl/Cmd modifier is required. **Shift+T also restores closed temporary album entries, including their query and scroll position**. Closed-history lifetime and remaining restoration details remain unspecified.
- **New search uses default filters: all ratings, all media types, and Newest sorting**, rather than inheriting another view's filters.
- A **new search view immediately loads all posts using its default filters and Newest sorting**, without requiring Search/Enter first. The search input remains available for refinement. Explicitly submitting an empty query still loads all posts. Results load incrementally using the existing infinite-scroll/batch-preloading rules.
- View titles automatically reflect the **applied query**, not unsubmitted edits. Blank views are titled **New search**.
- Views can be renamed manually. Once a custom title is set, subsequent query changes do not overwrite it. Double-clicking the title opens an inline editor; Enter saves and Escape cancels. How to restore automatic naming remains unspecified.
- View icons and colors follow the category of the query's first tag, including mixed-tag queries. Mixed queries do not automatically use a neutral search icon.
- Users can manually override the view icon and its color; manual choices take precedence over automatic category styling.
- The neutral icon color is **blue**, matching the neutral tag color. Exact shades and icon artwork remain open; category color families are specified in the tag panel section.
- Each view entry uses **one font color for its entire title**, determined by the **first tag's category color**. Mixed queries do not use multiple text colors. This supersedes the earlier per-tag coloring rule for view rows; viewer/autocomplete tag colors remain unchanged.
- Automatic icon styling and title text color both derive from the first tag. Existing manual icon/color overrides remain icon-specific.
- A manually assigned view name **replaces the visible query text** in its sidebar row; no second line of query tags is displayed. The underlying query and search behavior remain unchanged. Custom titles use the same single first-tag-derived text color.
- View titles stay on a **single line** and truncate with an **ellipsis** when they exceed the available width. A tooltip shows the **full name**.
- Force Click support is out of scope; double-click remains the inline-rename gesture.
- **Tag click and Shift-click are explicit immediate-search exceptions** to Search-to-update: both start the resulting query immediately and leave the search input active with a trailing space for entering another tag. Subsequent manual edits still wait for Search or Enter. The convenience trailing space alone is not an unapplied query change and must not highlight the Search button.
- Middle-click and Ctrl/Cmd-click on **tags** insert the new background exploration view immediately below the current exploration view, rather than at the end of the list. The current view remains active.
- When revealing the left sidebar in the viewer, **clearly distinguish views created by the current viewer session** using a border/background treatment separate from the active-view highlight. This creation highlight is visible **only inside the viewer**, never in the gallery. Closing or leaving the viewer clears the session highlight state; reopening a viewer must not restore those marks. The created views themselves remain open. Exact styling is provisional.
- Background exploration views created from tags use **New search defaults: all ratings, all media types, Newest sorting**, rather than inheriting the current view's filters or sorting.
- Show an **animated Opened in background toast immediately to the left of the activated tag**, positioned beside that tag and clamped within the viewport when a tag creates a background view, via middle-click or Ctrl/Cmd-click. Use **green text/icon, a green border and a subtle dark-green background**. Show the single-line **Opened in background** message with an **Open button/link that directly activates the newly created view**, with no secondary explanatory text. Animate the toast outward from the tag toward its position on the left. The current view stays active. Exact timing and visual values remain provisional; respect reduced motion.
- **Shift-clicking a tag preserves the current view's filters and sorting** while appending and immediately searching.
- **Ordinary clicking a tag resets filters and sorting to New search defaults** (all ratings, all media types, Newest) while replacing and immediately searching. In albums/Favorites, this does not change the collection scope.
- When the current destination has no exploration-view entry (for example, a pinned album or Favorites), insert the new background view at the top of the exploration-view list. Keep the current destination active.

### Collection-scoped navigation

- There is **never a tag list in gallery mode**, including exploration, album and Favorites galleries. Tag interactions while viewing a post belong in viewer mode; this does not remove the gallery search input or autocomplete.
- **Middle/Cmd/Ctrl-clicking a tag while viewing an image in an album or Favorites creates a new remote exploration view** for that tag in the background. It does not create another collection-scoped search.
- **Ordinary clicking a tag in an album or Favorites viewer replaces and immediately runs the current collection's search**, scoped to that album or Favorites. Focus the search input with one trailing space and the caret at the end, matching exploration searches.
- **Shift-clicking a tag in an album or Favorites appends it to the search of that current collection view**. The established immediate-search and focused-input/trailing-space behavior still applies.
- **Shift-clicking Favorites or an album navigation item creates a new collection-scoped entry in the regular exploration-view list and immediately activates it**. This enables multiple independent searches of the same Favorites collection or album. These explicit Shift-click copies are exceptions to ordinary collection navigation, which does not create exploration-list entries.
- **Middle-clicking an exploration-view, Favorites or album navigation item always closes that item/context**. This applies to the **entire row, including icon, label and nested close-button area**, whether active or inactive; it must close only once. This is distinct from middle-clicking a tag, which creates a background exploration view.
- Closing a navigation item is a navigation action, not deletion of the album, favorite membership or media. Existing history-return behavior applies when an active closable context is closed.
- Middle-clicking **Favorites or a pinned album closes only its open context**. Its sidebar shortcut remains; the album stays pinned. Closing does not delete the album, favorite membership or media.
- Shift-click-created album/Favorites search views start with a **blank search**, rather than copying the collection's current query and filters. They remain scoped to the selected album or Favorites; exact default filter values remain unspecified.
- Shift-click-created album/Favorites search views appear at the **top of the exploration-view list**. Their automatic titles show the **collection name followed by the search tags**, using one first-tag-derived font color throughout. Existing single-line truncation, full-name tooltip and manual-title override rules apply.

## 17. Viewer

- Viewer replaces the gallery; it is not an overlay on visible thumbnails.
- Use a **low-resolution derivative of the current image, blurred and dimmed, as the viewer background**. It follows the current image when navigating. Keep the full-resolution foreground artwork sharp. Exact derivative resolution, blur and dimming values remain provisional. Sparse viewer controls retain their existing fading rules.
- **Zoomed artwork may extend behind the information/sidebar area** instead of being clipped at its edge. At initial fit, the open right sidebar still reduces the available image area. **All UI elements remain above the artwork and interactive**, including details/tags, bars and navigation controls.
- Left navigation is almost entirely/completely hidden in viewer mode and revealed by moving the pointer to the far-left edge. It is hidden only in viewer mode.
- In viewer mode, the revealed **left sidebar overlays the image without resizing it**. This differs from the right details/tag sidebar, which reduces the image viewing area.
- The revealed left sidebar **stays open while hovered or while keyboard focus is within it**. It hides after the pointer and keyboard focus have both left it; exact hide delay remains unspecified.
- **Switching through the revealed left sidebar to a view already in viewer mode keeps that sidebar open after navigation.** The navigation click, row replacement, focus changes caused by rendering, or resulting pointer events must not immediately dismiss it. The user must be able to continue browsing and selecting sidebar entries without revealing it again. It may subsequently close through an intentional outside click, the sidebar shortcut, or an actual pointer/focus departure under the normal dismissal rules.
- **Known prototype discrepancy:** the demo still hides the sidebar immediately in this scenario, as confirmed by user review on 18 October 2026. This is an unresolved prototype bug, not the intended behavior or an approved change to this decision.
- **Hide the previous-image edge button while the left sidebar is revealed**, preventing overlapping controls. Once the sidebar hides, the normal edge-hover rule applies again.
- Right tag/metadata sidebar is optional, toggleable and resizable.
- Image viewing supports fit-to-viewport, zoom, pan, native resolution, fullscreen, previous/next navigation and neighbor prefetch.
- Navigation changes media without full-page reloads and retains exploration context.
- If full-size viewer media fails to load, **automatically retry once after 1 second**. If that retry also fails, show a **retry icon for the failed media**, matching thumbnail retry behavior.
- While a full-size image loads, show its **thumbnail as a blurred low-resolution preview**. Replace the preview with the full-size image when ready. The blur applies to the temporary preview, not the loaded original; exact blur strength remains unspecified.
- **Preload neighboring full-size images**, prioritizing the direction of navigation. The **preload count is configurable**. Its default, limits and allocation ahead/behind remain unspecified; this setting is separate from result-batch preloading.
- For neighboring **videos, preload only the poster and metadata**, not the full video file.
- Viewer navigation **automatically loads subsequent result batches** as needed; the end of the currently loaded batch is not the end of the sequence. Preload multiple batches ahead as specified for fast browsing.
- Image navigation **stops at the actual first and last images in the result sequence**; it does not wrap around. This applies to edge buttons and keyboard navigation.
- **Left/Right arrow keys and A/D navigate to the previous/next image even when zoomed in**, except while typing or interacting with a control that uses those keys. Two-finger scrolling only pans when zoomed; these shortcuts navigate rather than pan. Switching images resets zoom and pan as specified.
- **Escape returns from the viewer to the gallery**. When fullscreen is active, the first Escape **exits fullscreen** rather than also leaving the viewer.
- A **small back button at the top-left** also returns to the gallery, restoring its previous scroll position.
- Video viewing supports playback, seeking and fullscreen. **Videos start playing automatically on first opening in the viewer**; gallery thumbnails remain static. **Sound is enabled by default unless previously muted. Remember and reuse the owner's volume and muted state between videos.** **Videos loop automatically when they reach the end.** **Volume and mute preferences persist across browser reloads.** **Video volume and mute are controlled only inside the video player; do not add video-volume controls to Settings.** Persist the values last set in the player. Cross-device sharing and remaining playback-control details remain unspecified. Browser autoplay restrictions may require a fallback Play action; successful autoplay is not assumed in every browser state.
- Shortcut and gesture behavior is specified below; exact reveal/fade timings and panel dimensions remain open.

### Viewer controls and surfaces

- Viewer controls **fade after a short period of pointer inactivity** and reappear on pointer movement or keyboard focus. Exact inactivity delay remains unspecified.
- An **open details/tag sidebar remains visible** when controls fade or hide during keyboard navigation. Control visibility changes do not close, fade or resize that sidebar.
- While the details/tag sidebar is open, the **top-right icon bar also stays visible**, including during inactivity and keyboard navigation. This overrides the general control-hiding rule for that bar.
- The **mouse cursor hides over the image after inactivity** and returns on pointer movement. This rule applies to the image area, not sidebar controls or other interactive UI.
- Navigating with **Left/Right arrows or A/D hides the viewer controls immediately**. Edge arrows retain their separate edge-hover reveal rule. These shortcuts do not run while typing or interacting with controls that use the keys.
- Previous/next controls are **circular, translucent black buttons with white icons** near the left/right edges.
- Each appears only while the pointer is near its respective edge **and is not hovering over another UI element**.
- A compact **icons-only bar at the top-right** contains, in order: **album picker (`book-image`), favorite, download, open Gelbooru page, fullscreen, toggle right tag sidebar**.
- Clicking **Download immediately starts downloading the original file to the current device**, rather than opening the media URL as a browser page. It does not open a size/format selection menu. This is distinct from retaining the original in the server library.
- Immediately **to the right of Download**, an icon button **opens the current image's original Gelbooru post page in a new browser tab**.
- The icon bar and previous/next buttons share the **same background color, opacity and backdrop blur**.
- The right-side stack is ordered **icon bar → details panel → tag information panel**, with restrained gaps. The tag panel slides in beneath the details panel.
- The separate details panel shows **resolution, file size, rating, original-post link and score**. These details are not placed below the tags. The sidebar toggle **shows/hides the details and tag panels together**. The icon bar remains separate. Exact details-field layout remains unspecified.
- In the right tag panel, group tags by category in this exact order: **artist → character → copyright → metadata → general → deprecated**. Deprecated tags appear only in their own group at the bottom, rather than also appearing in their original category groups.
- Sort tags **alphabetically within each category**.
- Show each tag's **post count in smaller, muted text on the right** of its row.
- Long tag names **wrap onto multiple lines** rather than truncating with an ellipsis.
- Display tag names with **spaces instead of underscores**, while preserving the original source tag spelling internally for searches and identity.
- Category headings are **bold labels** with restrained styling. **Hide empty category groups**, including their headings.
- Color each tag's **text/font according to its category**: **artist: red; character: green; metadata: yellow; general: blue**. **Copyright tags use light pink. Deprecated tags use gray**, overriding their category color. Exact shades remain unspecified. This confirms text color, not colored pill backgrounds; remaining row styling is undecided; post-count display is specified above.
- Opening the right tag panel **reduces the available initial-fit image area**. Manually zoomed artwork can extend behind the panel while the panel remains above it. Images at the initial fit state refit to that reduced area. For an already manually zoomed image, opening or resizing the panel **preserves its zoom level and focal point**, adjusting pan only as necessary to respect the new bounds.
- The **details and tag panels share one scrolling region**: details scroll away with the tags rather than remaining fixed. The top-right icon bar stays separate from this scrolling content.
- Switching images **resets that shared scrolling region to the top**, showing the new image's details first. The sidebar's open/closed state and width remain unchanged.
- The right details/tag panel has an **adjustable width**. Remember its **width and open/closed state separately for each view**, restoring them when switching back. They persist across browser reloads and remain unchanged when switching images within that view. Cross-device preference sharing remains unspecified.
- **New views start with the right details/tag sidebar closed**, rather than inheriting the current view's visibility. Restored existing views keep their own remembered state.
- **All viewer UI surfaces use background/backdrop blur**. This is separate from the blurred image-derived viewer background; the foreground artwork itself remains sharp.
- Exact control-surface darkness/opacity and image-backdrop dimming remain to be tuned; the image-derived background direction is approved. Exact blur, gap, dimensions and reveal zones are also not finalized.

### Video playback controls

- **Returning to a previously viewed video restores its playback position and leaves it paused**, overriding first-open autoplay. The owner explicitly resumes playback. **Playback positions are remembered only during the current browsing session and do not persist across reloads**. After a reload, there is no remembered position; first-open autoplay applies again.

- Videos use a **custom bottom playback bar** with **play/pause, seek timeline, elapsed/total time and volume**.
- The playback bar matches the viewer's **blurred control surfaces** and **fades on inactivity**.
- **Space toggles video play/pause**, except while typing or operating another control.
- **J/L seek backward/forward by 10 seconds** in videos, except while typing or operating another control. Left/Right and A/D continue to navigate between posts rather than seek.
- **Clicking the video itself toggles play/pause**; clicks on playback or other interface controls perform their own actions instead.
- **Double-clicking a video toggles fullscreen**. This differs from image double-click, which controls zoom. Double-click recognition must not accidentally toggle playback through its constituent clicks.

### Viewer action shortcuts

- **F** toggles fullscreen.
- **I** toggles the details/tag sidebar.
- **B toggles the left sidebar in the viewer**, with **Escape closing the revealed sidebar before leaving the viewer**, subject to topmost-layer Escape handling. This binding is customizable; **J/L remain video seek backward/forward**.
- When the left sidebar is opened with its shortcut, **clicking anywhere outside it closes it**. The outside click otherwise retains its normal action.
- **W** toggles favorite membership for the current post.
- **S** toggles the album selector for the current post.
- These viewer shortcuts do not run while typing or interacting with a control that consumes the keys.

### Viewer gestures and zoom

- **Trackpad swipes/scrolling never navigate to the previous or next image**, including at the initial zoom. Use edge buttons or keyboard navigation instead.
- When **zoomed in**, two-finger scrolling **pans the image**. Reaching a pan boundary must not cause that gesture to navigate to another image.
- Switching images **resets zoom and pan**. Each image opens at its own initial display size, determined by its dimensions, the configured thresholds and the available viewer area; do not carry the previous image's zoom or pan into it. Trackpad scrolling at this baseline does not navigate.
- **Double-click at the initial display size** zooms to **100% (native resolution)** around the clicked point.
- **Double-click an image zoomed above its initial display size** resets zoom and pan to its initial display state, regardless of how that zoom was reached.
- When the initial display is already **at or above 100%**, double-clicking at the initial size zooms to **2× that initial display size**, centered around the clicked point. Double-clicking again resets zoom and pan to the initial state. This is the exception to the usual 100% double-click target.
- A zoomed image also supports **click-and-drag panning**. Show a **grab** cursor over the pannable image and **grabbing** while dragging.
- Clamp panning independently on each axis to the image edges. If the displayed image fits within the available viewing area on an axis, keep it **centered on that axis** instead of permitting panning. If it overflows on both axes, allow bounded panning on both. These bounds apply to pointer dragging and two-finger panning.
- **Pinch outward increases zoom; pinch inward decreases zoom.**
- **Ctrl/Cmd + scroll up increases zoom; Ctrl/Cmd + scroll down decreases zoom.** These inputs change viewer zoom rather than navigating images.
- Zoom-out is bounded by a **fit-to-available-screen baseline**, subject to small-image/configured-resolution exceptions; it must not shrink an ordinarily fitted image arbitrarily below that baseline.
- Introduce a setting defining the **image-resolution threshold above which images are enlarged by default to fit the screen boundaries**. Preserve aspect ratio and the complete image: this is fit/contain, not crop-to-fill.
- The default-enlargement setting uses **minimum image width OR minimum image height**, with defaults of **1920 px width** and **1080 px height**. An image qualifies when its width is at least the configured width **or** its height is at least the configured height. These are source-image pixel dimensions, not a fixed viewer size.
- Qualifying images default to aspect-preserving fit within the available viewer area, without cropping. Images below **both** configured thresholds display at **native size**, shrinking only when necessary to fit; they are not enlarged by default. The resulting **default display size is also the minimum zoom level**. Pinching inward or using Ctrl/Cmd-scroll to zoom out stops at that baseline; it cannot shrink the image below it.
- Pinch/scroll event handling and browser/OS gesture interactions require implementation validation, especially in Firefox on macOS. No trackpad next/previous gesture or swipe transition is required.

### Collection-action feedback

- **Favorite and album-membership changes appear immediately** in the UI while saving proceeds.
- Successful favorite/album changes use **only the updated visual state**, with **no success toast**. The removal/restoration animations in section 26 and required interface sounds are separate feedback, not success toasts. Reserve collection-action messages for errors; separately specified task-completion and settings-save feedback remain unchanged.
- If saving fails, **revert the failed change** and show a **small error with Retry**.
- Original-media download readiness remains separate from membership saving: a later download failure does not undo a successfully saved collection membership.
- For **bulk actions with partial failures, keep successful changes**. Revert only failed changes, and **Retry applies only to failed items**, not the entire selection.
- Exact error placement, duration and remaining partial-failure presentation remain unspecified.

## 18. Retention and membership

- Favorites are separate from albums. A post can belong to multiple albums.
- **Favorites and albums define retention**: no remaining album membership and no favorite status means automatic deletion of the saved original/derivatives and saved-library metadata. Image-removal undo requires a recoverable removal mechanism/window, still to be designed (section 26); do not immediately destroy the only recoverable copy. Ordinary evictable browsing caches remain separate from saved-library retention.
- Favoriting saves metadata and queues original download; collection membership and download readiness are distinct states.
- Saved content is retained independently of upstream post changes/deletion once original retrieval succeeds.
- Adding to an album saves its metadata/reference and queues original-media retention when needed. Already saved posts reuse their existing metadata/media rather than downloading duplicates, including bulk and query-wide actions.
- **Deduplication is a global library invariant**, regardless of the page or action initiating a save. Exact metadata-hash matches reuse the existing item; matching media bytes reuse a single retained media object. Collection memberships reference these objects rather than creating copies. Different metadata items may reference the same media object.
- Removing one membership/item must not delete shared metadata/media still referenced elsewhere. Delete retained media only when no saved item retains it; independent cover-preview references follow their separate retention rule.
- Implementation details still to define: metadata fields and canonical serialization included in the hash, hash/schema versioning, and atomic duplicate detection across concurrent saves. Changes in metadata are not automatically treated as identical merely because the source ID or image matches. Source provenance must remain available when records are reused.

## 19. Prototype refinement summary — accepted behavior

This summary is an audit of the refinements made during hands-on review. The topic sections above contain the full rules; this ledger does not revive intermediate experiments.

| Area | Final accepted behavior |
|---|---|
| Justified gallery | Base layout on source aspect ratios. Slight cropping is permitted for completed rows. The last row may leave space on the right; do not force it to fill. Layout must remain stable rather than oscillating or flashing between positions. |
| Gallery headings | Exploration has no page heading, subtitle or generic description. Album contents and Favorites have one heading and no descriptive subtitle. |
| Favorites styling | Suppress favorite red borders inside Favorites-scoped galleries; retain the red-filled heart state. Favorite borders still apply elsewhere. |
| Viewer background | Use a low-resolution, blurred and dimmed rendition of the current image as the backdrop, replacing pure black. Exact numerical treatment remains provisional. |
| Zoom layering | Zoomed artwork extends behind the info area; every UI surface/control stays above it and remains interactive. Initial fit continues to reserve the sidebar space. |
| Trackpad | Remove trackpad next/previous navigation entirely. Do not retain swipe-trigger heuristics, a swipe cooldown or a swipe transition. Pinch zoom and zoomed-image two-finger panning remain. |
| Album picker | Repeated activation of the same album button toggles the picker closed. Changing image closes it. Focus on its button must not break keyboard image navigation. |
| Background-view toast | Place immediately left of the source tag, vertically beside it, constrained to the viewport. Animate outward from that tag. Use green text/check icon and border with a subtle dark-green blurred background. One line: **Opened in background**, plus **Open**. No “Continue browsing” or other secondary message. |
| Toast action | Open activates the specific newly created view and dismisses the toast. Creating the background view itself does not switch away. |
| Viewer-created views | When the viewer's left sidebar is revealed, clearly mark views created by that viewer session with a border/background treatment separate from the active highlight. Show these marks only in the viewer, never in the gallery; clear their state when leaving/closing the viewer, without closing the created views. The prototype uses a green border, tinted background and left accent; exact visual tokens remain provisional. |
| Middle-click | Middle-click anywhere in a sidebar view/collection row closes the context once, including nested icon/text/button areas, whether active or inactive. Middle-click on a tag remains background exploration. |
| Close shortcut | **Shift+W** replaces the old X default. Unmodified **W** still toggles favorite. Bindings remain customizable. |
| Last-view closure | Create and activate a real new empty-query exploration view, focus search, and load default all-post results immediately when no available return destination remains. |
| View text color | One font color throughout each view title, derived from the first tag's category. This includes mixed queries and custom titles. Per-tag colors remain in actual tag lists/autocomplete, not within a view title. |
| Downloads | Single-image Download initiates an original-file download with a filename; it must not navigate the browser to the media. Bulk original downloads remain one ZIP. |
| Context menus | Open a custom menu for applicable items. Position it below/right of the cursor when possible; independently flip above and/or left when space is insufficient, then keep it within the viewport. Background tag opening is through middle/Cmd/Ctrl activation; the short-lived direct secondary-click opening experiment is superseded. |
| New views | Immediately load the all-post query with default rating/media filters and Newest sorting; do not wait for an empty Search submission. |
| Scroll restoration | Newly created views and albums not already open start at the top. Existing open views/albums restore their scroll position. Ordinary reopening after explicit closure starts fresh; Shift+T and reload use their restoration rules. Pinned status alone is not open status. |
| Viewer sidebar dismissal | A left sidebar opened by shortcut closes on an outside click. Preserve the clicked control's normal action. |
| Settings structure | Settings title occupies its fixed header/search-bar area. Its own compact section navigation stays sticky below that header instead of shifting upward with a content title. |
| Settings active indicator | No left-border accent. A **single background highlight slides directly to the destination item**. Do not step-highlight intermediate items during a section jump. Section scrolling remains smooth. |
| Cover drag/drop | Supporting images reorder or swap onto the primary; candidates can be dropped onto the primary too, with target feedback. Save commits, Cancel/Escape discards. |
| Saved-search types | Change type through the saved-search context menu; choose **Search, Artist or Character**. Persist and display the selection and use it for filtering without modifying query, filters or sorting. |

### Default shortcut reference

All bindings below are defaults and remain customizable. Suppress application shortcuts during text entry and where a focused control consumes the key; Escape follows the topmost-layer rule.

| Key | Action / scope |
|---|---|
| T | Create and activate a new empty-query exploration view; immediately load default results |
| Shift+T | Reopen the last closed view or temporary album with its saved context |
| Shift+W | Close the active view/collection context; preserve fixed shortcuts and pins |
| Left / A | Previous image, including while zoomed |
| Right / D | Next image, including while zoomed |
| F | Toggle viewer fullscreen |
| I | Toggle right details/tag sidebar |
| B | Toggle viewer left sidebar |
| W | Toggle current post's favorite membership |
| S | Toggle current post's album picker |
| Space | Video play/pause |
| J / L | Video seek backward/forward by 10 seconds |
| Cmd/Ctrl+A | Select the whole current query and enter multi-select mode, with unloaded results included (outside text inputs) |
| Cmd/Ctrl+Shift+A | Deselect all while keeping multi-select mode open (outside text inputs) |
| Cmd/Ctrl+Backspace | Album/Favorites gallery: remove selected images; viewer: remove displayed image. Unavailable in remote exploration |
| Cmd/Ctrl+Z | Restore the last removed image membership without navigating; preserve text-field undo |
| Escape | Dismiss the topmost active layer; selection/edit/capture cancellation, sidebar dismissal, fullscreen exit or viewer return as applicable |

No default view-switching binding; preserve browser Ctrl+Tab/Ctrl+Shift+Tab. No Force Click requirement. No trackpad image-navigation gesture.

### Functional approval and implementation boundary

The user has confirmed satisfaction with the reviewed prototype's functionality. Preserve the requested interaction outcomes above in the production implementation. This does **not** mean all earlier requirements have been implemented or verified: the local prototype still has sample images, browser-local state, simulated server tasks, incomplete video/server workflows and documented accessibility/edge-case gaps. Do not copy browser-local authority, sample-data shortcuts, arbitrary timing constants or incidental bugs into production requirements.

## 20. Remaining decisions

These are unresolved details, not permission requirements or implementation blockers in every case. Existing rules above remain fixed; avoid treating older “unspecified” clauses as reopening them.

| Area | Genuine open details |
|---|---|
| Visual system | Logo artwork; exact category shades; fonts, spacing, dimensions, thumbnail gaps, exact squircle radii/implementation details, red-border thickness, surface blur/opacity. The image-derived backdrop direction is approved; exact blur/dimming and UI-surface values remain provisional. |
| Search and autocomplete | Dropdown geometry and suggestion limits; complex operator/token behavior; exact filter icon artwork; verified Gelbooru rating mapping, especially General versus Sensitive. The four UI labels and all-selected defaults are decided. |
| Search edge cases | Empty submission with an already changed sort; normalization used for saved-search equality; random-query exhaustion and interaction with whole-query enumeration. |
| Sidebar and restoration | Width bounds; album-section height bounds; inactive pinned-album unpin behavior; eligibility of fixed pages in close-return history; lifetime of closed-view history; reopened-view insertion position; restoration of pending edits and cache-expired results. |
| View identity | Actual category icons; customizing UI; returning custom names/icons/colors to automatic; treatment of operators or unknown tags when choosing the first-tag category. |
| Collections and selection | Initial range anchor and visual selected state; selection count when query total is unknown; whole-query ZIP progress/limits; exclusions during query-wide dragging; scope of exploration-row Add to album versus current selection. |
| Albums | Alternative sorting directions and definition of updated time; album-picker inline validation/cancellation; all-failed or partially populated album presentation; background-created album destination. |
| Cover fans | Exact evenly stepped geometry and motion; color metric/threshold; candidate sampling; whether manual locks are per slot or whole fan; manual reset; cover candidate sampling/storage limits. Automatic versus manual updating and threshold stopping are decided. |
| Saved searches | Keyword matching; empty saved-query naming; editing stored filters/query; exact deletion-confirmation wording. Saved-search pinning has not been selected. |
| Viewer | Edge zones, timing and blur; maximum zoom; vertical two-finger panning details; physical-pixel versus CSS-pixel definition of 100%; sidebar closing/viewport-resize zoom edge cases; shortcut/panning interaction with focused controls, OS/browser gestures and video; metadata missing/error presentation. |
| Playback | Seekbar/player-volume presentation details (no video-volume setting); unsupported/autoplay-blocked states; session position scope across duplicate contexts; persistence across devices. Position reset on reload and volume/mute persistence are decided. |
| Removal and undo | Production recovery mechanism/window compatible with automatic orphan cleanup; precise transition and restored-preview tuning; undo across reload/devices and bulk-action grouping. Basic image-removal undo without navigation is fixed. |
| Interface sounds | Assets/licensing, platform policy and default enablement. Implementation and a user disable control are required. |
| Tasks and feedback | Aggregate progress calculation; completion duration; partial failure detail layout; exact error location/lifetime; task-list overflow; retry checkpoints and query mutation during enumeration. Cancellation and red-over-green priority are decided. |
| Settings | Concrete controls and defaults not already chosen, especially preload count, batch lookahead and download preferences; validation progress/error UI; shortcut conflict scope; browser-reserved key capture. |
| Accessibility | Keyboard equivalents for menus, reordering, splitter resizing, drag/drop and cover editing; dialog focus trapping/return; reduced-motion behavior; tooltip timing and screen-reader feedback. These need design/validation, not invented approvals. |

## 21. Recommendations still awaiting selection

- Give all pointer-only actions keyboard equivalents, and retain clear focus states.
- Respect reduced motion for cover expansion and fading.
- Highlight valid drag targets; make repeated membership additions idempotent without a success toast.
- Preserve stable gallery anchors during asynchronous result insertion. Thumbnail-size changes already preserve the anchor as a confirmed rule.

These are recommendations, not newly finalized choices.

## 22. Coverage and next review

The user-approved interaction baseline now covers search/autocomplete, filters, exploration/collection navigation, galleries, selection/bulk actions, albums, saved searches, cover editing, viewer/zoom, playback, tasks, retention and Settings/shortcuts. Remaining work is production implementation, focused edge-case closure, accessibility and visual parameter selection. This is not a measured completion percentage or proof that the UI is implementation-complete.

---

## 23. Approved thumbnail corners and favorite outlines

- **Squircle-style rounding is approved for grid thumbnails**. Use a Firefox-compatible smoothed clipping path or equivalent where native corner shaping is unavailable. Keep the corner scale consistent across wide and tall thumbnails.
- The squircle direction, corrected corner rendering and **removal of borders from ordinary thumbnails are approved**. Only explicitly specified favorite/selection indicators may add an outline; normal thumbnails have none. Exact production radius values are not finalized.

- The **favorite outline follows the thumbnail's squircle geometry** without changing tile dimensions. Draw it **inset within the clip**, so its outside edge is not cut through by the thumbnail clipping boundary and does not produce corner fringes.
- Temporary gallery-options controls let the owner **toggle squircle versus regular rounding** and adjust **regular radius and squircle radius independently** with live updates. These are experimental review controls, not finalized production Settings requirements.

- **Favorite borders have no hover effect**: their color, width, opacity and shape remain unchanged on hover/focus. **Do not brighten/filter the thumbnail image on hover**, avoiding the pale compositing fringe seen beneath the outline. Thumbnail action buttons still reveal on hover/focus; selection feedback is separate.
- The user confirmed the corrected rendering looks good. The prototype's corrected inset outline is a reference for this specific rendering outcome, not approval of unrelated prototype styling.

## 24. Approved filters inside search

- **Approved:** place **rating, sorting and media-type icon buttons inside the search field's right edge**, sharing its outer background/border. The query input fills the remaining width.
- Keep **Search outside** the shared field on the right; retain the save-search control on the left. Gallery options sit at the top-right behind a vertical separator. Existing filter popovers and staged-search behavior remain unchanged.
- This placement **replaces the earlier separate filter-button layout**. Exact spacing, separator treatment and visual tokens remain provisional.

## 25. Final search-row and popover refinements

- **Save search** remains to the left of the shared search field.
- The shared search field contains the text input and **rating, sorting and media-type icon buttons inside its right edge**, using one outer background and outline.
- **Search** remains outside the field on the right. Its highlighted/pending state changes appearance **without changing font weight, padding, border width or dimensions**; there must be no layout shift.
- **Gallery options** sits at the far right of that row, **after a vertical separator** separating it from search controls. The floating bottom-right experiment is rejected.
- Clicking any popover-opening button again **closes its own popover**. Clicking another such button replaces the open popover with the new one.
- Search-filter popovers are **left-aligned with the activating button**, not centered on the button or cursor. Clamp within the viewport if the popover would overflow. Pointer and keyboard activation use the same button anchor.
- Filter popovers have a **small fade/slide/scale entrance**, originating around the button-aligned anchor. Exact timing and displacement remain provisional; honor reduced motion.
- Multiple filter selections keep the popover open. Outside click or Escape dismisses it. These edits remain pending until Search/Enter under the existing submission rules.
- Squircle thumbnail geometry, the matching inset favorite outline, borderless ordinary thumbnails and no hover-brightness/border effects are approved as recorded in section 23. Temporary radius-review controls do not by themselves become production Settings requirements.

This final refinement summary supersedes the intermediate cursor-centered popover and floating Gallery options experiments. The written decisions remain authoritative; the prototype is not a general visual reference.

- **Sidebar simplification:** do not display an “EXPLORATION” heading above the view list. Do not show a visible “T” shortcut hint beside the New search/new-view button; its keyboard shortcut remains available.

## 26. Collection removal, undo and automatic viewer transitions

- **Ctrl/Cmd+Backspace** removes selected images from the current album or Favorites gallery. In an album/Favorites **viewer**, it removes **only the displayed image**, without requiring multi-selection, even if that context retains a selection. The same configurable binding applies in both modes. Remote exploration has no deletion action; no action deletes an upstream post. Preserve normal text editing when an input is focused.
- Removing the displayed image automatically advances to the next image. If it was last, show the previous image. If the collection becomes empty, return to its empty gallery. This is distinct from explicit manual navigation.
- For automatic advance, the outgoing image makes a **downward departure with a gentle tilt, slight shrink and fade**, while the next enters from the right or the previous enters from the left. All viewer controls remain above the animation. Manual navigation retains its existing behavior.
- Animate only transforms and opacity on temporary image layers. No per-frame canvas rendering, image tessellation or animated blur. Respect reduced motion with immediate replacement. The current prototype departure is **480 ms**; final distances, tilt and timing remain subject to visual review.
- **Ctrl/Cmd+Z restores the most recently removed image to its original album/Favorites membership without navigating to it or changing the currently displayed image.** Show a small **rise-and-fade restored-image preview**, preserving the active context. Preserve normal text-field undo when editing.
- The prototype keeps session-only removal history. Production undo retention/recovery must be reconciled with automatic orphan cleanup so undoable removals remain recoverable. The recovery mechanism and time window remain open; this does not introduce a browsable uncollected library.
- Album deletion undo and redo are not decided by this image-removal rule. Failed removals must roll back under the existing error rules rather than enter successful-removal history.
