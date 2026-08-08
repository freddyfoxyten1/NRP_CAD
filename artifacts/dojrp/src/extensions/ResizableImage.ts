// ─────────────────────────────────────────────────────────────────────────────
// extensions/ResizableImage.ts  —  TipTap resizable image node
//
// Replaces TipTap's built-in Image node with a custom one rendered via
// ImageView (components/editor/ImageView.tsx), which adds drag handles so
// users can resize images directly inside the document editor.
// ─────────────────────────────────────────────────────────────────────────────
import Image from '@tiptap/extension-image';
import { ReactNodeViewRenderer } from '@tiptap/react';
import ImageView from '../components/editor/ImageView';

export type ImageAlign = 'float-left' | 'left' | 'center' | 'right' | 'float-right';

export type ImageNodeAttrs = {
  src: string;
  alt: string;
  title: string;
  align: ImageAlign;
  width: number | null;
  height: number | null;
  angle: number;
  opacity: number;
  brightness: number;
  contrast: number;
  altText: string;
  recolour: string;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
};

export const ResizableImage = Image.extend({
  name: 'image',

  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: 'center' as ImageAlign,
        parseHTML: el => (el.getAttribute('data-align') as ImageAlign) ?? 'center',
        renderHTML: attrs => ({ 'data-align': attrs.align }),
      },
      width: {
        default: null as number | null,
        parseHTML: el => {
          const v = el.getAttribute('data-width');
          return v ? parseInt(v, 10) : null;
        },
        renderHTML: attrs => (attrs.width != null ? { 'data-width': attrs.width } : {}),
      },
      height: {
        default: null as number | null,
        parseHTML: el => {
          const v = el.getAttribute('data-height');
          return v ? parseInt(v, 10) : null;
        },
        renderHTML: attrs => (attrs.height != null ? { 'data-height': attrs.height } : {}),
      },
      angle: {
        default: 0,
        parseHTML: el => Number(el.getAttribute('data-angle') ?? 0),
        renderHTML: attrs => (attrs.angle ? { 'data-angle': attrs.angle } : {}),
      },
      opacity: {
        default: 100,
        parseHTML: el => Number(el.getAttribute('data-opacity') ?? 100),
        renderHTML: attrs => (attrs.opacity !== 100 ? { 'data-opacity': attrs.opacity } : {}),
      },
      brightness: {
        default: 0,
        parseHTML: el => Number(el.getAttribute('data-brightness') ?? 0),
        renderHTML: attrs => (attrs.brightness !== 0 ? { 'data-brightness': attrs.brightness } : {}),
      },
      contrast: {
        default: 0,
        parseHTML: el => Number(el.getAttribute('data-contrast') ?? 0),
        renderHTML: attrs => (attrs.contrast !== 0 ? { 'data-contrast': attrs.contrast } : {}),
      },
      altText: {
        default: '',
        parseHTML: el => el.getAttribute('data-alt-text') ?? '',
        renderHTML: attrs => (attrs.altText ? { 'data-alt-text': attrs.altText } : {}),
      },
      recolour: {
        default: 'none',
        parseHTML: el => el.getAttribute('data-recolour') ?? 'none',
        renderHTML: attrs => (attrs.recolour && attrs.recolour !== 'none' ? { 'data-recolour': attrs.recolour } : {}),
      },
      marginTop:    { default: 0, parseHTML: el => Number(el.getAttribute('data-mt') ?? 0), renderHTML: attrs => (attrs.marginTop    ? { 'data-mt': attrs.marginTop }    : {}) },
      marginBottom: { default: 0, parseHTML: el => Number(el.getAttribute('data-mb') ?? 0), renderHTML: attrs => (attrs.marginBottom ? { 'data-mb': attrs.marginBottom } : {}) },
      marginLeft:   { default: 0, parseHTML: el => Number(el.getAttribute('data-ml') ?? 0), renderHTML: attrs => (attrs.marginLeft   ? { 'data-ml': attrs.marginLeft }   : {}) },
      marginRight:  { default: 0, parseHTML: el => Number(el.getAttribute('data-mr') ?? 0), renderHTML: attrs => (attrs.marginRight  ? { 'data-mr': attrs.marginRight }  : {}) },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});
