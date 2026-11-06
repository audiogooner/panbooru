# Panbooru — Album cover fan specification

Decision baseline: 17 October 2026. This focused specification supplements the UI decision record. Generated mockups are exploratory only: their uneven rotations are not approved geometry.

## Image count

Use **four images total: one primary cover and three supporting images**. This is the explicitly clarified count. Albums with fewer than four images use only their **available distinct images**, without duplicating images to fill the fan. Empty albums use the specified placeholder.

## Album grid presentation

- The Albums page presents albums in a grid.
- Each album has a compact fan cover, its title below, and its item count below the title in smaller, subtler text.
- Empty albums show a quiet rounded `book-image` placeholder and **Empty** beneath the title, not 0 items.
- The primary cover is frontmost. Supporting images sit mostly behind it, with only a restrained amount of their edges/corners visible.
- Keep the stack compact. Do not spread the supporting images broadly to one side.
- Images have rounded corners, consistent with the application's rounded aesthetic. Exact radius/smoothing remains unspecified.
- On creation, use the first available image as primary and **automatically select three supporting images by border-color similarity** as candidates become available. The owner can override the primary and supporting images using images belonging to that album.
- **Recalculate automatic supporting-image selections as new posts are added**, improving border-color matches. **Manually selected supporting images remain fixed**. Do not automatically replace the primary cover. This behavior also applies to saved-search fans.
- For saved searches, perform recalculation **when opened and new results are fetched**, not through background polling solely for cover updates.
- **Stop automatic updates once a color-match threshold is reached**. Exact threshold/scoring and manual reset behavior remain unspecified; manually selected supporting images are never replaced automatically.

- Removing a selected cover image from the album **does not automatically replace it**, including for manually configured covers. **Store its small cover preview independently**, preserving the cover even if the original is deleted under collection-retention rules. This is not an exception retaining full original media.
- **Automatically delete independent cover previews once no album or saved-search cover references them**; shared previews remain until their last cover reference is removed.

## Rotation and offsets

- Rotations must be **small and evenly stepped**, with consistent offsets. They must not look randomly scattered.
- The written geometry rule takes precedence over all generated images.
- Recommended implementation geometry: keep the primary upright and use a regular angular increment between successive layers, e.g. primary `0`, first supporting layer `Δ`, second supporting layer `2Δ`, third supporting layer `3Δ`. This one-direction arrangement is a recommendation, not an additional selected requirement; exact angle, direction, pivot and pixel offsets remain to be tuned.
- Keep image dimensions consistent and do not distort the artwork to form the fan.

## Hover state

- Hover gently **explodes the stack**: supporting images separate slightly more while retaining orderly, evenly stepped rotations.
- The hover state remains compact and predominantly behind the primary image.
- Recommended: keep primary cover position, card footprint, title and count stable; animate supporting layers without relayout of neighboring albums.
- Exact expansion distance, angle increment and animation duration are not yet selected.
- Recommended accessibility behavior: expose the same preview on keyboard focus and reduce/remove motion when reduced motion is requested.

## Cover customization dialog

- Open a **small dialog with a live preview** of the fan.
- Display the primary cover **large at the top center** of the panel.
- Display the three supporting fan images **below it, left to right in a centered row**.
- Supporting images can be dragged within that row to reorder them. Reordering does not implicitly replace the primary cover.
- Dropping a supporting image onto the large primary cover **swaps them**. The dragged image becomes primary; the old primary occupies the dragged image's exact former position in the supporting row.
- Candidate images from the searchable selector can also be **dragged onto the primary cover**. If already in the supporting row, swap with its slot; otherwise replace the primary with that candidate. Highlight the primary as a valid drop target. These changes remain provisional until Save.
- Provide a selector for choosing album images. It is **searchable by tags**, scoped to the current album.
- Provide automatic selection of images with **closely matching colors in areas near their borders**. It runs by default on creation and is recalculated as new posts are added unless supporting images are set manually. The exact similarity metric and comparison regions remain open.
- All changes, including reordering, swapping and automatic selection, remain provisional until **Save**.
- **Cancel or Escape** discards the changes; outside clicks do not dismiss the dialog.

## Open refinements

Exact geometry; definition of “first” under different album orders; picker search submission/matching rules; automatic color-selection details; and saving/error feedback remain unspecified. None should be inferred from generated mockups.
