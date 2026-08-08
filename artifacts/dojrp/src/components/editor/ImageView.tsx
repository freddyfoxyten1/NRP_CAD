// ─────────────────────────────────────────────────────────────────────────────
// components/editor/ImageView.tsx  —  TipTap node view for resizable images
//
// Renders the custom ResizableImage node inside the editor.  Adds eight drag
// handles around the image so the user can resize it by dragging.  Passes
// attribute updates back to ProseMirror via the TipTap NodeViewWrapper API.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useRef, useState } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import type { ImageAlign, ImageNodeAttrs } from '../../extensions/ResizableImage';

// ── Alignment SVG icons ───────────────────────────────────────────────────────
const AlignIcons: Record<ImageAlign, React.ReactNode> = {
  'float-left': (
    <svg viewBox="0 0 20 16" className="h-4 w-4" fill="currentColor">
      <rect x="0" y="0" width="8" height="11" rx="1" opacity="0.85"/>
      <rect x="10" y="0" width="10" height="1.8" rx="0.6" opacity="0.5"/>
      <rect x="10" y="4" width="10" height="1.8" rx="0.6" opacity="0.5"/>
      <rect x="10" y="8" width="7"  height="1.8" rx="0.6" opacity="0.5"/>
      <rect x="0"  y="13" width="20" height="1.8" rx="0.6" opacity="0.35"/>
    </svg>
  ),
  'left': (
    <svg viewBox="0 0 20 16" className="h-4 w-4" fill="currentColor">
      <rect x="0" y="0" width="12" height="9" rx="1" opacity="0.85"/>
      <rect x="0" y="11" width="20" height="1.8" rx="0.6" opacity="0.5"/>
      <rect x="0" y="14" width="16" height="1.8" rx="0.6" opacity="0.5"/>
    </svg>
  ),
  'center': (
    <svg viewBox="0 0 20 16" className="h-4 w-4" fill="currentColor">
      <rect x="4" y="0" width="12" height="9" rx="1" opacity="0.85"/>
      <rect x="0" y="11" width="20" height="1.8" rx="0.6" opacity="0.5"/>
      <rect x="2" y="14" width="16" height="1.8" rx="0.6" opacity="0.5"/>
    </svg>
  ),
  'right': (
    <svg viewBox="0 0 20 16" className="h-4 w-4" fill="currentColor">
      <rect x="8" y="0" width="12" height="9" rx="1" opacity="0.85"/>
      <rect x="0" y="11" width="20" height="1.8" rx="0.6" opacity="0.5"/>
      <rect x="4" y="14" width="16" height="1.8" rx="0.6" opacity="0.5"/>
    </svg>
  ),
  'float-right': (
    <svg viewBox="0 0 20 16" className="h-4 w-4" fill="currentColor">
      <rect x="12" y="0" width="8" height="11" rx="1" opacity="0.85"/>
      <rect x="0"  y="0" width="10" height="1.8" rx="0.6" opacity="0.5"/>
      <rect x="0"  y="4" width="10" height="1.8" rx="0.6" opacity="0.5"/>
      <rect x="0"  y="8" width="7"  height="1.8" rx="0.6" opacity="0.5"/>
      <rect x="0"  y="13" width="20" height="1.8" rx="0.6" opacity="0.35"/>
    </svg>
  ),
};

const ALIGN_OPTIONS: { id: ImageAlign; title: string }[] = [
  { id: 'float-left',  title: 'Wrap text — float left'  },
  { id: 'left',        title: 'Align left (block)'       },
  { id: 'center',      title: 'Center (block)'           },
  { id: 'right',       title: 'Align right (block)'      },
  { id: 'float-right', title: 'Wrap text — float right'  },
];

// ── Handle positions ──────────────────────────────────────────────────────────
const HANDLES = [
  { style: 'top-0 left-0 -translate-x-1/2 -translate-y-1/2',       cursor: 'nwse-resize' },
  { style: 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2',     cursor: 'ns-resize'   },
  { style: 'top-0 right-0 translate-x-1/2 -translate-y-1/2',       cursor: 'nesw-resize' },
  { style: 'top-1/2 left-0 -translate-x-1/2 -translate-y-1/2',     cursor: 'ew-resize'   },
  { style: 'top-1/2 right-0 translate-x-1/2 -translate-y-1/2',     cursor: 'ew-resize'   },
  { style: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2',     cursor: 'nesw-resize' },
  { style: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2',   cursor: 'ns-resize'   },
  { style: 'bottom-0 right-0 translate-x-1/2 translate-y-1/2',     cursor: 'nwse-resize' },
];

// ── Build CSS filter string from attrs ────────────────────────────────────────
export function buildImageFilter(
  opacity: number,
  brightness: number,
  contrast: number,
  recolour: string,
): string | undefined {
  const parts: string[] = [];

  // Recolour first
  switch (recolour) {
    case 'grayscale':   parts.push('grayscale(1)'); break;
    case 'sepia':       parts.push('sepia(1)'); break;
    case 'invert':      parts.push('invert(1)'); break;
    case 'tint-red':    parts.push('sepia(1) hue-rotate(320deg) saturate(2)'); break;
    case 'tint-orange': parts.push('sepia(1) hue-rotate(340deg) saturate(2)'); break;
    case 'tint-yellow': parts.push('sepia(1) hue-rotate(20deg) saturate(2)'); break;
    case 'tint-green':  parts.push('sepia(1) hue-rotate(90deg) saturate(2)'); break;
    case 'tint-teal':   parts.push('sepia(1) hue-rotate(150deg) saturate(2)'); break;
    case 'tint-blue':   parts.push('sepia(1) hue-rotate(200deg) saturate(2)'); break;
  }

  if (opacity  !== 100) parts.push(`opacity(${opacity / 100})`);
  if (brightness !== 0) parts.push(`brightness(${(brightness + 100) / 100})`);
  if (contrast   !== 0) parts.push(`contrast(${(contrast + 100) / 100})`);

  return parts.length ? parts.join(' ') : undefined;
}

// ── Component ─────────────────────────────────────────────────────────────────
const ImageView = ({ node, selected, updateAttributes }: NodeViewProps) => {
  const attrs     = node.attrs as ImageNodeAttrs;
  const align     = attrs.align ?? 'center';
  const src       = attrs.src as string;
  const altText   = attrs.altText ?? attrs.alt ?? '';
  const width     = attrs.width;
  const height    = attrs.height;
  const angle     = attrs.angle ?? 0;
  const opacity   = attrs.opacity  ?? 100;
  const brightness = attrs.brightness ?? 0;
  const contrast  = attrs.contrast ?? 0;
  const recolour  = attrs.recolour ?? 'none';
  const mt        = attrs.marginTop    ?? 0;
  const mb        = attrs.marginBottom ?? 0;
  const ml        = attrs.marginLeft   ?? 0;
  const mr        = attrs.marginRight  ?? 0;

  const [showMore, setShowMore] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  const isFloat  = align === 'float-left' || align === 'float-right';
  const wrapperDisplay = isFloat ? 'inline-block' : 'block';
  const wrapperAlign   = !isFloat && align === 'center' ? 'mx-auto'
                       : !isFloat && align === 'right'  ? 'ml-auto'
                       : '';

  const cssFilter = buildImageFilter(opacity, brightness, contrast, recolour);

  // Notify DocumentEditor when selection changes
  useEffect(() => {
    if (selected) {
      window.dispatchEvent(new CustomEvent('tiptap:image-select', {
        detail: { attrs: node.attrs, updateAttributes },
      }));
    } else {
      window.dispatchEvent(new CustomEvent('tiptap:image-deselect'));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // Push attr updates to panel while selected (e.g. from floating toolbar)
  useEffect(() => {
    if (selected) {
      window.dispatchEvent(new CustomEvent('tiptap:image-attrs-update', {
        detail: { attrs: node.attrs },
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.attrs]);

  return (
    <NodeViewWrapper
      className={`relative ${wrapperDisplay} ${wrapperAlign} max-w-full`}
      style={{
        float: align === 'float-left' ? 'left' : align === 'float-right' ? 'right' : 'none',
        margin: align === 'float-left'
          ? `${mt}px ${mr || 20}px ${mb || 8}px ${ml}px`
          : align === 'float-right'
          ? `${mt}px ${mr}px ${mb || 8}px ${ml || 20}px`
          : `${mt || 8}px auto ${mb || 8}px`,
        display: wrapperDisplay,
        clear: isFloat ? undefined : 'both',
      }}
    >
      {/* Image */}
      <img
        src={src}
        alt={altText}
        className={`max-w-full block ${selected ? 'outline-none' : ''}`}
        style={{
          width:     width  != null ? `${width}px`  : undefined,
          height:    height != null ? `${height}px` : undefined,
          filter:    cssFilter,
          transform: angle ? `rotate(${angle}deg)` : undefined,
          userSelect: 'none',
          display: 'block',
        }}
        draggable={false}
      />

      {/* Selection overlay */}
      {selected && (
        <>
          {/* Blue border */}
          <div className="pointer-events-none absolute inset-0 border-2 border-[#1a73e8]" />

          {/* 8 resize handles */}
          {HANDLES.map((h, i) => (
            <div
              key={i}
              className={`absolute z-10 h-2.5 w-2.5 rounded-sm border-2 border-[#1a73e8] bg-white ${h.style}`}
              style={{ cursor: h.cursor }}
            />
          ))}

          {/* Floating alignment toolbar */}
          <div
            className="absolute left-1/2 -translate-x-1/2 z-20 flex items-center gap-0.5 rounded-lg border border-[#dadce0] bg-white px-1.5 py-1 shadow-lg"
            style={{ bottom: -44 }}
            onMouseDown={e => e.preventDefault()}
          >
            {ALIGN_OPTIONS.map(opt => (
              <button
                key={opt.id}
                type="button"
                title={opt.title}
                onMouseDown={e => { e.preventDefault(); updateAttributes({ align: opt.id }); }}
                className={`flex h-7 w-7 items-center justify-center rounded transition-colors
                  ${align === opt.id
                    ? 'bg-[#e8f0fe] text-[#1a73e8]'
                    : 'text-[#444746] hover:bg-[#f1f3f4]'}`}
              >
                {AlignIcons[opt.id]}
              </button>
            ))}

            <div className="mx-1 h-5 w-px bg-[#dadce0]" />

            <div className="relative" ref={moreRef}>
              <button
                type="button"
                title="More options"
                onMouseDown={e => { e.preventDefault(); setShowMore(p => !p); }}
                className={`flex h-7 w-7 items-center justify-center rounded transition-colors
                  ${showMore ? 'bg-[#e8f0fe] text-[#1a73e8]' : 'text-[#444746] hover:bg-[#f1f3f4]'}`}
              >
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                  <circle cx="10" cy="4"  r="1.5"/>
                  <circle cx="10" cy="10" r="1.5"/>
                  <circle cx="10" cy="16" r="1.5"/>
                </svg>
              </button>

              {showMore && (
                <div className="absolute right-0 top-full z-30 mt-1 w-44 rounded-lg border border-[#dadce0] bg-white py-1 shadow-xl">
                  <button type="button"
                    onMouseDown={e => { e.preventDefault(); updateAttributes({ width: null, height: null }); setShowMore(false); }}
                    className="w-full px-4 py-2 text-left text-xs font-medium text-[#444746] hover:bg-[#f1f3f4]">
                    Reset size
                  </button>
                  <button type="button"
                    onMouseDown={e => {
                      e.preventDefault();
                      const el = document.querySelector('.doc-editor img') as HTMLImageElement | null;
                      const maxW = el?.closest('.doc-editor')?.clientWidth ?? 700;
                      updateAttributes({ width: maxW, height: null });
                      setShowMore(false);
                    }}
                    className="w-full px-4 py-2 text-left text-xs font-medium text-[#444746] hover:bg-[#f1f3f4]">
                    Full width
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </NodeViewWrapper>
  );
};

export default ImageView;
