---
name: Document editor HeaderConfig
description: All fields in HeaderConfig type, and key facts about save/load behaviour.
---

## HeaderConfig full type shape (as of task #60)

Fields:
- `layout`, `logo_url`, `logo_size`, `title_text`, `subtitle_text`, `text_align`, `show_divider` — header layout
- `memo_mode`, `release_date`, `effective_date`, `memo_to`, `memo_subject` — memo header section
- `left_bar`, `left_bar_color`, `corner_logo_url`, `footer_text`, `watermark_url` — page decorations

## Save / load

- Stored as `header_config jsonb` in `dps_resources` table — no migration needed for new fields.
- **Critical**: The GET `/api/resources/:id` query MUST include `header_config` in the SELECT. It was missing until task #60 fixed it — if it goes missing again, opening a document will silently discard all header/style settings.

## TipTap table extensions

All four extensions ship in ONE package: `@tiptap/extension-table`.
Import as named exports: `import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';`
Do NOT use default imports — the package has no default export (as of TipTap v3).

**Why:** `@tiptap/extension-table-row`, `-header`, `-cell` do NOT exist as separate packages in this project. All are in `@tiptap/extension-table`.
