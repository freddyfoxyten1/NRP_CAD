// ─────────────────────────────────────────────────────────────────────────────
// extensions/FontSize.ts  —  TipTap font-size mark
//
// Adds a `fontSize` text mark that persists as an inline style attribute
// (style="font-size: 12pt") on <span> elements.  Exposed via the
// setFontSize / unsetFontSize commands used by the DocumentEditor toolbar.
// ─────────────────────────────────────────────────────────────────────────────
import { Extension } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
  }
}

/**
 * Stores font-size as a custom attribute on the `textStyle` mark so it
 * serialises as  style="font-size: 11pt"  and survives round-trips.
 */
export const FontSize = Extension.create({
  name: 'fontSize',

  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: el => el.style.fontSize || null,
            renderHTML: attrs =>
              attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontSize:
        (size) =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontSize: size }).run(),
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain()
            .setMark('textStyle', { fontSize: null })
            .removeEmptyTextStyle()
            .run(),
    };
  },
});
