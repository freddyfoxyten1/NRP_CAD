# extensions/

Custom TipTap editor extensions used by `DocumentEditor`.

| File | What it does |
|---|---|
| `FontSize.ts` | Adds a `fontSize` text mark that persists as an inline `style="font-size:…"` on `<span>` elements. |
| `Indent.ts` | Adds indent / outdent commands to paragraphs (mapped to Tab / Shift+Tab in the editor). |
| `ResizableImage.ts` | Replaces TipTap's default `Image` node with a custom node that renders via `ImageView` and supports drag-to-resize handles. |
