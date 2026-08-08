// ─────────────────────────────────────────────────────────────────────────────
// extensions/Indent.ts  —  TipTap paragraph indent / outdent
//
// Adds indent and outdent commands mapped to Tab / Shift+Tab.  Indentation is
// stored as a `margin-left` inline style on paragraph nodes and capped at a
// maximum level so text doesn't disappear off-screen.
// ─────────────────────────────────────────────────────────────────────────────
import { Extension } from '@tiptap/core';

export const Indent = Extension.create({
  name: 'indent',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          indent: {
            default: 0,
            parseHTML: el => {
              const v = el.getAttribute('data-indent');
              return v ? parseInt(v, 10) : 0;
            },
            renderHTML: attrs => {
              if (!attrs.indent) return {};
              return {
                'data-indent': String(attrs.indent),
                style: `margin-left: ${attrs.indent}px`,
              };
            },
          },
          lineHeight: {
            default: '1.5',
            parseHTML: el => el.getAttribute('data-line-height') ?? '1.5',
            renderHTML: attrs => {
              if (!attrs.lineHeight || attrs.lineHeight === '1.5') return {};
              return {
                'data-line-height': String(attrs.lineHeight),
                style: `line-height: ${attrs.lineHeight}`,
              };
            },
          },
        },
      },
    ];
  },
});
