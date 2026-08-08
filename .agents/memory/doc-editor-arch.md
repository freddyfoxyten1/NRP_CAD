---
name: Document editor architecture
description: TipTap-based Google Docs-style editor — extensions, layout constants, pagination approach, and font controls
---

## Rule
Use TipTap with these extensions: StarterKit, TextAlign, Underline, TextStyle, Color, Highlight, ResizableImage, Link, Indent (custom), FontFamily (`@tiptap/extension-font-family`), FontSize (custom `src/extensions/FontSize.ts`).

**Why:** Prior attempts to use plain contenteditable or a simpler editor lost formatting on save/load. TipTap's JSON schema round-trips cleanly through the API's `body` jsonb column.

**How to apply:** Any new text-formatting feature must hook into one of the existing extension types (`textStyle` mark for inline styles, `paragraph`/`heading` attrs for block-level). Do not add a new node type without a reason.

---

## Layout constants (DocumentEditor.tsx)

| Constant | Value | Meaning |
|---|---|---|
| `PAGE_H` | 1056 | US Letter at 96 dpi (11 in) |
| `PAGE_GAP` | 32 | Grey gutter between pages |
| `PAGE_MARGIN_PX` | 96 | 1-inch page margin (left/right/top/bottom) |
| `RULER_MARGIN` | 96 | Same as PAGE_MARGIN_PX — keeps ruler ticks aligned |
| `VRULER_MARGIN` | 96 | Same — vertical ruler |

**Why:** 1 inch = 96 CSS px at 96 dpi. All four values must stay in sync or the ruler will drift from the actual content edge.

---

## Pagination approach

JS pagination runs in a `requestAnimationFrame` inside `editor.on('update')`. It:
1. Resets any prior `data-pg-push` margin adjustments on direct children of `editor.view.dom`.
2. Walks each child, measures `getBoundingClientRect()` relative to `docWrapRef`, and pushes any block that overflows `pageContentEnd` to the next page's content start via extra `marginTop`.
3. Persists the original margin in `data-pg-orig-mt` so reset is exact.
4. Updates `numPages` from `docWrapRef.scrollHeight / (PAGE_H + PAGE_GAP)`.

**Why:** CSS column / page-break approaches don't work inside a single TipTap `contenteditable`. JS measurement + margin injection is the only reliable method without fragmenting the DOM.

---

## Font controls

- `fontFamily` state (string, default `'Arial'`) and `fontSize` state (number pt, default `11`) sync from `editor.getAttributes('textStyle')` on every `selectionUpdate` and `update`.
- Font size stored as `"Npt"` string by the `FontSize` extension (e.g. `"11pt"`). Parse with `parseFloat`.
- GD_FONTS and GD_SIZES arrays define the preset lists in the toolbar dropdowns.
- Outside-click handler closes both dropdowns via `document.addEventListener('mousedown', ...)` — fires only when one of the dropdowns is open.

---

## Status bar

Fixed `h-6` bar at the bottom of the editor frame. Shows `Page 1 of N` (left) and word count (right). Word count computed in `onUpdate` via `editor.state.doc.textContent.split(/\s+/).filter(Boolean).length`.
