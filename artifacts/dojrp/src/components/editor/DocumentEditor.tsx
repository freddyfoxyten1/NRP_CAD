// ─────────────────────────────────────────────────────────────────────────────
// components/editor/DocumentEditor.tsx  —  DPS rich-text document editor
//
// A full Google-Docs-style editor built on TipTap / ProseMirror.
// Features: multi-page US-Letter layout, formatting toolbar, tables with cell
// fill colours, resizable images, PDF import, per-page headers/footers/logos,
// watermarks, background textures, document outline sidebar, and a page-style
// panel.  Used exclusively by DepartmentOfPublicSafety.tsx.
//
// Key sections in this file (search for the ── markers):
//   Page constants · TipTap extensions · DocHeader · PageStylePanel
//   DocumentEditor component · Paginate loop · Toolbar · Render
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import Underline from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { ResizableImage } from '../../extensions/ResizableImage';
import type { ImageNodeAttrs } from '../../extensions/ResizableImage';
import { Indent } from '../../extensions/Indent';
import Link from '@tiptap/extension-link';
import Highlight from '@tiptap/extension-highlight';
import ImageOptionsPanel from './ImageOptionsPanel';
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight,
  Bold, ChevronDown, ChevronUp, Image as ImageIcon, Italic,
  Link as LinkIcon, List, ListOrdered,
  Redo, Strikethrough, Underline as UnderlineIcon,
  Undo, Type, ArrowLeft, Layout, Upload, Plus, X,
  FileText, Table2, Paintbrush, Pencil, GripVertical,
  IndentIncrease, IndentDecrease,
  SeparatorHorizontal, ChevronsUpDown, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import FontFamily from '@tiptap/extension-font-family';
import { FontSize } from '../../extensions/FontSize';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import * as pdfjsLib from 'pdfjs-dist';
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

// ── Page constants (US Letter at 96 dpi) ──────────────────────────────────────
const PAGE_H    = 1056; // 11 inches
const PAGE_GAP  = 32;   // gap between pages (matches Google Docs ~27px rounded)
const PAGE_MARGIN_PX = 96; // 1 inch = 96px at 96dpi
const PAGE_TOTAL = PAGE_H + PAGE_GAP; // full slot height per page

// Google Docs font list
const GD_FONTS = [
  'Arial', 'Arial Black', 'Comic Sans MS', 'Courier New',
  'Georgia', 'Homemade Apple', 'Impact', 'Palatino Linotype', 'Times New Roman',
  'Trebuchet MS', 'Verdana',
] as const;

// Google Docs font-size presets (pt)
const GD_SIZES = [6, 7, 8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72, 96] as const;

// Table cell fill-color palette (5 cols × 4 rows)
const TABLE_FILL_COLORS = [
  '#ffffff', '#f8f9fa', '#e8eaed', '#bdc1c6', '#80868b',
  '#d2e3fc', '#d2e9e3', '#fef9e7', '#fce8e6', '#ede7f6',
  '#a8c7fa', '#81c995', '#fdd663', '#f28b82', '#c58af9',
  '#1a73e8', '#0f9d58', '#f9ab00', '#d93025', '#7627bb',
] as const;

// Merge base HeaderConfig with a per-page override (if any).
// page_overrides itself is never nested — always use the base's copy.
const resolvePageCfg = (base: HeaderConfig, pageNum: number): HeaderConfig => {
  const ov = base.page_overrides?.[String(pageNum)];
  return ov ? { ...base, ...ov, page_overrides: base.page_overrides } : base;
};

// ── Types ─────────────────────────────────────────────────────────────────────
type HeaderLayout = 'logo-left' | 'logo-right' | 'logo-center' | 'text-only' | 'none';
type LogoSize    = 'sm' | 'md' | 'lg';
type MemoRow     = { kind: 'divider' } | { kind: 'gap'; size: number } | { kind: 'field'; label: string; value: string; labelBold?: boolean; valueBold?: boolean; labelUnderline?: boolean; valueUnderline?: boolean; labelColor?: string; valueColor?: string } | { kind: 'text'; text: string; bold?: boolean; underline?: boolean; color?: string };

type HeaderConfig = {
  layout?:        HeaderLayout;
  logo_url?:      string;
  logo_size?:     LogoSize;
  title_text?:    string;
  subtitle_text?: string;
  text_align?:    'left' | 'center' | 'right';
  show_divider?:  boolean;
  // ── Memo header ──────────────────────────────────────────────────────────
  memo_mode?:      boolean;
  memo_color?:     string;   // text colour for memo rows, default '#222222'
  memo_bold?:      boolean;  // bold label+value text, default false
  memo_size?:      number;   // font size in pt, default 10.5
  memo_gap?:       number;   // row gap in px, default 4
  memo_dash_size?: number;   // dash length in px for field underlines, default 4
  memo_rows?:      MemoRow[]; // custom row list; undefined = use legacy fields
  release_date?:   string;
  effective_date?: string;
  memo_to?:        string;
  memo_subject?:   string;
  // ── Page decorations ──────────────────────────────────────────────────────
  left_bar?:        boolean;
  left_bar_color?:  string;
  left_bar_width?:  number;   // px, default 7
  corner_logo_url?:      string;
  corner_logo_opacity?:  number;   // 0–100, default 100
  corner_logo_size?:     number;   // px, default 56
  corner_logo_rotation?: number;   // degrees, default 0
  footer_text?:          string;
  footer_size?:          number;   // pt, default 8
  footer_color?:         string;   // default '#666666'
  footer_bold?:          boolean;  // default false
  footer_letter_spacing?: number;  // px, default 0
  footer_divider_above?: boolean;  // horizontal rule above footer
  footer_divider_below?: boolean;  // horizontal rule below footer
  watermark_url?:       string;
  watermark_opacity?:   number;   // 0–100, default 8
  watermark_size?:      number;   // px, default 384
  watermark_rotation?:  number;   // degrees, default 0
  bg_color?:        string;        // CSS colour for page background, default '#ffffff'
  bg_design?:       'none' | 'default' | 'custom';
  bg_design_url?:   string;       // base64 data URL for custom background
  page_texture?:    'none' | 'crosshatch';
  page_apply?:      'all' | number[];   // 'all' or 1-based page numbers
  page_overrides?:  Record<string, Partial<HeaderConfig>>; // per-page style overrides, key = 1-based page number as string
};

type ResourceDoc = {
  id: number;
  title: string;
  type: string;
  logo_url: string | null;
  header_config: HeaderConfig;
  content: object;
  created_at: string;
  updated_at: string;
};

type OutlineItem = { level: number; text: string; pos: number };

// ── Toolbar helpers ───────────────────────────────────────────────────────────
const ToolBtn = ({
  active, disabled, onClick, title, children,
}: {
  active?: boolean; disabled?: boolean; onClick: () => void; title: string; children: React.ReactNode;
}) => (
  <button type="button" title={title} disabled={disabled} onClick={onClick}
    className={`flex h-7 w-7 items-center justify-center rounded transition-colors
      ${active ? 'bg-[#c2d3fd] text-[#1a73e8]' : 'text-[#444746] hover:bg-[#e8eaed]'}
      ${disabled ? 'opacity-30 pointer-events-none' : ''}`}>
    {children}
  </button>
);

const ToolDivider = () => <div className="mx-1 h-5 w-px bg-[#dadce0]" />;

// ── Logo size map ─────────────────────────────────────────────────────────────
const LOGO_SIZE: Record<LogoSize, string> = {
  sm: 'max-h-10 max-w-[120px]',
  md: 'max-h-16 max-w-[200px]',
  lg: 'max-h-24 max-w-[300px]',
};

// ── Ruler ─────────────────────────────────────────────────────────────────────
// docW=816px, margins=96px each side (1 inch), 1 inch=96px at 96dpi
const RULER_DOC_W  = 816;
const RULER_MARGIN = PAGE_MARGIN_PX;          // 96px = 1 inch
const RULER_INCH   = 96;
const RULER_MAX_INDENT = RULER_DOC_W - RULER_MARGIN * 2; // 624px (6.5 inches)

const Ruler = ({
  editor,
  canEdit,
}: {
  editor: ReturnType<typeof import('@tiptap/react').useEditor> | null;
  canEdit: boolean;
}) => {
  const rulerRef   = useRef<HTMLDivElement>(null);
  const dragging   = useRef(false);

  // Current indent from editor selection
  const [indent, setIndent] = useState(0);
  const [preview, setPreview] = useState<number | null>(null); // drag preview

  // Sync indent from editor on every selection / content change
  useEffect(() => {
    if (!editor) return;
    const sync = () => {
      const attrs = editor.getAttributes('paragraph') as { indent?: number };
      setIndent(attrs.indent ?? 0);
    };
    editor.on('selectionUpdate', sync);
    editor.on('update', sync);
    sync();
    return () => { editor.off('selectionUpdate', sync); editor.off('update', sync); };
  }, [editor]);

  // Convert ruler clientX → indent px
  const xToIndent = (clientX: number): number => {
    if (!rulerRef.current) return 0;
    const rect = rulerRef.current.getBoundingClientRect();
    // rulerRef is the 816-px wide inner div; left-margin zone starts at RULER_MARGIN
    const raw = clientX - rect.left - RULER_MARGIN;
    return Math.max(0, Math.min(RULER_MAX_INDENT - 1, Math.round(raw)));
  };

  const startDrag = (e: React.MouseEvent) => {
    if (!canEdit || !editor) return;
    e.preventDefault();
    dragging.current = true;

    const onMove = (ev: MouseEvent) => {
      setPreview(xToIndent(ev.clientX));
    };
    const onUp = (ev: MouseEvent) => {
      dragging.current = false;
      setPreview(null);
      const newIndent = xToIndent(ev.clientX);
      setIndent(newIndent);
      editor.chain().focus().updateAttributes('paragraph', { indent: newIndent }).run();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Build tick marks (memoised — they never change)
  const ticks = useMemo(() => {
    const out: React.ReactNode[] = [];
    for (let i = 0; i <= Math.ceil((RULER_DOC_W / RULER_INCH) * 2); i++) {
      const x = (i * RULER_INCH) / 2;
      if (x > RULER_DOC_W) break;
      const isMajor  = i % 2 === 0;
      const num      = i / 2;
      const inMargin = x < RULER_MARGIN || x > RULER_DOC_W - RULER_MARGIN;
      out.push(
        <div key={i} className="absolute flex flex-col items-center pointer-events-none" style={{ left: x }}>
          <div className={`${isMajor ? 'h-2.5' : 'h-1.5'} w-px ${inMargin ? 'bg-[#bdc1c6]' : 'bg-[#80868b]'}`} />
          {isMajor && num > 0 && (
            <span className={`text-[8px] leading-none mt-0.5 select-none ${inMargin ? 'text-[#bdc1c6]' : 'text-[#80868b]'}`}>
              {num}
            </span>
          )}
        </div>,
      );
    }
    return out;
  }, []);

  const displayIndent = preview ?? indent;
  const markerX = RULER_MARGIN + displayIndent;

  return (
    <div className="sticky top-0 z-10 flex h-7 shrink-0 items-start border-b border-[#e0e0e0] bg-[#f8f9fa] px-4">
      {/* outer px-4 mirrors the document px-4 padding */}
      <div ref={rulerRef} className="relative mx-auto w-full max-w-[816px]" style={{ height: 28 }}>

        {/* Grey margin zones */}
        <div className="absolute inset-y-0 left-0 bg-[#f1f3f4]" style={{ width: RULER_MARGIN }} />
        <div className="absolute inset-y-0 right-0 bg-[#f1f3f4]" style={{ width: RULER_MARGIN }} />

        {ticks}

        {/* Margin border lines */}
        <div className="absolute top-0 bottom-0 border-r-2 border-[#1a73e8]/40 pointer-events-none" style={{ left: RULER_MARGIN }} />
        <div className="absolute top-0 bottom-0 border-l-2 border-[#1a73e8]/40 pointer-events-none" style={{ right: RULER_MARGIN }} />

        {/* ── Left-indent marker (draggable blue triangle) ── */}
        {canEdit && (
          <div
            className="absolute bottom-0 z-20 flex flex-col items-center"
            style={{ left: markerX, transform: 'translateX(-50%)', cursor: 'col-resize', userSelect: 'none' }}
            onMouseDown={startDrag}
            title={`Left indent: ${displayIndent}px — drag to change`}
          >
            {/* Downward triangle */}
            <svg width="10" height="8" viewBox="0 0 10 8" className="shrink-0">
              <polygon points="0,0 10,0 5,8" fill="#1a73e8" />
            </svg>
          </div>
        )}

        {/* Dashed guide line while dragging */}
        {preview !== null && (
          <div
            className="pointer-events-none absolute top-0 bottom-0 border-l-2 border-dashed border-[#1a73e8]/60"
            style={{ left: markerX }}
          />
        )}
      </div>
    </div>
  );
};

// ── Vertical ruler + line-spacing side section ────────────────────────────────
const LINE_SPACINGS: { value: string; label: string; sublabel?: string }[] = [
  { value: '1',    label: '1',    sublabel: 'Single' },
  { value: '1.15', label: '1.15' },
  { value: '1.5',  label: '1.5' },
  { value: '2',    label: '2',    sublabel: 'Double' },
  { value: '2.5',  label: '2.5' },
  { value: '3',    label: '3',    sublabel: 'Triple' },
];

const VRULER_DOC_H   = PAGE_H;          // 1056px — US Letter
const VRULER_PY      = 32;              // py-8 outer gap before page
const VRULER_MARGIN  = PAGE_MARGIN_PX; // 96px = 1 inch
const VRULER_INCH    = 96;

const VerticalRuler = ({
  editor,
  canEdit,
}: {
  editor: ReturnType<typeof import('@tiptap/react').useEditor> | null;
  canEdit: boolean;
}) => {
  const [lineHeight, setLineHeight] = useState('1.5');
  const [spacingOpen, setSpacingOpen] = useState(false);
  const spacingRef = useRef<HTMLDivElement>(null);

  // Sync line-height from current paragraph
  useEffect(() => {
    if (!editor) return;
    const sync = () => {
      const attrs = editor.getAttributes('paragraph') as { lineHeight?: string };
      setLineHeight(attrs.lineHeight ?? '1.5');
    };
    editor.on('selectionUpdate', sync);
    editor.on('update', sync);
    sync();
    return () => { editor.off('selectionUpdate', sync); editor.off('update', sync); };
  }, [editor]);

  // Close spacing panel on outside click
  useEffect(() => {
    if (!spacingOpen) return;
    const handler = (e: MouseEvent) => {
      if (spacingRef.current && !spacingRef.current.contains(e.target as Node)) {
        setSpacingOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [spacingOpen]);

  // Build tick marks
  const ticks = useMemo(() => {
    const out: React.ReactNode[] = [];
    const totalInches = VRULER_DOC_H / VRULER_INCH; // 11
    for (let i = 0; i <= totalInches; i++) {
      const y = VRULER_PY + VRULER_MARGIN + i * VRULER_INCH;
      const inMargin = i === 0 || i >= totalInches - 1;
      out.push(
        <div
          key={`maj-${i}`}
          className="absolute right-0 flex items-center justify-end pointer-events-none"
          style={{ top: y }}
        >
          <div className={`w-2 h-px ${inMargin ? 'bg-[#bdc1c6]' : 'bg-[#80868b]'}`} />
          {i > 0 && (
            <span
              className={`absolute right-2.5 -translate-y-1/2 text-[7px] select-none leading-none ${inMargin ? 'text-[#bdc1c6]' : 'text-[#80868b]'}`}
            >
              {i}
            </span>
          )}
        </div>,
      );
      // Half-inch tick
      if (i < totalInches) {
        const yh = VRULER_PY + VRULER_MARGIN + (i + 0.5) * VRULER_INCH;
        out.push(
          <div key={`half-${i}`} className="absolute right-0 pointer-events-none" style={{ top: yh }}>
            <div className="w-1.5 h-px bg-[#bdc1c6]" />
          </div>,
        );
      }
    }
    return out;
  }, []);

  const applySpacing = (value: string) => {
    setLineHeight(value);
    setSpacingOpen(false);
    editor?.chain().focus().updateAttributes('paragraph', { lineHeight: value }).run();
  };

  const currentLabel = LINE_SPACINGS.find(s => s.value === lineHeight)?.label ?? lineHeight;

  return (
    <div
      className="relative shrink-0 border-r border-[#e0e0e0] bg-[#f8f9fa] select-none"
      style={{ width: 40, minHeight: VRULER_PY * 2 + VRULER_DOC_H }}
    >
      {/* ── Sticky spacing widget at top ── */}
      <div ref={spacingRef} className="sticky top-0 z-20 flex flex-col items-center border-b border-[#e0e0e0] bg-[#f8f9fa]">
        {canEdit ? (
          <button
            type="button"
            onClick={() => setSpacingOpen(p => !p)}
            title={`Line spacing: ${currentLabel} — click to change`}
            className={`flex w-full flex-col items-center gap-0.5 py-1.5 transition-colors hover:bg-[#e8eaed]
              ${spacingOpen ? 'bg-[#e8f0fe] text-[#1a73e8]' : 'text-[#5f6368]'}`}
          >
            {/* Spacing preview lines */}
            <div className="flex flex-col gap-[2px] pointer-events-none" style={{ gap: `${Math.max(1, parseFloat(lineHeight) * 2)}px` }}>
              <div className="h-px w-5 bg-current rounded" />
              <div className="h-px w-4 bg-current rounded opacity-70" />
              <div className="h-px w-5 bg-current rounded" />
            </div>
            <span className="text-[8px] font-semibold leading-none">{currentLabel}</span>
          </button>
        ) : (
          <div className="py-1.5" />
        )}

        {/* Spacing dropdown */}
        {spacingOpen && (
          <div className="absolute left-full top-0 z-30 ml-1 w-36 rounded-lg border border-[#dadce0] bg-white py-1 shadow-xl">
            <p className="px-3 pt-1 pb-1.5 text-[9px] font-bold uppercase tracking-widest text-[#80868b]">
              Line spacing
            </p>
            {LINE_SPACINGS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => applySpacing(opt.value)}
                className={`flex w-full items-center justify-between px-3 py-1.5 text-xs transition-colors hover:bg-[#f1f3f4]
                  ${lineHeight === opt.value ? 'text-[#1a73e8] font-semibold' : 'text-[#444746]'}`}
              >
                <span>{opt.sublabel ?? opt.value}</span>
                <span className="text-[10px] text-[#80868b]">{opt.sublabel ? opt.value : ''}</span>
                {lineHeight === opt.value && (
                  <svg viewBox="0 0 12 12" className="ml-1 h-3 w-3 shrink-0 text-[#1a73e8]" fill="currentColor">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
                  </svg>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Page margin shade (top) ── */}
      <div
        className="absolute left-0 right-0 bg-[#f1f3f4] pointer-events-none"
        style={{ top: VRULER_PY, height: VRULER_MARGIN }}
      />
      {/* ── Page margin shade (bottom) ── */}
      <div
        className="absolute left-0 right-0 bg-[#f1f3f4] pointer-events-none"
        style={{ top: VRULER_PY + VRULER_DOC_H - VRULER_MARGIN, height: VRULER_MARGIN }}
      />

      {/* ── Tick marks ── */}
      {ticks}
    </div>
  );
};

// ── Document outline sidebar ──────────────────────────────────────────────────
const DocSidebar = ({
  outline, onHeadingClick,
}: {
  outline: OutlineItem[];
  onHeadingClick: (pos: number) => void;
}) => (
  <div className="w-56 shrink-0 border-r border-[#e0e0e0] bg-white flex flex-col overflow-hidden">
    {/* Header */}
    <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#e0e0e0]">
      <span className="text-[11px] font-semibold text-[#444746]">Document outline</span>
    </div>

    {/* Outline list */}
    <div className="flex-1 overflow-y-auto px-2 py-2">
      {outline.length === 0 ? (
        <p className="px-2 pt-1 text-[11px] leading-relaxed text-[#80868b]">
          Headings you add to the document will appear here.
        </p>
      ) : (
        <ul className="space-y-0.5">
          {outline.map((h, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => onHeadingClick(h.pos)}
                className="w-full rounded px-2 py-1 text-left text-[11px] text-[#202124] hover:bg-[#f1f3f4] truncate transition-colors"
                style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
              >
                {h.text || '(Untitled)'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  </div>
);

// ── Hosted assets ─────────────────────────────────────────────────────────────
const _BASE = (import.meta.env.BASE_URL as string) ?? '/';
const DPS_SEAL_URL = `${_BASE}dps-seal.png`;

// ── Default page style applied to every new document ──────────────────────────
const DEFAULT_DPS_HEADER: HeaderConfig = {
  layout: 'none',
};

// ── Template chips ────────────────────────────────────────────────────────────
type DocTemplate = { label: string; icon: string; content: object; headerConfig?: Partial<HeaderConfig> };
const TEMPLATES: DocTemplate[] = [
  {
    label: 'Meeting notes',
    icon: '📋',
    content: {
      type: 'doc', content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Meeting Notes' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Attendees' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Agenda' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }] }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Notes' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Action Items' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }] }] },
      ],
    },
  },
  {
    label: 'Memo',
    icon: '📄',
    content: {
      type: 'doc', content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Memorandum' }] },
        { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'TO: ' }, { type: 'text', text: '' }] },
        { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'FROM: ' }, { type: 'text', text: '' }] },
        { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'DATE: ' }, { type: 'text', text: new Date().toLocaleDateString() }] },
        { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'RE: ' }, { type: 'text', text: '' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Purpose' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Details' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '' }] },
      ],
    },
  },
  {
    label: 'SOP',
    icon: '📑',
    content: {
      type: 'doc', content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Standard Operating Procedure' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '1. Purpose' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '2. Scope' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '3. Procedure' }] },
        { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }] }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '4. References' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '' }] },
      ],
    },
  },
];

// ── Document Header renderer ──────────────────────────────────────────────────
const DocHeader = ({
  cfg, canEdit, onLogoUpload, onRemoveLogo, onCfgChange, onCornerLogoClick,
}: {
  cfg: HeaderConfig; canEdit: boolean;
  onLogoUpload: () => void; onRemoveLogo: () => void;
  onCfgChange: (patch: Partial<HeaderConfig>) => void;
  onCornerLogoClick?: () => void;
}) => {
  const layout   = cfg.layout   ?? 'none';
  const logoSize = cfg.logo_size ?? 'md';
  const hasDivider = cfg.show_divider ?? true;
  const hasLogo = !!cfg.logo_url && layout !== 'text-only' && layout !== 'none';
  const hasText = (cfg.title_text || cfg.subtitle_text) && layout !== 'none';
  const textAlign = cfg.text_align ?? 'left';
  const alignClass = textAlign === 'center' ? 'text-center' : textAlign === 'right' ? 'text-right' : 'text-left';

  // ── Dashed underline style (background-image gradient, length controlled by memo_dash_size) ──
  const dashSz = cfg.memo_dash_size ?? 4;
  const dashLineStyle: React.CSSProperties = {
    backgroundImage: `repeating-linear-gradient(to right, #dadce0 0px, #dadce0 ${dashSz}px, transparent ${dashSz}px, transparent ${dashSz * 2}px)`,
    backgroundSize: '100% 1px',
    backgroundRepeat: 'repeat-x',
    backgroundPosition: '0 100%',
    paddingBottom: 2,
  };

  if (layout === 'none') {
    // No banner header — but memo fields can still be active independently
    const hasMemo = !!cfg.memo_mode && (
      canEdit ||
      !!(cfg.release_date || cfg.effective_date || cfg.memo_to || cfg.memo_subject) ||
      !!(cfg.memo_rows && cfg.memo_rows.length > 0)
    );
    const hasCornerLogo = !!(cfg.corner_logo_url || canEdit);
    if (!hasMemo && !hasCornerLogo) return null;

    // Corner logo element — rendered beside the memo rows
    const cornerLogoEl = hasCornerLogo ? (
      <div className="shrink-0 flex items-start pt-3 pr-5 pl-2">
        {canEdit ? (
          <button type="button" title="Click to change corner logo"
            onClick={onCornerLogoClick}
            className="group relative block rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]">
            {cfg.corner_logo_url ? (
              <img src={cfg.corner_logo_url} alt=""
                className="object-contain transition-opacity group-hover:opacity-75"
                style={{
                  width:    cfg.corner_logo_size    ?? 56,
                  height:   cfg.corner_logo_size    ?? 56,
                  opacity: (cfg.corner_logo_opacity ?? 100) / 100,
                  transform: `rotate(${cfg.corner_logo_rotation ?? 0}deg)`,
                }} />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed border-[#bdc1c6] bg-white/60 text-[#bdc1c6]">
                <Paintbrush className="h-5 w-5" />
              </div>
            )}
            <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
              <Pencil className="h-4 w-4 text-white" />
            </div>
          </button>
        ) : (
          cfg.corner_logo_url && (
            <img src={cfg.corner_logo_url} alt="" className="object-contain"
              style={{
                width:    cfg.corner_logo_size    ?? 56,
                height:   cfg.corner_logo_size    ?? 56,
                opacity: (cfg.corner_logo_opacity ?? 100) / 100,
                transform: `rotate(${cfg.corner_logo_rotation ?? 0}deg)`,
              }} />
          )
        )}
      </div>
    ) : null;

    return (
      <div className="flex items-start">
        {/* Memo rows — take all available width */}
        <div className="flex-1 min-w-0">
        {cfg.memo_mode && (
          <>
            {cfg.memo_rows ? (
              /* ── Custom row layout ─────────────────────────────────── */
              cfg.memo_rows.map((row, i) => {
                const vPad = { paddingTop: Math.max(4, (cfg.memo_gap ?? 4) / 2 + 4), paddingBottom: Math.max(4, (cfg.memo_gap ?? 4) / 2 + 4) };
                if (row.kind === 'divider') {
                  return <div key={i} className="mx-[96px] border-b border-[#e0e0e0]" />;
                }
                if (row.kind === 'gap') {
                  return <div key={i} style={{ height: row.size }} />;
                }
                const fs = `${cfg.memo_size ?? 10.5}pt`;
                if (row.kind === 'text') {
                  const textStyle = { color: row.color ?? cfg.memo_color ?? '#000000', fontSize: fs, fontWeight: (row.bold || cfg.memo_bold) ? 'bold' : 'normal' as const, textDecoration: row.underline ? 'underline' : undefined };
                  return (
                    <div key={i} className="px-[96px]" style={vPad}>
                      {canEdit ? (
                        <input type="text" value={row.text} placeholder="Free text…"
                          onChange={e => { const updated = cfg.memo_rows!.map((r, j) => j === i && r.kind === 'text' ? { ...r, text: e.target.value } : r); onCfgChange({ memo_rows: updated }); }}
                          className="w-full bg-transparent placeholder:text-[#ccc] outline-none border-0"
                          style={{ ...textStyle, ...dashLineStyle }} />
                      ) : row.text ? (
                        <p style={textStyle}>{row.text}</p>
                      ) : null}
                    </div>
                  );
                }
                // kind === 'field' — all formatting properties are independent per label/value
                const def = cfg.memo_color ?? '#000000';
                const labelStyle: React.CSSProperties = { color: row.labelColor ?? def, fontSize: fs, fontWeight: (row.labelBold ?? cfg.memo_bold) ? 'bold' : 'normal', textDecoration: row.labelUnderline ? 'underline' : undefined, whiteSpace: 'nowrap' };
                const valueStyle: React.CSSProperties = { color: row.valueColor ?? def, fontSize: fs, fontWeight: row.valueBold ? 'bold' : 'normal', textDecoration: row.valueUnderline ? 'underline' : undefined };
                return (
                  <div key={i} className="px-[96px]" style={vPad}>
                    {canEdit ? (
                      <div className="flex items-baseline gap-3">
                        <span style={labelStyle}>{row.label}</span>
                        <input type="text" value={row.value} placeholder="—"
                          onChange={e => { const updated = cfg.memo_rows!.map((r, j) => j === i && r.kind === 'field' ? { ...r, value: e.target.value } : r); onCfgChange({ memo_rows: updated }); }}
                          className="flex-1 bg-transparent placeholder:text-[#ccc] outline-none border-0"
                          style={{ ...valueStyle, ...dashLineStyle }} />
                      </div>
                    ) : (
                      /* Always show label in read-only; if no value, show a blank underline */
                      <div className="flex items-baseline gap-3">
                        <span style={labelStyle}>{row.label}</span>
                        {row.value
                          ? <span style={valueStyle}>{row.value}</span>
                          : <span className="flex-1" style={{ minWidth: 120, ...dashLineStyle }} />
                        }
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
            /* ── Legacy (default) layout ──────────────────────────────── */
            (() => {
              const memoColor = cfg.memo_color ?? '#222222';
              const memoW     = cfg.memo_bold ? 'bold' : 'normal';
              const memoSize  = `${cfg.memo_size ?? 10.5}pt`;
              const memoGap   = cfg.memo_gap ?? 4;
              const labelStyle: React.CSSProperties = { color: memoColor, fontWeight: memoW, fontSize: memoSize };
              const gridStyle: React.CSSProperties  = { gridTemplateColumns: 'max-content 1fr', columnGap: 24, rowGap: memoGap, fontSize: memoSize };
              const inputStyle: React.CSSProperties = { color: memoColor, fontSize: memoSize };
              return (
                <>
                  <div className="mx-[96px] border-b border-[#e0e0e0]" />
                  <div className="px-[96px] py-2">
                    {canEdit ? (
                      <div className="grid leading-6" style={gridStyle}>
                        <span style={labelStyle}>Release Date:</span>
                        <input type="text" value={cfg.release_date ?? ''} onChange={e => onCfgChange({ release_date: e.target.value })}
                          placeholder="MM/DD/YYYY"
                          className="bg-transparent leading-6 placeholder:text-[#ccc] outline-none border-0 w-full"
                          style={{ ...inputStyle, ...dashLineStyle }} />
                        <span style={labelStyle}>Effective Date:</span>
                        <input type="text" value={cfg.effective_date ?? ''} onChange={e => onCfgChange({ effective_date: e.target.value })}
                          placeholder="MM/DD/YYYY"
                          className="bg-transparent leading-6 placeholder:text-[#ccc] outline-none border-0 w-full"
                          style={{ ...inputStyle, ...dashLineStyle }} />
                      </div>
                    ) : (
                      <div className="leading-6" style={{ color: memoColor, fontSize: memoSize }}>
                        {cfg.release_date   && <p style={{ marginBottom: memoGap }}><span style={{ fontWeight: memoW }}>Release Date:</span>   {cfg.release_date}</p>}
                        {cfg.effective_date && <p style={{ marginBottom: memoGap }}><span style={{ fontWeight: memoW }}>Effective Date:</span> {cfg.effective_date}</p>}
                      </div>
                    )}
                  </div>
                  <div className="mx-[96px] border-b border-[#e0e0e0]" />
                  <div className="px-[96px] py-2">
                    {canEdit ? (
                      <div className="grid leading-6" style={gridStyle}>
                        <span style={labelStyle}>Memorandum For:</span>
                        <input type="text" value={cfg.memo_to ?? ''} onChange={e => onCfgChange({ memo_to: e.target.value })}
                          placeholder="Department Personnel"
                          className="bg-transparent leading-6 placeholder:text-[#ccc] outline-none border-0 w-full"
                          style={{ ...inputStyle, ...dashLineStyle }} />
                        <span style={labelStyle}>Subject:</span>
                        <input type="text" value={cfg.memo_subject ?? ''} onChange={e => onCfgChange({ memo_subject: e.target.value })}
                          placeholder="Document subject"
                          className="bg-transparent leading-6 placeholder:text-[#ccc] outline-none border-0 w-full"
                          style={{ ...inputStyle, ...dashLineStyle }} />
                      </div>
                    ) : (
                      <div className="leading-6" style={{ color: memoColor, fontSize: memoSize }}>
                        {cfg.memo_to      && <p style={{ marginBottom: memoGap }}><span style={{ fontWeight: memoW }}>Memorandum For:</span> {cfg.memo_to}</p>}
                        {cfg.memo_subject && <p style={{ marginBottom: memoGap }}><span style={{ fontWeight: memoW }}>Subject:</span>        {cfg.memo_subject}</p>}
                      </div>
                    )}
                  </div>
                  <div className="mx-[96px] border-b border-[#e0e0e0]" />
                </>
              );
            })())}
          </>
        )}
        </div>{/* end flex-1 memo column */}
        {cornerLogoEl}
      </div>
    );
  }

  const logoEl = hasLogo ? (
    <div className="relative group/logo shrink-0">
      <img src={cfg.logo_url} alt="Logo" className={`object-contain ${LOGO_SIZE[logoSize]}`} onError={onRemoveLogo} />
      {canEdit && (
        <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/40 opacity-0 group-hover/logo:opacity-100 transition-opacity rounded">
          <button type="button" onClick={onLogoUpload} className="rounded bg-white px-1.5 py-0.5 text-[9px] font-bold text-[#202124]">Change</button>
          <button type="button" onClick={onRemoveLogo} className="rounded bg-white px-1.5 py-0.5 text-[9px] font-bold text-red-500">Remove</button>
        </div>
      )}
    </div>
  ) : (canEdit && layout !== 'text-only') ? (
    <button type="button" onClick={onLogoUpload}
      className="flex shrink-0 h-14 w-14 items-center justify-center rounded-lg border-2 border-dashed border-[#dadce0] text-[#bdc1c6] hover:border-[#80868b] hover:text-[#80868b] transition-colors">
      <Upload className="h-5 w-5" />
    </button>
  ) : null;

  const textEl = (hasText || canEdit) ? (
    <div className={`flex-1 min-w-0 flex flex-col justify-center gap-0.5 ${alignClass}`}>
      {canEdit ? (
        <>
          <input type="text" value={cfg.title_text ?? ''} onChange={e => onCfgChange({ title_text: e.target.value })}
            placeholder="Organization name"
            className={`w-full bg-transparent text-base font-bold text-[#202124] placeholder:text-[#dadce0] outline-none ${textAlign === 'center' ? 'text-center' : textAlign === 'right' ? 'text-right' : 'text-left'}`} />
          <input type="text" value={cfg.subtitle_text ?? ''} onChange={e => onCfgChange({ subtitle_text: e.target.value })}
            placeholder="Subtitle or tagline (optional)"
            className={`w-full bg-transparent text-xs font-medium text-[#5f6368] placeholder:text-[#dadce0] outline-none ${textAlign === 'center' ? 'text-center' : textAlign === 'right' ? 'text-right' : 'text-left'}`} />
        </>
      ) : (
        <>
          {cfg.title_text    && <p className="text-base font-bold text-[#202124]">{cfg.title_text}</p>}
          {cfg.subtitle_text && <p className="text-xs font-medium text-[#5f6368]">{cfg.subtitle_text}</p>}
        </>
      )}
    </div>
  ) : null;

  return (
    <div>
      <div className="px-[96px] pt-10 pb-6">
        {layout === 'logo-center' ? (
          <div className="flex flex-col items-center gap-3">
            {logoEl}
            {textEl && <div className="text-center w-full">{textEl}</div>}
          </div>
        ) : layout === 'logo-right' ? (
          <div className="flex items-center gap-6">{textEl}{logoEl}</div>
        ) : (
          <div className="flex items-center gap-6">{logoEl}{textEl}</div>
        )}
      </div>
      {(hasDivider || cfg.memo_mode) && <div className="mx-[96px] border-b border-[#e0e0e0]" />}

      {cfg.memo_mode && (cfg.memo_rows ? (
        /* ── Custom row layout ─────────────────────────────────── */
        cfg.memo_rows.map((row, i) => {
          const vPad = { paddingTop: Math.max(4, (cfg.memo_gap ?? 4) / 2 + 4), paddingBottom: Math.max(4, (cfg.memo_gap ?? 4) / 2 + 4) };
          if (row.kind === 'divider') {
            return <div key={i} className="mx-[96px] border-b border-[#e0e0e0]" />;
          }
          if (row.kind === 'gap') {
            return <div key={i} style={{ height: row.size }} />;
          }
          const fs = `${cfg.memo_size ?? 10.5}pt`;
          if (row.kind === 'text') {
            const textStyle = { color: row.color ?? cfg.memo_color ?? '#000000', fontSize: fs, fontWeight: (row.bold || cfg.memo_bold) ? 'bold' : 'normal' as const, textDecoration: row.underline ? 'underline' : undefined };
            return (
              <div key={i} className="px-[96px]" style={vPad}>
                {canEdit ? (
                  <input type="text" value={row.text} placeholder="Free text…"
                    onChange={e => { const updated = cfg.memo_rows!.map((r, j) => j === i && r.kind === 'text' ? { ...r, text: e.target.value } : r); onCfgChange({ memo_rows: updated }); }}
                    className="w-full bg-transparent placeholder:text-[#ccc] outline-none border-0"
                    style={{ ...textStyle, ...dashLineStyle }} />
                ) : row.text ? (
                  <p style={textStyle}>{row.text}</p>
                ) : null}
              </div>
            );
          }
          // kind === 'field' — all formatting properties are independent per label/value
          const def = cfg.memo_color ?? '#000000';
          const labelStyle: React.CSSProperties = { color: row.labelColor ?? def, fontSize: fs, fontWeight: (row.labelBold ?? cfg.memo_bold) ? 'bold' : 'normal', textDecoration: row.labelUnderline ? 'underline' : undefined, whiteSpace: 'nowrap' };
          const valueStyle: React.CSSProperties = { color: row.valueColor ?? def, fontSize: fs, fontWeight: row.valueBold ? 'bold' : 'normal', textDecoration: row.valueUnderline ? 'underline' : undefined };
          return (
            <div key={i} className="px-[96px]" style={vPad}>
              {canEdit ? (
                <div className="flex items-baseline gap-3">
                  <span style={labelStyle}>{row.label}</span>
                  <input type="text" value={row.value} placeholder="—"
                    onChange={e => { const updated = cfg.memo_rows!.map((r, j) => j === i && r.kind === 'field' ? { ...r, value: e.target.value } : r); onCfgChange({ memo_rows: updated }); }}
                    className="flex-1 bg-transparent placeholder:text-[#ccc] outline-none border-0"
                    style={{ ...valueStyle, ...dashLineStyle }} />
                </div>
              ) : (
                /* Always show label in read-only; if no value, show a blank underline */
                <div className="flex items-baseline gap-3">
                  <span style={labelStyle}>{row.label}</span>
                  {row.value
                    ? <span style={valueStyle}>{row.value}</span>
                    : <span className="flex-1" style={{ minWidth: 120, ...dashLineStyle }} />
                  }
                </div>
              )}
            </div>
          );
        })
      ) : (() => {
        /* ── Legacy (default) layout ──────────────────────────── */
        const memoColor = cfg.memo_color ?? '#222222';
        const memoW     = cfg.memo_bold ? 'bold' : 'normal';
        const memoSize  = `${cfg.memo_size ?? 10.5}pt`;
        const memoGap   = cfg.memo_gap ?? 4;
        const labelStyle: React.CSSProperties = { color: memoColor, fontWeight: memoW, fontSize: memoSize };
        const gridStyle: React.CSSProperties  = { gridTemplateColumns: 'max-content 1fr', columnGap: 24, rowGap: memoGap, fontSize: memoSize };
        const inputStyle: React.CSSProperties = { color: memoColor, fontSize: memoSize };
        return (
          <>
            {/* Date fields */}
            <div className="px-[96px] py-2">
              {canEdit ? (
                <div className="grid leading-6" style={gridStyle}>
                  <span style={labelStyle}>Release Date:</span>
                  <input type="text" value={cfg.release_date ?? ''} onChange={e => onCfgChange({ release_date: e.target.value })}
                    placeholder="MM/DD/YYYY"
                    className="bg-transparent leading-6 placeholder:text-[#ccc] outline-none border-0 w-full"
                    style={{ ...inputStyle, ...dashLineStyle }} />
                  <span style={labelStyle}>Effective Date:</span>
                  <input type="text" value={cfg.effective_date ?? ''} onChange={e => onCfgChange({ effective_date: e.target.value })}
                    placeholder="MM/DD/YYYY"
                    className="bg-transparent leading-6 placeholder:text-[#ccc] outline-none border-0 w-full"
                    style={{ ...inputStyle, ...dashLineStyle }} />
                </div>
              ) : (
                <div className="leading-6" style={{ color: memoColor, fontSize: memoSize }}>
                  {cfg.release_date   && <p style={{ marginBottom: memoGap }}><span style={{ fontWeight: memoW }}>Release Date:</span>   {cfg.release_date}</p>}
                  {cfg.effective_date && <p style={{ marginBottom: memoGap }}><span style={{ fontWeight: memoW }}>Effective Date:</span> {cfg.effective_date}</p>}
                </div>
              )}
            </div>
            <div className="mx-[96px] border-b border-[#e0e0e0]" />
            {/* Memo to / subject */}
            <div className="px-[96px] py-2">
              {canEdit ? (
                <div className="grid leading-6" style={gridStyle}>
                  <span style={labelStyle}>Memorandum For:</span>
                  <input type="text" value={cfg.memo_to ?? ''} onChange={e => onCfgChange({ memo_to: e.target.value })}
                    placeholder="Department Personnel"
                    className="bg-transparent leading-6 placeholder:text-[#ccc] outline-none border-0 w-full"
                    style={{ ...inputStyle, ...dashLineStyle }} />
                  <span style={labelStyle}>Subject:</span>
                  <input type="text" value={cfg.memo_subject ?? ''} onChange={e => onCfgChange({ memo_subject: e.target.value })}
                    placeholder="Document subject"
                    className="bg-transparent leading-6 placeholder:text-[#ccc] outline-none border-0 w-full"
                    style={{ ...inputStyle, ...dashLineStyle }} />
                </div>
              ) : (
                <div className="leading-6" style={{ color: memoColor, fontSize: memoSize }}>
                  {cfg.memo_to      && <p style={{ marginBottom: memoGap }}><span style={{ fontWeight: memoW }}>Memorandum For:</span> {cfg.memo_to}</p>}
                  {cfg.memo_subject && <p style={{ marginBottom: memoGap }}><span style={{ fontWeight: memoW }}>Subject:</span>        {cfg.memo_subject}</p>}
                </div>
              )}
            </div>
            <div className="mx-[96px] border-b border-[#e0e0e0]" />
          </>
        );
      })())}
    </div>
  );
};

// ── Header edit panel ─────────────────────────────────────────────────────────
const HeaderEditPanel = ({
  cfg, onCfgChange, onClose,
}: {
  cfg: HeaderConfig;
  onCfgChange: (patch: Partial<HeaderConfig>) => void;
  onClose: () => void;
}) => {
  const layout   = cfg.layout   ?? 'logo-left';
  const logoSize = cfg.logo_size ?? 'md';

  const layouts: { id: HeaderLayout; label: string; icon: React.ReactNode }[] = [
    { id: 'logo-left',   label: 'Logo left',   icon: <span className="flex items-center gap-0.5"><span className="h-3 w-3 rounded-sm bg-current" /><span className="flex flex-col gap-0.5"><span className="h-1 w-5 rounded bg-current opacity-60" /><span className="h-0.5 w-4 rounded bg-current opacity-40" /></span></span> },
    { id: 'logo-right',  label: 'Logo right',  icon: <span className="flex items-center gap-0.5"><span className="flex flex-col gap-0.5"><span className="h-1 w-5 rounded bg-current opacity-60" /><span className="h-0.5 w-4 rounded bg-current opacity-40" /></span><span className="h-3 w-3 rounded-sm bg-current" /></span> },
    { id: 'logo-center', label: 'Centered',    icon: <span className="flex flex-col items-center gap-0.5"><span className="h-3 w-3 rounded-sm bg-current" /><span className="h-1 w-6 rounded bg-current opacity-60" /></span> },
    { id: 'text-only',   label: 'Text only',   icon: <span className="flex flex-col gap-0.5"><span className="h-1 w-7 rounded bg-current opacity-80" /><span className="h-0.5 w-5 rounded bg-current opacity-50" /></span> },
    { id: 'none',        label: 'None',        icon: <span className="text-[10px] text-[#80868b]">—</span> },
  ];

  return (
    <div className="mx-14 mb-4 rounded-lg border border-[#dadce0] bg-[#f8f9fa] p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#80868b]">Header Options</span>
        <button type="button" onClick={onClose} className="rounded p-0.5 text-[#80868b] hover:text-[#444746] hover:bg-[#e8eaed] transition-colors">
          <span className="text-xs font-bold">✕</span>
        </button>
      </div>

      {/* Layout */}
      <div className="mb-3">
        <p className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-[#80868b]">Layout</p>
        <div className="flex gap-1.5 flex-wrap">
          {layouts.map(l => (
            <button key={l.id} type="button" onClick={() => onCfgChange({ layout: l.id })}
              className={`flex flex-col items-center gap-1 rounded-lg border px-3 py-2 transition-all ${
                layout === l.id ? 'border-[#1a73e8] bg-[#e8f0fe] text-[#1a73e8]' : 'border-[#dadce0] bg-white text-[#444746] hover:border-[#80868b]'
              }`}>
              {l.icon}
              <span className="text-[9px] font-semibold whitespace-nowrap">{l.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Text alignment */}
      {layout !== 'none' && (
        <div className="mb-3">
          <p className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-[#80868b]">Text Alignment</p>
          <div className="flex gap-1.5">
            {([
              { id: 'left' as const,   icon: <AlignLeft className="h-3.5 w-3.5" />,   label: 'Left' },
              { id: 'center' as const, icon: <AlignCenter className="h-3.5 w-3.5" />, label: 'Center' },
              { id: 'right' as const,  icon: <AlignRight className="h-3.5 w-3.5" />,  label: 'Right' },
            ]).map(a => (
              <button key={a.id} type="button" onClick={() => onCfgChange({ text_align: a.id })} title={a.label}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all ${
                  (cfg.text_align ?? 'left') === a.id ? 'border-[#1a73e8] bg-[#e8f0fe] text-[#1a73e8]' : 'border-[#dadce0] bg-white text-[#444746] hover:border-[#80868b]'
                }`}>
                {a.icon}{a.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Logo size */}
      {layout !== 'text-only' && layout !== 'none' && (
        <div className="mb-3">
          <p className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-[#80868b]">Logo Size</p>
          <div className="flex gap-1.5">
            {(['sm', 'md', 'lg'] as LogoSize[]).map(s => (
              <button key={s} type="button" onClick={() => onCfgChange({ logo_size: s })}
                className={`rounded-lg border px-4 py-1.5 text-xs font-semibold transition-all ${
                  logoSize === s ? 'border-[#1a73e8] bg-[#e8f0fe] text-[#1a73e8]' : 'border-[#dadce0] bg-white text-[#444746] hover:border-[#80868b]'
                }`}>
                {s === 'sm' ? 'Small' : s === 'md' ? 'Medium' : 'Large'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Divider toggle */}
      {layout !== 'none' && (
        <label className="flex cursor-pointer items-center gap-2">
          <div onClick={() => onCfgChange({ show_divider: !(cfg.show_divider ?? true) })}
            className={`relative h-4 w-7 rounded-full transition-colors ${(cfg.show_divider ?? true) ? 'bg-[#1a73e8]' : 'bg-[#bdc1c6]'}`}>
            <div className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${(cfg.show_divider ?? true) ? 'translate-x-3' : 'translate-x-0.5'}`} />
          </div>
          <span className="text-[10px] font-medium text-[#444746]">Show divider line</span>
        </label>
      )}
    </div>
  );
};

// ── Memo layout editor ────────────────────────────────────────────────────────
const MemoLayoutEditor = ({
  cfg, onCfgChange, onClose,
}: {
  cfg: HeaderConfig;
  onCfgChange: (patch: Partial<HeaderConfig>) => void;
  onClose: () => void;
}) => {
  const defaultRows = (): MemoRow[] => [
    { kind: 'divider' },
    { kind: 'field', label: 'Release Date:',   value: cfg.release_date   ?? '' },
    { kind: 'field', label: 'Effective Date:', value: cfg.effective_date ?? '' },
    { kind: 'divider' },
    { kind: 'field', label: 'Memorandum For:', value: cfg.memo_to      ?? '' },
    { kind: 'field', label: 'Subject:',        value: cfg.memo_subject ?? '' },
    { kind: 'divider' },
  ];

  const [rows, setRows]       = useState<MemoRow[]>(() => cfg.memo_rows ? [...cfg.memo_rows] : defaultRows());
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const save = () => { onCfgChange({ memo_rows: rows }); onClose(); };

  const updateRow = (i: number, patch: Partial<Extract<MemoRow, { kind: 'field' }>>) =>
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const patchRow  = (i: number, patch: Record<string, unknown>) =>
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const remove = (i: number) => setRows(prev => prev.filter((_, idx) => idx !== i));

  const moveUp = (i: number) => {
    if (i === 0) return;
    setRows(prev => { const n = [...prev]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; });
  };
  const moveDown = (i: number) => {
    setRows(prev => {
      if (i >= prev.length - 1) return prev;
      const n = [...prev]; [n[i], n[i + 1]] = [n[i + 1], n[i]]; return n;
    });
  };

  /* ── Drag handlers ────────────────────────────────────────────────────────── */
  const handleDragStart = (e: React.DragEvent, i: number) => {
    setDragIdx(i);
    e.dataTransfer.effectAllowed = 'move';
    // Use an empty image so the browser ghost is invisible; we paint our own highlight
    const ghost = document.createElement('div');
    ghost.style.position = 'absolute';
    ghost.style.top = '-9999px';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    setTimeout(() => document.body.removeChild(ghost), 0);
  };
  const handleDragOver = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setOverIdx(i);
  };
  const handleDrop = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === i) { setDragIdx(null); setOverIdx(null); return; }
    setRows(prev => {
      const n = [...prev];
      const [item] = n.splice(dragIdx, 1);
      const target = dragIdx < i ? i - 1 : i;
      n.splice(target, 0, item);
      return n;
    });
    setDragIdx(null);
    setOverIdx(null);
  };
  const handleDragEnd = () => { setDragIdx(null); setOverIdx(null); };

  const addField    = () => setRows(prev => [...prev, { kind: 'field', label: 'Label:', value: '' }]);
  const addDivider  = () => setRows(prev => [...prev, { kind: 'divider' }]);
  const addGap      = () => setRows(prev => [...prev, { kind: 'gap', size: 16 }]);
  const addText     = () => setRows(prev => [...prev, { kind: 'text', text: '' }]);
  const clearCustom = () => { onCfgChange({ memo_rows: undefined }); onClose(); };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-[2px]"
      onMouseDown={e => { if (e.target === e.currentTarget) save(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-[700px] max-h-[85vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e0e0e0] bg-[#f8f9fa]">
          <div>
            <p className="text-[13px] font-semibold text-[#202124]">Edit Memo Layout</p>
            <p className="text-[11px] text-[#80868b] mt-0.5">
              Drag the grip handle or use the arrows to reorder rows
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setRows(defaultRows())}
              className="rounded-lg border border-[#dadce0] bg-white px-3 py-1.5 text-[11px] font-medium text-[#444746] hover:bg-[#e8eaed] transition-colors">
              Reset to default
            </button>
            <button type="button" onClick={save}
              className="rounded-lg bg-[#1a73e8] px-3 py-1.5 text-[11px] font-medium text-white hover:bg-[#1557b0] transition-colors">
              Done
            </button>
          </div>
        </div>

        {/* Column labels */}
        <div className="px-5 pt-3 pb-1 flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-[#9aa0a6]">
          <span className="w-14 shrink-0" />
          <span className="flex-1">Label</span>
          <span className="flex-1">Pre-filled value</span>
          <span className="w-[120px] shrink-0 text-center">Formatting</span>
          <span className="w-6 shrink-0" />
        </div>

        {/* Row list */}
        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {rows.length === 0 && (
            <p className="text-center text-[12px] text-[#9aa0a6] py-10">
              No rows yet — add a field or divider below
            </p>
          )}
          {rows.map((row, i) => {
            const isDragging = dragIdx === i;
            const isTarget   = overIdx === i && dragIdx !== null && dragIdx !== i;
            return (
              <div key={i}>
                {/* Drop-above indicator */}
                <div className={`h-0.5 rounded-full mx-1 transition-all duration-100 ${isTarget ? 'bg-[#1a73e8] my-0.5' : 'bg-transparent my-0'}`} />

                <div
                  draggable
                  onDragStart={e => handleDragStart(e, i)}
                  onDragOver={e => handleDragOver(e, i)}
                  onDrop={e => handleDrop(e, i)}
                  onDragEnd={handleDragEnd}
                  className={`group flex items-center gap-2 rounded-xl px-2 py-1 -mx-2 transition-all duration-100
                    ${isDragging ? 'opacity-40 scale-[0.98] bg-[#e8f0fe]' : 'opacity-100'}
                    ${!isDragging ? 'hover:bg-[#f8f9fa]' : ''}`}
                >
                  {/* Grip + arrows combined handle */}
                  <div className="flex items-center gap-0.5 shrink-0 w-14">
                    {/* Drag grip */}
                    <div
                      className="cursor-grab active:cursor-grabbing flex items-center justify-center w-5 h-7 text-[#bdc1c6] hover:text-[#80868b] opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Drag to reorder">
                      <GripVertical className="h-4 w-4" />
                    </div>
                    {/* Up / down arrows */}
                    <div className="flex flex-col gap-0">
                      <button type="button" onClick={() => moveUp(i)} disabled={i === 0}
                        className="flex h-4 w-4 items-center justify-center text-[#bdc1c6] hover:text-[#444746] disabled:opacity-20 transition-colors">
                        <ChevronUp className="h-3 w-3" />
                      </button>
                      <button type="button" onClick={() => moveDown(i)} disabled={i === rows.length - 1}
                        className="flex h-4 w-4 items-center justify-center text-[#bdc1c6] hover:text-[#444746] disabled:opacity-20 transition-colors">
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </div>
                  </div>

                  {row.kind === 'divider' ? (
                    <div className="flex-1 flex items-center gap-2 py-1.5">
                      <div className="flex-1 h-px bg-[#dadce0]" />
                      <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-[#9aa0a6] px-1">Divider</span>
                      <div className="flex-1 h-px bg-[#dadce0]" />
                    </div>
                  ) : row.kind === 'gap' ? (
                    <div className="flex-1 flex items-center gap-3 py-1.5">
                      <span className="text-[9px] font-semibold uppercase tracking-wider text-[#9aa0a6]">Gap</span>
                      <input
                        type="number" min={4} max={120} step={1}
                        value={(row as Extract<MemoRow, { kind: 'gap' }>).size}
                        onChange={e => {
                          const v = Math.max(4, Math.min(120, Number(e.target.value)));
                          setRows(prev => prev.map((r, idx) => idx === i ? { ...r, size: v } : r));
                        }}
                        onMouseDown={e => e.stopPropagation()}
                        className="w-16 rounded-lg border border-[#dadce0] px-2 py-1 text-[11px] text-[#444746] outline-none focus:border-[#1a73e8] transition-colors text-center"
                      />
                      <span className="text-[9px] text-[#9aa0a6]">px tall&nbsp;·&nbsp;max 120 px</span>
                    </div>
                  ) : row.kind === 'text' ? (
                    <input type="text"
                      placeholder="Free text (e.g. a note, heading or instruction)"
                      value={(row as Extract<MemoRow, { kind: 'text' }>).text}
                      onChange={e => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, text: e.target.value } : r))}
                      onMouseDown={e => e.stopPropagation()}
                      className="flex-1 rounded-lg border border-[#dadce0] px-2.5 py-1.5 text-[11px] text-[#444746] placeholder:text-[#bdc1c6] outline-none focus:border-[#1a73e8] transition-colors" />
                  ) : (
                    <div className="flex-1 flex gap-2">
                      <input type="text"
                        placeholder="Label e.g. Release Date:"
                        value={(row as Extract<MemoRow, { kind: 'field' }>).label}
                        onChange={e => updateRow(i, { label: e.target.value })}
                        onMouseDown={e => e.stopPropagation()}
                        className="flex-1 rounded-lg border border-[#dadce0] px-2.5 py-1.5 text-[11px] font-medium text-[#202124] placeholder:text-[#bdc1c6] outline-none focus:border-[#1a73e8] transition-colors" />
                      <input type="text"
                        placeholder="Value (or leave blank)"
                        value={(row as Extract<MemoRow, { kind: 'field' }>).value}
                        onChange={e => updateRow(i, { value: e.target.value })}
                        onMouseDown={e => e.stopPropagation()}
                        className="flex-1 rounded-lg border border-[#dadce0] px-2.5 py-1.5 text-[11px] text-[#444746] placeholder:text-[#bdc1c6] outline-none focus:border-[#1a73e8] transition-colors" />
                    </div>
                  )}

                  {/* Per-row formatting */}
                  {row.kind === 'field' ? (() => {
                    const fr = row as Extract<MemoRow, { kind: 'field' }>;
                    const mkSwatch = (key: 'labelColor' | 'valueColor', title: string) => (
                      <div className="relative shrink-0" title={title}>
                        <input type="color" value={fr[key] ?? '#000000'}
                          onChange={e => patchRow(i, { [key]: e.target.value })}
                          onMouseDown={e => e.stopPropagation()}
                          className="h-5 w-7 cursor-pointer rounded border border-[#dadce0] bg-white p-0.5" />
                        {fr[key] && (
                          <button type="button" title="Reset" onClick={() => patchRow(i, { [key]: undefined })}
                            className="absolute -top-1 -right-1 h-3 w-3 flex items-center justify-center rounded-full bg-[#bdc1c6] text-white hover:bg-[#444746] text-[7px] leading-none">×</button>
                        )}
                      </div>
                    );
                    const mkB = (key: 'labelBold' | 'valueBold', title: string, sub: string) => (
                      <button type="button" onClick={() => patchRow(i, { [key]: !fr[key] })} title={title}
                        className={`h-5 w-6 flex items-center justify-center rounded text-[9px] font-bold border transition-colors ${fr[key] ? 'border-[#1a73e8] bg-[#e8f0fe] text-[#1a73e8]' : 'border-[#dadce0] bg-white text-[#444746] hover:border-[#80868b]'}`}>
                        B<span className="text-[6px] font-normal leading-none">{sub}</span>
                      </button>
                    );
                    const mkU = (key: 'labelUnderline' | 'valueUnderline', title: string, sub: string) => (
                      <button type="button" onClick={() => patchRow(i, { [key]: !fr[key] })} title={title}
                        className={`h-5 w-6 flex items-center justify-center rounded text-[9px] border transition-colors underline decoration-[1.5px] underline-offset-1 ${fr[key] ? 'border-[#1a73e8] bg-[#e8f0fe] text-[#1a73e8] font-semibold' : 'border-[#dadce0] bg-white text-[#444746] hover:border-[#80868b]'}`}>
                        U<span className="text-[6px] font-normal leading-none no-underline">{sub}</span>
                      </button>
                    );
                    return (
                      <div className="flex flex-col gap-1 shrink-0 w-[120px]">
                        {/* Label row */}
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] font-black text-[#444746] w-3 shrink-0 leading-none">L</span>
                          {mkSwatch('labelColor', 'Label colour')}
                          {mkB('labelBold', 'Bold label', '')}
                          {mkU('labelUnderline', 'Underline label', '')}
                        </div>
                        {/* Value row */}
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] font-black text-[#444746] w-3 shrink-0 leading-none">V</span>
                          {mkSwatch('valueColor', 'Value colour')}
                          {mkB('valueBold', 'Bold value', '')}
                          {mkU('valueUnderline', 'Underline value', '')}
                        </div>
                      </div>
                    );
                  })() : row.kind === 'text' ? (
                    <div className="flex items-center gap-1 shrink-0 w-[120px]">
                      <div className="relative shrink-0" title="Text colour">
                        <input type="color" value={(row as Extract<MemoRow, { kind: 'text' }>).color ?? '#000000'}
                          onChange={e => patchRow(i, { color: e.target.value })}
                          onMouseDown={e => e.stopPropagation()}
                          className="h-6 w-8 cursor-pointer rounded border border-[#dadce0] bg-white p-0.5" />
                        {(row as Extract<MemoRow, { kind: 'text' }>).color && (
                          <button type="button" title="Reset colour" onClick={() => patchRow(i, { color: undefined })}
                            className="absolute -top-1 -right-1 h-3 w-3 flex items-center justify-center rounded-full bg-[#bdc1c6] text-white hover:bg-[#444746] text-[7px] leading-none">×</button>
                        )}
                      </div>
                      <button type="button"
                        onClick={() => patchRow(i, { bold: !(row as Extract<MemoRow, { kind: 'text' }>).bold })}
                        title="Toggle bold"
                        className={`h-6 w-7 flex items-center justify-center rounded text-[11px] font-bold border transition-colors ${(row as Extract<MemoRow, { kind: 'text' }>).bold ? 'border-[#1a73e8] bg-[#e8f0fe] text-[#1a73e8]' : 'border-[#dadce0] bg-white text-[#444746] hover:border-[#80868b]'}`}>B</button>
                      <button type="button"
                        onClick={() => patchRow(i, { underline: !(row as Extract<MemoRow, { kind: 'text' }>).underline })}
                        title="Toggle underline"
                        className={`h-6 w-7 flex items-center justify-center rounded text-[11px] border transition-colors underline decoration-[1.5px] underline-offset-2 ${(row as Extract<MemoRow, { kind: 'text' }>).underline ? 'border-[#1a73e8] bg-[#e8f0fe] text-[#1a73e8] font-semibold' : 'border-[#dadce0] bg-white text-[#444746] hover:border-[#80868b]'}`}>U</button>
                    </div>
                  ) : (
                    <div className="w-[120px] shrink-0" />
                  )}

                  <button type="button" onClick={() => remove(i)}
                    className="shrink-0 w-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-full p-0.5 text-[#bdc1c6] hover:text-red-500 hover:bg-red-50">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
          {/* Drop zone at the very bottom */}
          {dragIdx !== null && (
            <div
              className="h-8 rounded-xl border-2 border-dashed border-[#bdc1c6] mt-1 flex items-center justify-center"
              onDragOver={e => { e.preventDefault(); setOverIdx(rows.length); }}
              onDrop={e => handleDrop(e, rows.length)}
            >
              <span className="text-[9px] text-[#9aa0a6] uppercase tracking-widest">Drop here to move to end</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-[#e0e0e0] bg-[#f8f9fa] flex items-center gap-2 flex-wrap">
          <button type="button" onClick={addField}
            className="flex items-center gap-1.5 rounded-lg border border-[#dadce0] bg-white px-3 py-1.5 text-[11px] font-medium text-[#444746] hover:bg-[#e8eaed] transition-colors">
            <Plus className="h-3.5 w-3.5" /> Add Field Row
          </button>
          <button type="button" onClick={addDivider}
            className="flex items-center gap-1.5 rounded-lg border border-[#dadce0] bg-white px-3 py-1.5 text-[11px] font-medium text-[#444746] hover:bg-[#e8eaed] transition-colors">
            <SeparatorHorizontal className="h-3.5 w-3.5" /> Add Divider
          </button>
          <button type="button" onClick={addGap}
            className="flex items-center gap-1.5 rounded-lg border border-[#dadce0] bg-white px-3 py-1.5 text-[11px] font-medium text-[#444746] hover:bg-[#e8eaed] transition-colors">
            <ChevronsUpDown className="h-3.5 w-3.5" /> Add Gap
          </button>
          <button type="button" onClick={addText}
            className="flex items-center gap-1.5 rounded-lg border border-[#dadce0] bg-white px-3 py-1.5 text-[11px] font-medium text-[#444746] hover:bg-[#e8eaed] transition-colors">
            <Type className="h-3.5 w-3.5" /> Add Text
          </button>
          {cfg.memo_rows && (
            <button type="button" onClick={clearCustom}
              className="ml-auto text-[11px] font-medium text-red-500 hover:text-red-700 transition-colors">
              Clear custom layout
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Page Style panel ──────────────────────────────────────────────────────────
const PageStylePanel = ({
  cfg, onCfgChange, onClose, numPages,
}: {
  cfg: HeaderConfig;
  onCfgChange: (patch: Partial<HeaderConfig>) => void;
  onClose: () => void;
  numPages: number;
}) => {
  // ── Per-page draft state ───────────────────────────────────────────────────
  // `editingPages` = which pages the controls below are editing.
  // `draft`        = local copy of those pages' effective style (not yet saved).
  // `isDirty`      = draft differs from what is committed.
  // `warnUnsaved`  = user tried to switch pages without saving first.
  const [editingPages, setEditingPages] = useState<'all' | number[]>('all');
  const [draft, setDraft]               = useState<HeaderConfig>(() => ({ ...cfg }));
  const [isDirty, setIsDirty]           = useState(false);
  const [warnUnsaved, setWarnUnsaved]   = useState(false);
  const [showMemoEditor, setShowMemoEditor] = useState(false);

  const cornerInputRef    = useRef<HTMLInputElement>(null);
  const watermarkInputRef = useRef<HTMLInputElement>(null);
  const bgDesignInputRef  = useRef<HTMLInputElement>(null);

  // Reload the draft whenever the editing selection changes (after a save).
  const loadDraftForSelection = useCallback((pages: 'all' | number[], base: HeaderConfig) => {
    if (pages === 'all') {
      setDraft({ ...base });
    } else {
      const firstPage = Array.isArray(pages) ? pages[0] : null;
      setDraft(firstPage != null ? resolvePageCfg(base, firstPage) : { ...base });
    }
    setIsDirty(false);
    setWarnUnsaved(false);
  }, []);

  // Write a patch into the local draft (does NOT commit to parent).
  const updateDraft = useCallback((patch: Partial<HeaderConfig>) => {
    setDraft(prev => ({ ...prev, ...patch }));
    setIsDirty(true);
    setWarnUnsaved(false);
  }, []);

  // Commit draft to parent state.
  const handleSave = useCallback(() => {
    if (editingPages === 'all') {
      // Update base config, preserving existing per-page overrides.
      const { page_overrides: _, ...rest } = draft;
      onCfgChange({ ...rest, page_overrides: cfg.page_overrides });
    } else {
      // Write the draft as a per-page override for every selected page.
      const pages = Array.isArray(editingPages) ? editingPages : [];
      const existingOverrides = cfg.page_overrides ?? {};
      const newOverrides = { ...existingOverrides };
      const { page_overrides: _, ...patch } = draft;
      pages.forEach(p => { newOverrides[String(p)] = patch; });
      onCfgChange({ page_overrides: newOverrides });
    }
    setIsDirty(false);
    setWarnUnsaved(false);
  }, [editingPages, draft, cfg.page_overrides, onCfgChange]);

  // Attempt to switch the editing selection; block if there are unsaved changes.
  const trySetEditingPages = useCallback((next: 'all' | number[]) => {
    if (isDirty) { setWarnUnsaved(true); return; }
    setEditingPages(next);
    loadDraftForSelection(next, cfg);
  }, [isDirty, loadDraftForSelection, cfg]);

  // Toggle a single page number into/out of the current multi-selection.
  const togglePage = useCallback((pn: number) => {
    const current = editingPages === 'all' ? [] : editingPages;
    const isSelected = current.includes(pn);
    const next = isSelected ? current.filter(p => p !== pn) : [...current, pn].sort((a, b) => a - b);
    trySetEditingPages(next.length === 0 ? 'all' : next);
  }, [editingPages, trySetEditingPages]);

  // File-upload helpers — write into local draft.
  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleCornerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    updateDraft({ corner_logo_url: await readFileAsDataUrl(file) });
    e.target.value = '';
  };
  const handleWatermarkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    updateDraft({ watermark_url: await readFileAsDataUrl(file) });
    e.target.value = '';
  };
  const handleBgDesignUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    updateDraft({ bg_design: 'custom', bg_design_url: await readFileAsDataUrl(file) });
    e.target.value = '';
  };

  const Toggle = ({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) => (
    <label className="flex cursor-pointer items-center gap-2">
      <div onClick={onToggle}
        className={`relative h-4 w-7 rounded-full transition-colors ${on ? 'bg-[#1a73e8]' : 'bg-[#bdc1c6]'}`}>
        <div className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-3' : 'translate-x-0.5'}`} />
      </div>
      <span className="text-[10px] font-medium text-[#444746]">{label}</span>
    </label>
  );

  const isAllSelected    = editingPages === 'all';
  const selectedPagesSet = new Set(isAllSelected ? [] : editingPages);
  const selectionLabel   = isAllSelected
    ? 'All pages'
    : editingPages.length === 1
      ? `Page ${editingPages[0]}`
      : `Pages ${editingPages.join(', ')}`;

  return (
    <div className="mx-14 mb-4 rounded-lg border border-[#dadce0] bg-[#f8f9fa] p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#80868b]">Page Style</span>
        <button type="button" onClick={onClose} className="rounded p-0.5 text-[#80868b] hover:text-[#444746] hover:bg-[#e8eaed] transition-colors">
          <span className="text-xs font-bold">✕</span>
        </button>
      </div>

      {/* ── Apply Style To ────────────────────────────────────────────────── */}
      <div className="mb-3 rounded-md border border-[#dadce0] bg-white p-2.5">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[9px] font-bold uppercase tracking-widest text-[#80868b]">Apply Style To</p>
          <div className="flex items-center gap-1.5">
            {isDirty && (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">unsaved</span>
            )}
            <button
              type="button"
              disabled={!isDirty}
              onClick={handleSave}
              className={`rounded border px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                isDirty
                  ? 'border-[#1a73e8] bg-[#1a73e8] text-white hover:bg-[#1557b0]'
                  : 'border-[#dadce0] bg-white text-[#bdc1c6] cursor-not-allowed'
              }`}>
              Save
            </button>
          </div>
        </div>

        {/* Unsaved-changes warning shown when user tries to switch pages */}
        {warnUnsaved && (
          <div className="mb-2 rounded border border-amber-300 bg-amber-50 px-2 py-1.5">
            <span className="text-[10px] font-medium text-amber-700">Save your changes before switching pages.</span>
          </div>
        )}

        <div className="flex flex-wrap gap-1">
          {/* All button */}
          <button type="button"
            onClick={() => trySetEditingPages('all')}
            className={`rounded border px-2 py-0.5 text-[10px] font-medium transition-colors ${
              isAllSelected ? 'border-[#1a73e8] bg-[#e8f0fe] text-[#1a73e8]' : 'border-[#dadce0] bg-white text-[#444746] hover:border-[#80868b]'
            }`}>
            All
          </button>
          {/* One button per page — blue dot when that page has a saved override */}
          {Array.from({ length: numPages }, (_, i) => {
            const pn = i + 1;
            const isSelected  = selectedPagesSet.has(pn);
            const hasOverride = !!(cfg.page_overrides?.[String(pn)]);
            return (
              <button key={pn} type="button"
                onClick={() => togglePage(pn)}
                className={`relative rounded border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  isSelected ? 'border-[#1a73e8] bg-[#e8f0fe] text-[#1a73e8]' : 'border-[#dadce0] bg-white text-[#444746] hover:border-[#80868b]'
                }`}>
                Page {pn}
                {hasOverride && (
                  <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-[#1a73e8] border border-white" title="Has custom style" />
                )}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[9px] text-[#9aa0a6]">
          Editing: <span className="font-medium text-[#5f6368]">{selectionLabel}</span>
          {!isAllSelected && <span className="ml-1">· click multiple pages to share one style</span>}
        </p>
      </div>

      {/* ── Style controls — all read from / write to `draft` ──────────────── */}
      <div className="grid grid-cols-2 gap-4">
        {/* Left column */}
        <div className="space-y-3">

          {/* Memo Header — only relevant when editing All or page 1 */}
          {(isAllSelected || selectedPagesSet.has(1)) && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[9px] font-bold uppercase tracking-widest text-[#80868b]">Memo Header</p>
              {draft.memo_mode && (
                <button type="button" onClick={() => setShowMemoEditor(true)}
                  className="flex items-center gap-1 rounded border border-[#dadce0] bg-white px-2 py-0.5 text-[9px] font-medium text-[#444746] hover:bg-[#e8eaed] hover:border-[#80868b] transition-colors">
                  <Pencil className="h-2.5 w-2.5" /> Edit Layout
                </button>
              )}
            </div>
            <Toggle label="Show memo fields (dates, addressee, subject)"
              on={!!draft.memo_mode} onToggle={() => updateDraft({ memo_mode: !draft.memo_mode })} />
            {draft.memo_mode && (
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <label className="text-[9px] font-medium text-[#80868b]">Colour</label>
                  <input type="color" value={draft.memo_color ?? '#222222'}
                    onChange={e => updateDraft({ memo_color: e.target.value })}
                    className="h-6 w-10 cursor-pointer rounded border border-[#dadce0] bg-white p-0.5" />
                  <span className="text-[9px] text-[#80868b] font-mono">{draft.memo_color ?? '#222222'}</span>
                  <button type="button"
                    onClick={() => updateDraft({ memo_bold: !draft.memo_bold })}
                    className={`ml-auto shrink-0 rounded border px-2 py-1 text-[10px] font-bold transition-colors ${
                      draft.memo_bold ? 'border-[#1a73e8] bg-[#e8f0fe] text-[#1a73e8]' : 'border-[#dadce0] bg-white text-[#444746] hover:border-[#80868b]'
                    }`}>B</button>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px] font-medium text-[#80868b] uppercase tracking-widest">Text Size</span>
                    <span className="text-[10px] font-semibold text-[#444746]">{draft.memo_size ?? 10.5}pt</span>
                  </div>
                  <input type="range" min={7} max={16} step={0.5}
                    value={draft.memo_size ?? 10.5}
                    onChange={e => updateDraft({ memo_size: Number(e.target.value) })}
                    className="w-full h-1.5 accent-[#1a73e8] cursor-pointer" />
                  <div className="flex justify-between mt-0.5">
                    <span className="text-[8px] text-[#9aa0a6]">Small</span>
                    <span className="text-[8px] text-[#9aa0a6]">Large</span>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px] font-medium text-[#80868b] uppercase tracking-widest">Row Spacing</span>
                    <span className="text-[10px] font-semibold text-[#444746]">{draft.memo_gap ?? 4}px</span>
                  </div>
                  <input type="range" min={0} max={20} step={1}
                    value={draft.memo_gap ?? 4}
                    onChange={e => updateDraft({ memo_gap: Number(e.target.value) })}
                    className="w-full h-1.5 accent-[#1a73e8] cursor-pointer" />
                  <div className="flex justify-between mt-0.5">
                    <span className="text-[8px] text-[#9aa0a6]">Compact</span>
                    <span className="text-[8px] text-[#9aa0a6]">Spacious</span>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px] font-medium text-[#80868b] uppercase tracking-widest">Dash Size</span>
                    <span className="text-[10px] font-semibold text-[#444746]">{draft.memo_dash_size ?? 4}px</span>
                  </div>
                  <input type="range" min={2} max={16} step={1}
                    value={draft.memo_dash_size ?? 4}
                    onChange={e => updateDraft({ memo_dash_size: Number(e.target.value) })}
                    className="w-full h-1.5 accent-[#1a73e8] cursor-pointer" />
                  <div className="flex justify-between mt-0.5">
                    <span className="text-[8px] text-[#9aa0a6]">Short ···</span>
                    <span className="text-[8px] text-[#9aa0a6]">Long ———</span>
                  </div>
                  {(() => {
                    const sz = draft.memo_dash_size ?? 4;
                    return (
                      <div className="mt-2 px-1">
                        <div className="h-px w-full" style={{
                          backgroundImage: `repeating-linear-gradient(to right, #555 0px, #555 ${sz}px, transparent ${sz}px, transparent ${sz * 2}px)`,
                          backgroundSize: '100% 1px',
                          backgroundRepeat: 'repeat-x',
                        }} />
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
          )}

          <div>
            <p className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-[#80868b]">Page Texture</p>
            <Toggle label="Diagonal crosshatch background"
              on={draft.page_texture === 'crosshatch'}
              onToggle={() => updateDraft({ page_texture: draft.page_texture === 'crosshatch' ? 'none' : 'crosshatch' })} />
          </div>

          <div>
            <p className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-[#80868b]">Background Design</p>
            <input ref={bgDesignInputRef} type="file" accept="image/*" className="hidden" onChange={handleBgDesignUpload} />
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-col gap-1">
                <button type="button"
                  onClick={() => updateDraft({ bg_design: 'none', bg_design_url: undefined })}
                  className={`flex items-center gap-2 rounded border px-2 py-1.5 text-left transition-colors ${
                    (!draft.bg_design || draft.bg_design === 'none')
                      ? 'border-[#1a73e8] bg-[#e8f0fe] text-[#1a73e8]'
                      : 'border-[#dadce0] bg-white text-[#444746] hover:border-[#80868b]'
                  }`}>
                  <span className="h-6 w-9 shrink-0 rounded border border-[#dadce0]"
                    style={{ background: draft.bg_color ?? '#ffffff' }} />
                  <span className="text-[10px] font-medium">None — solid colour</span>
                </button>
                {(!draft.bg_design || draft.bg_design === 'none') && (
                  <div className="flex items-center gap-2 pl-1">
                    <label className="relative flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded border border-[#dadce0] overflow-hidden"
                      style={{ background: draft.bg_color ?? '#ffffff' }} title="Pick page colour">
                      <input type="color" value={draft.bg_color ?? '#ffffff'}
                        onChange={e => updateDraft({ bg_color: e.target.value })}
                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
                    </label>
                    <span className="text-[10px] text-[#5f6368] font-mono">{draft.bg_color ?? '#ffffff'}</span>
                    {draft.bg_color && draft.bg_color !== '#ffffff' && (
                      <button type="button" onClick={() => updateDraft({ bg_color: '#ffffff' })}
                        className="ml-auto text-[9px] font-medium text-[#80868b] hover:text-[#444746]">Reset</button>
                    )}
                  </div>
                )}
              </div>

              <button type="button"
                onClick={() => updateDraft({ bg_design: 'default', bg_design_url: undefined })}
                className={`flex items-center gap-2 rounded border px-2 py-1.5 text-left transition-colors ${
                  draft.bg_design === 'default'
                    ? 'border-[#1a73e8] bg-[#e8f0fe] text-[#1a73e8]'
                    : 'border-[#dadce0] bg-white text-[#444746] hover:border-[#80868b]'
                }`}>
                <span className="h-6 w-9 shrink-0 rounded border border-[#dadce0] overflow-hidden" style={{
                  background: `repeating-linear-gradient(-45deg, transparent 0px, transparent 3px, rgba(255,255,255,0.7) 3px, rgba(255,255,255,0.7) 4px), linear-gradient(155deg,#e8ebf0 0%,#f5f7fa 50%,#edf0f5 100%)`,
                }} />
                <span className="text-[10px] font-medium">Default — DPS diagonal lines</span>
              </button>

              <button type="button"
                onClick={() => bgDesignInputRef.current?.click()}
                className={`flex items-center gap-2 rounded border px-2 py-1.5 text-left transition-colors ${
                  draft.bg_design === 'custom'
                    ? 'border-[#1a73e8] bg-[#e8f0fe] text-[#1a73e8]'
                    : 'border-[#dadce0] bg-white text-[#444746] hover:border-[#80868b]'
                }`}>
                {draft.bg_design === 'custom' && draft.bg_design_url
                  ? <img src={draft.bg_design_url} alt="" className="h-6 w-9 shrink-0 rounded border border-[#dadce0] object-cover" />
                  : <span className="h-6 w-9 shrink-0 rounded border-2 border-dashed border-[#dadce0] flex items-center justify-center">
                      <Upload className="h-2.5 w-2.5 text-[#80868b]" />
                    </span>
                }
                <span className="text-[10px] font-medium">
                  {draft.bg_design === 'custom' ? 'Custom — click to change' : 'Custom — upload image'}
                </span>
              </button>

              {draft.bg_design === 'custom' && draft.bg_design_url && (
                <button type="button"
                  onClick={() => updateDraft({ bg_design: 'none', bg_design_url: undefined })}
                  className="self-start text-[9px] font-medium text-red-500 hover:text-red-700 ml-1">
                  Remove custom background
                </button>
              )}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-[#80868b]">Left Accent Bar</p>
            <Toggle label="Show left accent bar"
              on={!!draft.left_bar} onToggle={() => updateDraft({ left_bar: !draft.left_bar })} />
            {draft.left_bar && (
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <label className="text-[9px] font-medium text-[#80868b]">Colour</label>
                  <input type="color" value={draft.left_bar_color ?? '#1a3f6f'}
                    onChange={e => updateDraft({ left_bar_color: e.target.value })}
                    className="h-6 w-10 cursor-pointer rounded border border-[#dadce0] bg-white p-0.5" />
                  <span className="text-[9px] text-[#80868b] font-mono">{draft.left_bar_color ?? '#1a3f6f'}</span>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px] font-medium text-[#80868b] uppercase tracking-widest">Thickness</span>
                    <span className="text-[10px] font-semibold text-[#444746]">{draft.left_bar_width ?? 7}px</span>
                  </div>
                  <input type="range" min={2} max={24} step={1}
                    value={draft.left_bar_width ?? 7}
                    onChange={e => updateDraft({ left_bar_width: Number(e.target.value) })}
                    className="w-full h-1.5 accent-[#1a73e8] cursor-pointer" />
                  <div className="flex justify-between mt-0.5">
                    <span className="text-[8px] text-[#9aa0a6]">Thin</span>
                    <span className="text-[8px] text-[#9aa0a6]">Thick</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div>
            <p className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-[#80868b]">Footer Text</p>
            <input type="text" placeholder="© Department of Public Safety 2026"
              value={draft.footer_text ?? ''}
              onChange={e => updateDraft({ footer_text: e.target.value || undefined })}
              className="w-full rounded border border-[#dadce0] bg-white px-2 py-1 text-[11px] text-[#444746] placeholder:text-[#bdc1c6] outline-none focus:border-[#1a73e8]" />
            {draft.footer_text && (
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[9px] font-medium text-[#80868b] uppercase tracking-widest">Size</span>
                      <span className="text-[10px] font-semibold text-[#444746]">{draft.footer_size ?? 8}pt</span>
                    </div>
                    <input type="range" min={6} max={14} step={1}
                      value={draft.footer_size ?? 8}
                      onChange={e => updateDraft({ footer_size: Number(e.target.value) })}
                      className="w-full h-1.5 accent-[#1a73e8] cursor-pointer" />
                  </div>
                  <button type="button"
                    onClick={() => updateDraft({ footer_bold: !draft.footer_bold })}
                    className={`shrink-0 rounded border px-2 py-1 text-[10px] font-bold transition-colors ${
                      draft.footer_bold ? 'border-[#1a73e8] bg-[#e8f0fe] text-[#1a73e8]' : 'border-[#dadce0] bg-white text-[#444746] hover:border-[#80868b]'
                    }`}>B</button>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[9px] font-medium text-[#80868b]">Colour</label>
                  <input type="color" value={draft.footer_color ?? '#666666'}
                    onChange={e => updateDraft({ footer_color: e.target.value })}
                    className="h-6 w-10 cursor-pointer rounded border border-[#dadce0] bg-white p-0.5" />
                  <span className="text-[9px] text-[#80868b] font-mono">{draft.footer_color ?? '#666666'}</span>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px] font-medium text-[#80868b] uppercase tracking-widest">Letter Spacing</span>
                    <span className="text-[10px] font-semibold text-[#444746]">{draft.footer_letter_spacing ?? 0}px</span>
                  </div>
                  <input type="range" min={0} max={8} step={0.5}
                    value={draft.footer_letter_spacing ?? 0}
                    onChange={e => updateDraft({ footer_letter_spacing: Number(e.target.value) })}
                    className="w-full h-1.5 accent-[#1a73e8] cursor-pointer" />
                  <div className="flex justify-between mt-0.5">
                    <span className="text-[8px] text-[#9aa0a6]">Normal</span>
                    <span className="text-[8px] text-[#9aa0a6]">Wide</span>
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-[9px] font-medium text-[#80868b] uppercase tracking-widest">Dividers</p>
                  <div className="flex flex-col gap-1">
                    <Toggle label="Line above footer"
                      on={!!draft.footer_divider_above}
                      onToggle={() => updateDraft({ footer_divider_above: !draft.footer_divider_above })} />
                    <Toggle label="Line below footer"
                      on={!!draft.footer_divider_below}
                      onToggle={() => updateDraft({ footer_divider_below: !draft.footer_divider_below })} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right column: Corner logo + Watermark */}
        <div className="space-y-3">
          <div>
            <p className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-[#80868b]">Corner Logo</p>
            <input ref={cornerInputRef} type="file" accept="image/*" className="hidden" onChange={handleCornerUpload} />
            {draft.corner_logo_url ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="relative h-10 w-10 shrink-0 rounded border border-[#dadce0] bg-[#f8f9fa] overflow-hidden flex items-center justify-center">
                    <img src={draft.corner_logo_url} alt="" className="h-8 w-8 object-contain"
                      style={{ opacity: (draft.corner_logo_opacity ?? 100) / 100 }} />
                  </div>
                  <button type="button" onClick={() => cornerInputRef.current?.click()}
                    className="rounded border border-[#dadce0] bg-white px-2 py-1 text-[10px] font-medium text-[#444746] hover:bg-[#e8eaed] transition-colors">
                    Change
                  </button>
                  <button type="button"
                    onClick={() => updateDraft({ corner_logo_url: undefined, corner_logo_opacity: undefined, corner_logo_size: undefined, corner_logo_rotation: undefined })}
                    className="text-[10px] font-medium text-red-500 hover:text-red-700">Remove</button>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px] font-medium text-[#80868b] uppercase tracking-widest">Opacity</span>
                    <span className="text-[10px] font-semibold text-[#444746]">{draft.corner_logo_opacity ?? 100}%</span>
                  </div>
                  <input type="range" min={10} max={100} step={1}
                    value={draft.corner_logo_opacity ?? 100}
                    onChange={e => updateDraft({ corner_logo_opacity: Number(e.target.value) })}
                    className="w-full h-1.5 accent-[#1a73e8] cursor-pointer" />
                  <div className="flex justify-between mt-0.5">
                    <span className="text-[8px] text-[#9aa0a6]">10%</span>
                    <span className="text-[8px] text-[#9aa0a6]">100%</span>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px] font-medium text-[#80868b] uppercase tracking-widest">Size</span>
                    <span className="text-[10px] font-semibold text-[#444746]">{draft.corner_logo_size ?? 56}px</span>
                  </div>
                  <input type="range" min={24} max={160} step={4}
                    value={draft.corner_logo_size ?? 56}
                    onChange={e => updateDraft({ corner_logo_size: Number(e.target.value) })}
                    className="w-full h-1.5 accent-[#1a73e8] cursor-pointer" />
                  <div className="flex justify-between mt-0.5">
                    <span className="text-[8px] text-[#9aa0a6]">Small</span>
                    <span className="text-[8px] text-[#9aa0a6]">Large</span>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px] font-medium text-[#80868b] uppercase tracking-widest">Rotation</span>
                    <span className="text-[10px] font-semibold text-[#444746]">{draft.corner_logo_rotation ?? 0}°</span>
                  </div>
                  <input type="range" min={-180} max={180} step={1}
                    value={draft.corner_logo_rotation ?? 0}
                    onChange={e => updateDraft({ corner_logo_rotation: Number(e.target.value) })}
                    className="w-full h-1.5 accent-[#1a73e8] cursor-pointer" />
                  <div className="flex justify-between mt-0.5">
                    <span className="text-[8px] text-[#9aa0a6]">−180°</span>
                    <span className="text-[8px] text-[#9aa0a6]">+180°</span>
                  </div>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => cornerInputRef.current?.click()}
                className="flex w-full items-center justify-center gap-1.5 rounded border-2 border-dashed border-[#dadce0] bg-white py-2 text-[10px] font-medium text-[#80868b] hover:border-[#1a73e8] hover:text-[#1a73e8] transition-colors">
                <Upload className="h-3.5 w-3.5" />
                Upload image
              </button>
            )}
          </div>

          <div>
            <p className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-[#80868b]">Watermark</p>
            <input ref={watermarkInputRef} type="file" accept="image/*" className="hidden" onChange={handleWatermarkUpload} />
            {draft.watermark_url ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="relative h-10 w-10 shrink-0 rounded border border-[#dadce0] bg-[#f8f9fa] overflow-hidden flex items-center justify-center">
                    <img src={draft.watermark_url} alt="" className="h-8 w-8 object-contain"
                      style={{ opacity: (draft.watermark_opacity ?? 8) / 100 }} />
                  </div>
                  <button type="button" onClick={() => watermarkInputRef.current?.click()}
                    className="rounded border border-[#dadce0] bg-white px-2 py-1 text-[10px] font-medium text-[#444746] hover:bg-[#e8eaed] transition-colors">
                    Change
                  </button>
                  <button type="button"
                    onClick={() => updateDraft({ watermark_url: undefined, watermark_opacity: undefined, watermark_size: undefined, watermark_rotation: undefined })}
                    className="text-[10px] font-medium text-red-500 hover:text-red-700">Remove</button>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px] font-medium text-[#80868b] uppercase tracking-widest">Opacity</span>
                    <span className="text-[10px] font-semibold text-[#444746]">{draft.watermark_opacity ?? 8}%</span>
                  </div>
                  <input type="range" min={1} max={60} step={1}
                    value={draft.watermark_opacity ?? 8}
                    onChange={e => updateDraft({ watermark_opacity: Number(e.target.value) })}
                    className="w-full h-1.5 accent-[#1a73e8] cursor-pointer" />
                  <div className="flex justify-between mt-0.5">
                    <span className="text-[8px] text-[#9aa0a6]">1%</span>
                    <span className="text-[8px] text-[#9aa0a6]">60%</span>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px] font-medium text-[#80868b] uppercase tracking-widest">Size</span>
                    <span className="text-[10px] font-semibold text-[#444746]">{draft.watermark_size ?? 384}px</span>
                  </div>
                  <input type="range" min={80} max={700} step={8}
                    value={draft.watermark_size ?? 384}
                    onChange={e => updateDraft({ watermark_size: Number(e.target.value) })}
                    className="w-full h-1.5 accent-[#1a73e8] cursor-pointer" />
                  <div className="flex justify-between mt-0.5">
                    <span className="text-[8px] text-[#9aa0a6]">Small</span>
                    <span className="text-[8px] text-[#9aa0a6]">Large</span>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px] font-medium text-[#80868b] uppercase tracking-widest">Rotation</span>
                    <span className="text-[10px] font-semibold text-[#444746]">{draft.watermark_rotation ?? 0}°</span>
                  </div>
                  <input type="range" min={-180} max={180} step={1}
                    value={draft.watermark_rotation ?? 0}
                    onChange={e => updateDraft({ watermark_rotation: Number(e.target.value) })}
                    className="w-full h-1.5 accent-[#1a73e8] cursor-pointer" />
                  <div className="flex justify-between mt-0.5">
                    <span className="text-[8px] text-[#9aa0a6]">−180°</span>
                    <span className="text-[8px] text-[#9aa0a6]">+180°</span>
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-[9px] font-medium text-[#80868b] uppercase tracking-widest">Presets</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {[
                      { label: 'Subtle',   opacity: 6,  size: 320, rotation: 0   },
                      { label: 'Diagonal', opacity: 10, size: 480, rotation: -45 },
                      { label: 'Bold',     opacity: 25, size: 560, rotation: 0   },
                      { label: 'Tile',     opacity: 8,  size: 160, rotation: -30 },
                    ].map(p => (
                      <button key={p.label} type="button"
                        onClick={() => updateDraft({ watermark_opacity: p.opacity, watermark_size: p.size, watermark_rotation: p.rotation })}
                        className="rounded border border-[#dadce0] bg-white px-2 py-0.5 text-[9px] font-medium text-[#444746] hover:bg-[#e8eaed] hover:border-[#1a73e8] transition-colors">
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => watermarkInputRef.current?.click()}
                className="flex w-full items-center justify-center gap-1.5 rounded border-2 border-dashed border-[#dadce0] bg-white py-2 text-[10px] font-medium text-[#80868b] hover:border-[#1a73e8] hover:text-[#1a73e8] transition-colors">
                <Upload className="h-3.5 w-3.5" />
                Upload image
              </button>
            )}
          </div>
        </div>
      </div>
      {showMemoEditor && (
        <MemoLayoutEditor cfg={draft} onCfgChange={updateDraft} onClose={() => setShowMemoEditor(false)} />
      )}
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────
const DocumentEditor = ({
  resourceId, onClose, canEdit = true, apiBase = '/api/resources',
}: {
  resourceId: number; onClose: () => void; canEdit?: boolean; apiBase?: string;
}) => {
  const [doc, setDoc]                       = useState<ResourceDoc | null>(null);
  const [loading, setLoading]               = useState(true);
  const [title, setTitle]                   = useState('');
  const [headerCfg, setHeaderCfg]           = useState<HeaderConfig>({ layout: 'none' });
  const [showHeaderEdit, setShowHeaderEdit] = useState(false);
  const [saveStatus, setSaveStatus]         = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [headingOpen, setHeadingOpen]       = useState(false);
  const [outline, setOutline]               = useState<OutlineItem[]>([]);
  const [isEmpty, setIsEmpty]               = useState(true);

  // ── Image options panel state ──────────────────────────────────────────────
  const [imgAttrs, setImgAttrs]             = useState<ImageNodeAttrs | null>(null);
  const [imgNaturalSize, setImgNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const imgUpdaterRef = useRef<((patch: Partial<ImageNodeAttrs>) => void) | null>(null);

  // ── Multi-page + font state ───────────────────────────────────────────────────
  const [numPages, setNumPages]             = useState(1);
  const [pdfImporting, setPdfImporting]     = useState(false);
  const [wordCount, setWordCount]           = useState(0);
  const [fontFamily, setFontFamily]         = useState('Arial');
  const [fontSize, setFontSize]             = useState(11);
  const [fontFamilyOpen, setFontFamilyOpen] = useState(false);
  const [fontSizeOpen, setFontSizeOpen]     = useState(false);
  const [showPageStyle, setShowPageStyle]   = useState(false);
  const [inTable, setInTable]               = useState(false);
  const [tableGridOpen, setTableGridOpen]   = useState(false);
  const [tableGridHover, setTableGridHover] = useState({ r: 0, c: 0 });
  const [tableFillOpen, setTableFillOpen]   = useState(false);
  const [tableFillScope, setTableFillScope] = useState<'cell' | 'row' | 'col'>('cell');
  const [currentCellColor, setCurrentCellColor] = useState<string | null>(null);

  const headingRef        = useRef<HTMLDivElement>(null);
  const fontFamilyRef     = useRef<HTMLDivElement>(null);
  const fontSizeRef       = useRef<HTMLDivElement>(null);
  const tableGridRef      = useRef<HTMLDivElement>(null);
  const tableFillRef      = useRef<HTMLDivElement>(null);
  const saveTimer         = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef    = useRef<{ title?: string; logo_url?: string | null; content?: object; header_config?: HeaderConfig } | null>(null);
  const isFirstLoad       = useRef(true);
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const logoFileInputRef  = useRef<HTMLInputElement>(null);
  const pdfFileInputRef   = useRef<HTMLInputElement>(null);
  const editorScrollRef   = useRef<HTMLDivElement>(null);
  const docWrapRef        = useRef<HTMLDivElement>(null);
  const pageStylePanelRef = useRef<HTMLDivElement>(null);
  // Exposed so the window-resize listener can re-run pagination without depending on [editor]
  const paginateRef       = useRef<(() => void) | null>(null);

  // ── Load resource ──────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    fetch(`${apiBase}/${resourceId}`, { headers: { accept: 'application/json' } })
      .then(r => r.json())
      .then((d: ResourceDoc) => {
        const raw = d as ResourceDoc & { header_config?: unknown; content?: unknown };
        const headerRaw = raw.header_config;
        const contentRaw = raw.content;
        const parsedHeader =
          typeof headerRaw === "string"
            ? (() => { try { return JSON.parse(headerRaw) as HeaderConfig; } catch { return {}; } })()
            : (headerRaw && typeof headerRaw === "object" ? headerRaw as HeaderConfig : {});
        const parsedContent =
          typeof contentRaw === "string"
            ? (() => { try { return JSON.parse(contentRaw) as object; } catch { return {}; } })()
            : (contentRaw && typeof contentRaw === "object" ? contentRaw as object : {});

        setDoc({ ...d, header_config: parsedHeader as HeaderConfig, content: parsedContent });
        setTitle(d.title);
        const hc: HeaderConfig = parsedHeader && Object.keys(parsedHeader).length > 0
          && !Array.isArray(parsedHeader)
          ? parsedHeader
          : { ...DEFAULT_DPS_HEADER };
        setHeaderCfg(hc);
      })
      .catch(() => toast.error('Failed to load document.'))
      .finally(() => setLoading(false));
  }, [resourceId, apiBase]);

  // ── Auto-save ──────────────────────────────────────────────────────────────
  const scheduleSave = useCallback((patch: {
    title?: string; logo_url?: string | null; content?: object; header_config?: HeaderConfig;
  }) => {
    pendingSaveRef.current = patch;           // always keep the latest patch
    setSaveStatus('unsaved');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const p = pendingSaveRef.current;
      if (!p) return;
      pendingSaveRef.current = null;
      setSaveStatus('saving');
      try {
        await fetch(`${apiBase}/${resourceId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(p),
        });
        setSaveStatus('saved');
      } catch {
        setSaveStatus('unsaved');
        toast.error('Auto-save failed.');
      }
    }, 1200);
  }, [resourceId, apiBase]);

  // ── Flush-save-then-close ──────────────────────────────────────────────────
  // Waits for any pending save to land before unmounting so the public (read-only)
  // view always loads the latest header_config / content instead of stale data.
  const handleClose = useCallback(async () => {
    const p = pendingSaveRef.current;
    if (p) {
      pendingSaveRef.current = null;
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
      setSaveStatus('saving');
      try {
        await fetch(`${apiBase}/${resourceId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(p),
        });
        setSaveStatus('saved');
      } catch {
        setSaveStatus('unsaved');
        // Still close even if the flush failed — don't trap the user
      }
    }
    onClose();
  }, [resourceId, onClose, apiBase]);

  // ── Header config change ───────────────────────────────────────────────────
  const updateHeader = useCallback((patch: Partial<HeaderConfig>) => {
    setHeaderCfg(prev => {
      const next = { ...prev, ...patch };
      scheduleSave({ header_config: next });
      return next;
    });
  }, [scheduleSave]);

  // ── TipTap ─────────────────────────────────────────────────────────────────
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Underline, TextStyle, Color,
      Highlight.configure({ multicolor: true }),
      ResizableImage.configure({ inline: false, allowBase64: true }),
      Link.configure({ openOnClick: false, autolink: true }),
      Indent,
      FontFamily.configure({ types: ['textStyle'] }),
      FontSize,
      Table.configure({ resizable: true }),
      TableRow,
      // Extend TableHeader + TableCell to persist a backgroundColor attribute
      // in the saved JSON and render it as an inline style on the td/th element.
      TableHeader.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            backgroundColor: {
              default: null,
              parseHTML: (el: HTMLElement) => el.style.backgroundColor || null,
              renderHTML: (attrs: Record<string, unknown>) => {
                if (!attrs.backgroundColor) return {};
                return { style: `background-color: ${attrs.backgroundColor}` };
              },
            },
          };
        },
      }),
      TableCell.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            backgroundColor: {
              default: null,
              parseHTML: (el: HTMLElement) => el.style.backgroundColor || null,
              renderHTML: (attrs: Record<string, unknown>) => {
                if (!attrs.backgroundColor) return {};
                return { style: `background-color: ${attrs.backgroundColor}` };
              },
            },
          };
        },
      }),
    ],
    content: '',
    editable: canEdit,
    onUpdate: ({ editor }) => {
      if (isFirstLoad.current) return;
      scheduleSave({ content: editor.getJSON() });
      // Outline
      const items: OutlineItem[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading') {
          items.push({ level: node.attrs.level as number, text: node.textContent, pos });
        }
      });
      setOutline(items);
      setIsEmpty(editor.isEmpty);
      // Word count
      const txt = editor.state.doc.textContent;
      setWordCount(txt.split(/\s+/).filter(Boolean).length);
    },
  });

  // Populate editor
  useEffect(() => {
    if (!editor || !doc) return;
    let content: unknown = doc.content;
    if (typeof content === 'string') {
      try { content = JSON.parse(content); } catch { content = null; }
    }
    if (content && typeof content === 'object' && !Array.isArray(content) && Object.keys(content as object).length > 0) {
      editor.commands.setContent(content as never);
      setIsEmpty(false);
      // Extract initial outline
      const items: OutlineItem[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading') {
          items.push({ level: node.attrs.level as number, text: node.textContent, pos });
        }
      });
      setOutline(items);
    }
    setTimeout(() => { isFirstLoad.current = false; }, 100);
  }, [editor, doc]);

  // Close heading dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (headingRef.current && !headingRef.current.contains(e.target as Node)) setHeadingOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Image options panel listeners ──────────────────────────────────────────
  useEffect(() => {
    const handleSelect = (e: Event) => {
      const { attrs, updateAttributes } = (e as CustomEvent).detail as {
        attrs: ImageNodeAttrs;
        updateAttributes: (patch: Partial<ImageNodeAttrs>) => void;
      };
      imgUpdaterRef.current = updateAttributes;
      setImgAttrs(attrs);
      // Measure natural size from the selected img element
      const img = document.querySelector('.doc-editor img[data-align]') as HTMLImageElement | null
                ?? document.querySelector('.doc-editor img') as HTMLImageElement | null;
      if (img) {
        if (img.naturalWidth > 0) {
          setImgNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
        } else {
          img.onload = () => setImgNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
        }
      }
    };
    const handleDeselect = () => {
      imgUpdaterRef.current = null;
      setImgAttrs(null);
      setImgNaturalSize(null);
    };
    const handleAttrsUpdate = (e: Event) => {
      const { attrs } = (e as CustomEvent).detail as { attrs: ImageNodeAttrs };
      setImgAttrs(attrs);
    };
    window.addEventListener('tiptap:image-select',      handleSelect);
    window.addEventListener('tiptap:image-deselect',    handleDeselect);
    window.addEventListener('tiptap:image-attrs-update', handleAttrsUpdate);
    return () => {
      window.removeEventListener('tiptap:image-select',      handleSelect);
      window.removeEventListener('tiptap:image-deselect',    handleDeselect);
      window.removeEventListener('tiptap:image-attrs-update', handleAttrsUpdate);
    };
  }, []);

  // ── Font sync + table context ─────────────────────────────────────────────────
  useEffect(() => {
    if (!editor) return;
    const sync = () => {
      const ts = editor.getAttributes('textStyle') as { fontFamily?: string; fontSize?: string };
      setFontFamily(ts.fontFamily ?? 'Arial');
      const raw = ts.fontSize;
      if (raw) {
        const n = parseFloat(raw);
        setFontSize(Number.isFinite(n) ? Math.round(n) : 11);
      } else {
        setFontSize(11);
      }
      // Track if cursor is inside a table + current cell background color
      try {
        const { $from } = editor.state.selection;
        let inTbl = false;
        let cellBg: string | null = null;
        for (let d = $from.depth; d >= 0; d--) {
          const node = $from.node(d);
          if ((node.type.name === 'tableCell' || node.type.name === 'tableHeader') && cellBg === null) {
            cellBg = (node.attrs as { backgroundColor?: string }).backgroundColor ?? null;
          }
          if (node.type.name === 'table') { inTbl = true; break; }
        }
        setInTable(inTbl);
        setCurrentCellColor(cellBg);
      } catch { setInTable(false); setCurrentCellColor(null); }
    };
    editor.on('selectionUpdate', sync);
    editor.on('update', sync);
    sync();
    return () => { editor.off('selectionUpdate', sync); editor.off('update', sync); };
  }, [editor]);

  // ── Close font dropdowns / table grid / table fill on outside click ──────────
  useEffect(() => {
    if (!fontFamilyOpen && !fontSizeOpen && !tableGridOpen && !tableFillOpen) return;
    const handler = (e: MouseEvent) => {
      if (fontFamilyRef.current && !fontFamilyRef.current.contains(e.target as Node)) setFontFamilyOpen(false);
      if (fontSizeRef.current && !fontSizeRef.current.contains(e.target as Node)) setFontSizeOpen(false);
      if (tableGridRef.current && !tableGridRef.current.contains(e.target as Node)) setTableGridOpen(false);
      if (tableFillRef.current && !tableFillRef.current.contains(e.target as Node)) setTableFillOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [fontFamilyOpen, fontSizeOpen, tableGridOpen, tableFillOpen]);

  // ── Delete all content on a given page (1-based) ─────────────────────────
  const deletePageContent = useCallback((pageNum: number) => {
    if (!editor || !docWrapRef.current) return;
    const docWrap  = docWrapRef.current;
    const editorEl = editor.view.dom as HTMLElement;
    const wrapTop  = docWrap.getBoundingClientRect().top;
    const pageTopPx    = (pageNum - 1) * PAGE_TOTAL;
    const pageBottomPx =  pageNum      * PAGE_TOTAL;

    const { state } = editor;
    const ranges: { from: number; to: number }[] = [];

    // Walk the same DOM children that paginate() uses so coordinate systems match.
    for (const block of Array.from(editorEl.children) as HTMLElement[]) {
      const rect     = block.getBoundingClientRect();
      const blockTop = rect.top - wrapTop;

      // Block belongs to this page if its top pixel falls in the page's band.
      if (blockTop < pageTopPx || blockTop >= pageBottomPx) continue;

      try {
        // tableWrapper divs are not ProseMirror nodes — resolve through the inner table.
        const target = block.classList.contains('tableWrapper')
          ? (block.querySelector('table') ?? block)
          : block;
        const insidePos = editor.view.posAtDOM(target, 0);
        const $pos = state.doc.resolve(insidePos);
        if ($pos.depth < 1) continue;
        const from = $pos.before(1);
        const to   = $pos.after(1);
        ranges.push({ from, to });
      } catch { /* ProseMirror couldn't resolve — skip */ }
    }

    if (ranges.length === 0) {
      toast('No content found on that page.');
      return;
    }

    // Deduplicate (multiple DOM children can resolve to the same PM node)
    const seen   = new Set<number>();
    const unique = ranges.filter(r => !seen.has(r.from) && !!seen.add(r.from));

    // Delete from highest offset downward so earlier positions stay valid.
    unique.sort((a, b) => b.from - a.from);
    const tr = state.tr;
    for (const { from, to } of unique) tr.delete(from, to);
    editor.view.dispatch(tr);
  }, [editor]);

  // ── Apply a background color to cell / row / column ───────────────────────
  const applyTableCellColor = useCallback((color: string | null, scope: 'cell' | 'row' | 'col') => {
    if (!editor) return;

    if (scope === 'cell') {
      editor.chain().focus().setCellAttribute('backgroundColor', color).run();
      return;
    }

    const { state } = editor.view;
    const { selection } = state;
    const $anchor = selection.$anchor;
    const tr = state.tr;

    // Walk up to locate table / row / cell depths
    let cellDepth = -1, rowDepth = -1, tableDepth = -1;
    for (let d = $anchor.depth; d >= 0; d--) {
      const name = $anchor.node(d).type.name;
      if ((name === 'tableCell' || name === 'tableHeader') && cellDepth === -1) cellDepth = d;
      if (name === 'tableRow'  && rowDepth === -1) rowDepth = d;
      if (name === 'table')    { tableDepth = d; break; }
    }
    if (tableDepth === -1) return;

    if (scope === 'row' && rowDepth !== -1) {
      const rowPos  = $anchor.before(rowDepth);
      const rowNode = state.doc.nodeAt(rowPos);
      if (!rowNode) return;
      let pos = rowPos + 1; // content start of the row
      rowNode.forEach(cell => {
        tr.setNodeMarkup(pos, undefined, { ...cell.attrs, backgroundColor: color });
        pos += cell.nodeSize;
      });
      editor.view.dispatch(tr);
      return;
    }

    if (scope === 'col' && cellDepth !== -1 && rowDepth !== -1) {
      // Determine which column index the current cell sits in
      const rowPos        = $anchor.before(rowDepth);
      const rowNode       = state.doc.nodeAt(rowPos);
      const currentCellP  = $anchor.before(cellDepth);
      if (!rowNode) return;
      let colIdx = 0, walkPos = rowPos + 1, walkIdx = 0;
      rowNode.forEach(cell => {
        if (walkPos === currentCellP) colIdx = walkIdx;
        walkPos += cell.nodeSize;
        walkIdx++;
      });

      // Apply to every row's cell at colIdx
      const tableStartPos = $anchor.start(tableDepth);
      $anchor.node(tableDepth).forEach((row, rowOffset) => {
        if (row.type.name !== 'tableRow') return;
        let cellPos = tableStartPos + rowOffset + 1;
        let ci = 0;
        row.forEach(cell => {
          if (ci === colIdx) {
            tr.setNodeMarkup(cellPos, undefined, { ...cell.attrs, backgroundColor: color });
          }
          cellPos += cell.nodeSize;
          ci++;
        });
      });
      editor.view.dispatch(tr);
    }
  }, [editor]);

  // ── JS Pagination — push blocks past page-bottom margins ──────────────────────
  useEffect(() => {
    if (!editor) return;
    let rafId: number;

    const paginate = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (!editor || !docWrapRef.current) return;
        const editorEl = editor.view.dom as HTMLElement;
        const docWrap  = docWrapRef.current;
        const wrapTop  = docWrap.getBoundingClientRect().top;

        // 1. Reset prior adjustments
        (docWrap.querySelectorAll('[data-pg-push]') as NodeListOf<HTMLElement>)
          .forEach(el => {
            el.style.marginTop = el.dataset.pgOrigMt ?? '';
            el.removeAttribute('data-pg-push');
            el.removeAttribute('data-pg-orig-mt');
          });

        // 2. Walk every direct block child and push across boundaries
        //    (edit mode only — in public/read-only mode content flows naturally
        //     so readers never see artificial spacing gaps)
        const PAGE_TOTAL = PAGE_H + PAGE_GAP;
        const M = PAGE_MARGIN_PX;
        let didPush = false;

        if (canEdit) {
          // TOP_EXTRA: small extra indent below the top margin when a block snaps
          // to the next page, so it doesn't land flush against the top rule.
          const TOP_EXTRA = 20;

          // cumulativePush tracks how much total margin-top we've already added to
          // blocks earlier in this pass.  Because we write margin-top then
          // immediately read the *next* block's getBoundingClientRect() within the
          // same rAF (before the browser has re-laid out), subsequent blocks still
          // report their *pre-push* visual positions.  By adding cumulativePush to
          // each measured position we get the correct post-layout position and
          // avoid the compounding-gap cascade that created phantom pages.
          let cumulativePush = 0;

          for (const block of Array.from(editorEl.children) as HTMLElement[]) {
            const rect   = block.getBoundingClientRect();
            // Adjust for pushes applied earlier in this same rAF pass.
            const top    = rect.top    - wrapTop + cumulativePush;
            const bottom = rect.bottom - wrapTop + cumulativePush;
            const slot   = Math.floor(Math.max(0, top) / PAGE_TOTAL);
            // pageContentEnd: the last usable pixel before the bottom margin of
            // this page (PAGE_H − one inch).  We push only when a block's bottom
            // actually crosses this line.
            const pageContentEnd = slot * PAGE_TOTAL + PAGE_H - M;

            // Headings and tables are never auto-pushed.
            // Headings anchor where the author placed them.
            // Tables can span page boundaries naturally — forcing a margin-top
            // push onto a tableWrapper creates a large visible gap above the table.
            const isHeading = /^H[1-6]$/.test(block.tagName);
            const isTable   = block.classList.contains('tableWrapper');

            // Push only when the block genuinely overflows into the bottom margin.
            if (!isHeading && !isTable && bottom > pageContentEnd) {
              const nextStart = (slot + 1) * PAGE_TOTAL + M + TOP_EXTRA;
              const push = nextStart - top;
              if (push > 0) {
                const origMt = parseFloat(getComputedStyle(block).marginTop) || 0;
                block.dataset.pgPush   = '1';
                block.dataset.pgOrigMt = block.style.marginTop;
                block.style.marginTop  = `${origMt + push}px`;
                cumulativePush += push;
                didPush = true;
              }
            }
          }
        }

        // 3. Recalculate total pages (exclude the PageStyle panel from measured height)
        const panelH = pageStylePanelRef.current?.offsetHeight ?? 0;
        setNumPages(Math.max(1, Math.ceil((docWrap.scrollHeight - panelH) / PAGE_TOTAL)));

        // 4. After a push, scroll the cursor back into view (TipTap won't do
        //    this itself because the margin change happened outside a transaction)
        if (didPush) {
          requestAnimationFrame(() => {
            try {
              const { from } = editor.state.selection;
              const coords   = editor.view.coordsAtPos(from);
              const scrollEl = editorScrollRef.current;
              if (!scrollEl || !coords) return;
              const box = scrollEl.getBoundingClientRect();
              if (coords.bottom > box.bottom - 80) {
                scrollEl.scrollTop += coords.bottom - box.bottom + 120;
              } else if (coords.top < box.top + 80) {
                scrollEl.scrollTop -= box.top + 80 - coords.top;
              }
            } catch { /* selection out of range — ignore */ }
          });
        }
      });
    };

    paginateRef.current = paginate; // expose for the window-resize listener

    editor.on('update', paginate);
    paginate(); // run once on mount / doc-load

    return () => {
      editor.off('update', paginate);
      paginateRef.current = null;
      cancelAnimationFrame(rafId);
    };
  }, [editor]);

  // ── Window resize → re-paginate (replaces the old ResizeObserver) ──────────
  // The ResizeObserver caused a race: it fired *after* paginate() added
  // margin-top to blocks and used the wrong divisor (PAGE_H instead of
  // PAGE_H + PAGE_GAP), overwriting the correct numPages with a too-high value
  // that left blank extra pages in public (read-only) mode.
  useEffect(() => {
    const onResize = () => { paginateRef.current?.(); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handleImagePanelUpdate = useCallback((patch: Partial<ImageNodeAttrs>) => {
    if (imgUpdaterRef.current) {
      imgUpdaterRef.current(patch);
      setImgAttrs(prev => prev ? { ...prev, ...patch } : null);
    }
  }, []);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleTitleChange = (v: string) => {
    setTitle(v);
    scheduleSave({ title: v });
  };

  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      updateHeader({
        logo_url: reader.result as string,
        layout: headerCfg.layout === 'none' || headerCfg.layout === 'text-only' ? 'logo-left' : headerCfg.layout,
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      editor?.chain().focus().setImage({ src: reader.result as string }).run();
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // ── PDF import ────────────────────────────────────────────────────────────────
  const handlePdfImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editor) return;
    setPdfImporting(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      // Extract text page-by-page, preserving structure heuristically
      const paragraphs: { type: 'heading' | 'para'; text: string }[] = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        const page   = await pdf.getPage(p);
        const content = await page.getTextContent();

        let currentLine = '';
        let lastY: number | null = null;

        for (const item of content.items) {
          if (!('str' in item)) continue;
          const str = (item as { str: string; transform: number[] }).str;
          const y   = (item as { transform: number[] }).transform[5];

          // New line when Y jumps
          if (lastY !== null && Math.abs(y - lastY) > 4) {
            const trimmed = currentLine.trim();
            if (trimmed) {
              const isHeading = trimmed.length < 80 && trimmed === trimmed.toUpperCase() && !/[.!?,;]$/.test(trimmed);
              paragraphs.push({ type: isHeading ? 'heading' : 'para', text: trimmed });
            }
            currentLine = str;
          } else {
            currentLine += (currentLine && !currentLine.endsWith(' ') ? ' ' : '') + str;
          }
          lastY = y;
        }
        if (currentLine.trim()) {
          const trimmed = currentLine.trim();
          const isHeading = trimmed.length < 80 && trimmed === trimmed.toUpperCase() && !/[.!?,;]$/.test(trimmed);
          paragraphs.push({ type: isHeading ? 'heading' : 'para', text: trimmed });
        }
        // Blank paragraph between pages
        if (p < pdf.numPages) paragraphs.push({ type: 'para', text: '' });
      }

      // Build TipTap JSON
      const nodes = paragraphs.map(({ type, text }) =>
        type === 'heading'
          ? { type: 'heading', attrs: { level: 2 }, content: text ? [{ type: 'text', text }] : [] }
          : { type: 'paragraph', content: text ? [{ type: 'text', text }] : [] },
      );

      editor.commands.setContent({ type: 'doc', content: nodes.length ? nodes : [{ type: 'paragraph' }] });
      // Trigger save
      scheduleSave({ content: editor.getJSON() });
      toast.success(`Imported ${pdf.numPages} page${pdf.numPages > 1 ? 's' : ''} from PDF`);
    } catch (err) {
      console.error(err);
      toast.error('Failed to import PDF. Make sure it contains selectable text.');
    } finally {
      setPdfImporting(false);
    }
  };

  // (ResizeObserver removed — paginate() is now the single source of truth for
  //  numPages.  It uses the correct PAGE_H + PAGE_GAP divisor and fires on every
  //  editor 'update' event plus window resize via paginateRef.)

  const setLink = () => {
    const prev = editor?.getAttributes('link').href as string | undefined;
    const url = prompt('Enter URL:', prev ?? 'https://');
    if (url === null) return;
    if (!url) { editor?.chain().focus().unsetLink().run(); return; }
    editor?.chain().focus().setLink({ href: url }).run();
  };

  const headingLabel = () => {
    if (!editor) return 'Body';
    if (editor.isActive('heading', { level: 1 })) return 'Heading 1';
    if (editor.isActive('heading', { level: 2 })) return 'Heading 2';
    if (editor.isActive('heading', { level: 3 })) return 'Heading 3';
    return 'Body';
  };

  const applyTemplate = (tpl: DocTemplate) => {
    editor?.commands.setContent(tpl.content as never);
    isFirstLoad.current = false;
    if (tpl.headerConfig) {
      const newHc: HeaderConfig = { ...headerCfg, ...tpl.headerConfig };
      setHeaderCfg(newHc);
      scheduleSave({ content: tpl.content, header_config: newHc });
    } else {
      scheduleSave({ content: tpl.content });
    }
    setIsEmpty(false);
  };

  const scrollToHeading = (pos: number) => {
    if (!editor) return;
    editor.commands.setTextSelection(pos);
    editor.commands.focus();
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#f8f9fa]">

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-3 border-b border-[#e0e0e0] bg-white px-4 py-2 shadow-sm">
        <button type="button" onClick={() => { void handleClose(); }}
          className="flex items-center gap-1.5 rounded-full p-1.5 text-[#444746] hover:bg-[#f1f3f4] transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </button>

        {canEdit ? (
          <input type="text" value={title} onChange={e => handleTitleChange(e.target.value)}
            placeholder="Untitled document"
            className="min-w-0 flex-1 rounded px-1 py-0.5 text-[15px] font-medium text-[#202124] placeholder:text-[#bdc1c6] outline-none hover:bg-[#f1f3f4] focus:bg-[#f1f3f4] transition-colors" />
        ) : (
          <span className="flex-1 min-w-0 truncate px-1 text-[15px] font-medium text-[#202124]">{title}</span>
        )}

        {canEdit && (
          <span className={`shrink-0 text-[10px] font-medium tabular-nums ${
            saveStatus === 'saved' ? 'text-[#80868b]' : saveStatus === 'saving' ? 'text-[#bdc1c6]' : 'text-amber-500'
          }`}>
            {saveStatus === 'saved' ? 'All changes saved' : saveStatus === 'saving' ? 'Saving…' : '● Unsaved'}
          </span>
        )}
      </div>


      {/* ── Formatting toolbar ───────────────────────────────────────────── */}
      {canEdit && (<>
        <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-[#e0e0e0] bg-white px-3 py-1">

          <ToolBtn title="Undo" onClick={() => editor?.chain().focus().undo().run()} disabled={!editor?.can().undo()}>
            <Undo className="h-3.5 w-3.5" />
          </ToolBtn>
          <ToolBtn title="Redo" onClick={() => editor?.chain().focus().redo().run()} disabled={!editor?.can().redo()}>
            <Redo className="h-3.5 w-3.5" />
          </ToolBtn>

          <ToolDivider />

          {/* Heading dropdown */}
          <div className="relative" ref={headingRef}>
            <button type="button" onClick={() => setHeadingOpen(p => !p)}
              className="flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium text-[#444746] hover:bg-[#e8eaed] transition-colors">
              <Type className="h-3 w-3" />
              <span className="w-[58px] text-left">{headingLabel()}</span>
              <ChevronDown className="h-3 w-3" />
            </button>
            {headingOpen && (
              <div className="absolute left-0 top-full z-20 mt-1 w-36 rounded-lg border border-[#dadce0] bg-white shadow-lg overflow-hidden">
                {(['Body', 'Heading 1', 'Heading 2', 'Heading 3'] as const).map(h => {
                  const level = h === 'Body' ? 0 : parseInt(h.split(' ')[1]);
                  const isActive = h === 'Body' ? editor?.isActive('paragraph') : editor?.isActive('heading', { level });
                  return (
                    <button key={h} type="button"
                      onClick={() => {
                        if (h === 'Body') editor?.chain().focus().setParagraph().run();
                        else editor?.chain().focus().toggleHeading({ level: level as 1|2|3 }).run();
                        setHeadingOpen(false);
                      }}
                      className={`w-full px-3 py-2 text-left text-xs transition-colors hover:bg-[#f1f3f4]
                        ${isActive ? 'text-[#1a73e8] bg-[#e8f0fe]' : 'text-[#444746]'}`}
                      style={{ fontSize: h === 'Heading 1' ? 15 : h === 'Heading 2' ? 13 : 12 }}>
                      {h}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <ToolDivider />

          {/* ── Font family ─────────────────────────────────────────────────── */}
          <div className="relative" ref={fontFamilyRef}>
            <button type="button"
              onClick={() => { setFontFamilyOpen(p => !p); setFontSizeOpen(false); }}
              className={`flex h-7 items-center gap-1 rounded px-2 text-[11px] transition-colors min-w-[82px] max-w-[120px]
                ${fontFamilyOpen ? 'bg-[#e8f0fe] text-[#1a73e8]' : 'text-[#444746] hover:bg-[#e8eaed]'}`}
              style={{ fontFamily: fontFamily }}
              title="Font family">
              <span className="truncate">{fontFamily}</span>
              <ChevronDown className="h-3 w-3 shrink-0 ml-auto opacity-60" />
            </button>
            {fontFamilyOpen && (
              <div className="absolute left-0 top-full z-30 mt-1 w-44 rounded-lg border border-[#dadce0] bg-white py-1 shadow-xl overflow-y-auto" style={{ maxHeight: 280 }}>
                {GD_FONTS.map(f => (
                  <button key={f} type="button"
                    onClick={() => {
                      editor?.chain().focus().setFontFamily(f).run();
                      setFontFamily(f);
                      setFontFamilyOpen(false);
                    }}
                    className={`w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-[#f1f3f4]
                      ${fontFamily === f ? 'text-[#1a73e8] font-semibold bg-[#e8f0fe]' : 'text-[#444746]'}`}
                    style={{ fontFamily: f }}>
                    {f}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Font size ───────────────────────────────────────────────────── */}
          <div className="relative flex items-center gap-0.5" ref={fontSizeRef}>
            <button type="button" title="Decrease font size"
              onClick={() => {
                const smaller = [...GD_SIZES].reverse().find(s => s < fontSize) ?? Math.max(6, fontSize - 1);
                editor?.chain().focus().setFontSize(`${smaller}pt`).run();
                setFontSize(smaller);
              }}
              className="flex h-6 w-5 items-center justify-center rounded text-[#444746] hover:bg-[#e8eaed] transition-colors select-none">
              <span className="text-[13px] font-medium leading-none">−</span>
            </button>

            <button type="button"
              onClick={() => setFontSizeOpen(p => !p)}
              className={`flex h-7 w-[38px] items-center justify-center rounded text-[11px] font-medium transition-colors
                ${fontSizeOpen ? 'bg-[#e8f0fe] text-[#1a73e8]' : 'text-[#444746] hover:bg-[#e8eaed]'}`}
              title="Font size">
              {fontSize}
            </button>
            {fontSizeOpen && (
              <div className="absolute left-5 top-full z-30 mt-1 w-16 rounded-lg border border-[#dadce0] bg-white py-1 shadow-xl overflow-y-auto" style={{ maxHeight: 240 }}>
                {GD_SIZES.map(s => (
                  <button key={s} type="button"
                    onClick={() => {
                      editor?.chain().focus().setFontSize(`${s}pt`).run();
                      setFontSize(s);
                      setFontSizeOpen(false);
                    }}
                    className={`w-full px-3 py-1 text-right text-xs transition-colors hover:bg-[#f1f3f4]
                      ${fontSize === s ? 'text-[#1a73e8] font-semibold bg-[#e8f0fe]' : 'text-[#444746]'}`}>
                    {s}
                  </button>
                ))}
              </div>
            )}

            <button type="button" title="Increase font size"
              onClick={() => {
                const larger = GD_SIZES.find(s => s > fontSize) ?? Math.min(400, fontSize + 1);
                editor?.chain().focus().setFontSize(`${larger}pt`).run();
                setFontSize(larger);
              }}
              className="flex h-6 w-5 items-center justify-center rounded text-[#444746] hover:bg-[#e8eaed] transition-colors select-none">
              <span className="text-[13px] font-medium leading-none">+</span>
            </button>
          </div>

          <ToolDivider />

          <ToolBtn title="Bold" active={editor?.isActive('bold')} onClick={() => editor?.chain().focus().toggleBold().run()}>
            <Bold className="h-3.5 w-3.5" />
          </ToolBtn>
          <ToolBtn title="Italic" active={editor?.isActive('italic')} onClick={() => editor?.chain().focus().toggleItalic().run()}>
            <Italic className="h-3.5 w-3.5" />
          </ToolBtn>
          <ToolBtn title="Underline" active={editor?.isActive('underline')} onClick={() => editor?.chain().focus().toggleUnderline().run()}>
            <UnderlineIcon className="h-3.5 w-3.5" />
          </ToolBtn>
          <ToolBtn title="Strikethrough" active={editor?.isActive('strike')} onClick={() => editor?.chain().focus().toggleStrike().run()}>
            <Strikethrough className="h-3.5 w-3.5" />
          </ToolBtn>

          <ToolDivider />

          {/* Text color */}
          <div className="relative flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-[#e8eaed]" title="Text color">
            <span className="text-[11px] font-bold text-[#444746]" style={{ textDecoration: 'underline', textDecorationColor: '#1a73e8' }}>A</span>
            <input type="color" className="absolute inset-0 cursor-pointer opacity-0"
              onChange={e => editor?.chain().focus().setColor(e.target.value).run()} title="Text color" />
          </div>

          <ToolDivider />

          <ToolBtn title="Align left" active={editor?.isActive({ textAlign: 'left' })} onClick={() => editor?.chain().focus().setTextAlign('left').run()}>
            <AlignLeft className="h-3.5 w-3.5" />
          </ToolBtn>
          <ToolBtn title="Align center" active={editor?.isActive({ textAlign: 'center' })} onClick={() => editor?.chain().focus().setTextAlign('center').run()}>
            <AlignCenter className="h-3.5 w-3.5" />
          </ToolBtn>
          <ToolBtn title="Align right" active={editor?.isActive({ textAlign: 'right' })} onClick={() => editor?.chain().focus().setTextAlign('right').run()}>
            <AlignRight className="h-3.5 w-3.5" />
          </ToolBtn>
          <ToolBtn title="Justify" active={editor?.isActive({ textAlign: 'justify' })} onClick={() => editor?.chain().focus().setTextAlign('justify').run()}>
            <AlignJustify className="h-3.5 w-3.5" />
          </ToolBtn>

          <ToolDivider />

          <ToolBtn title="Increase indent" onClick={() => {
            if (!editor) return;
            // Inside a list → nest the list item one level deeper
            if (editor.isActive('listItem')) {
              editor.chain().focus().sinkListItem('listItem').run();
              return;
            }
            // Otherwise shift paragraph / heading margin-left
            const { state, view } = editor;
            const { tr, selection } = state;
            const { from, to } = selection;
            let changed = false;
            state.doc.nodesBetween(from, to, (node, pos) => {
              const name = node.type.name;
              if (name === 'paragraph' || name === 'heading') {
                const cur = (node.attrs.indent as number) ?? 0;
                tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: Math.min(cur + 40, 384) });
                changed = true;
              }
            });
            if (changed) view.dispatch(tr);
          }}>
            <IndentIncrease className="h-3.5 w-3.5" />
          </ToolBtn>
          <ToolBtn title="Decrease indent" onClick={() => {
            if (!editor) return;
            // Inside a list → lift the list item one level up
            if (editor.isActive('listItem')) {
              editor.chain().focus().liftListItem('listItem').run();
              return;
            }
            // Otherwise shift paragraph / heading margin-left
            const { state, view } = editor;
            const { tr, selection } = state;
            const { from, to } = selection;
            let changed = false;
            state.doc.nodesBetween(from, to, (node, pos) => {
              const name = node.type.name;
              if (name === 'paragraph' || name === 'heading') {
                const cur = (node.attrs.indent as number) ?? 0;
                tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: Math.max(cur - 40, 0) });
                changed = true;
              }
            });
            if (changed) view.dispatch(tr);
          }}>
            <IndentDecrease className="h-3.5 w-3.5" />
          </ToolBtn>

          <ToolDivider />

          <ToolBtn title="Bullet list" active={editor?.isActive('bulletList')} onClick={() => editor?.chain().focus().toggleBulletList().run()}>
            <List className="h-3.5 w-3.5" />
          </ToolBtn>
          <ToolBtn title="Numbered list" active={editor?.isActive('orderedList')} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>
            <ListOrdered className="h-3.5 w-3.5" />
          </ToolBtn>
          <ToolBtn title="Insert divider line" onClick={() => editor?.chain().focus().setHorizontalRule().run()}>
            <SeparatorHorizontal className="h-3.5 w-3.5" />
          </ToolBtn>

          <ToolDivider />

          <ToolBtn title="Link" active={editor?.isActive('link')} onClick={setLink}>
            <LinkIcon className="h-3.5 w-3.5" />
          </ToolBtn>

          <div className="relative">
            <ToolBtn title="Insert image" onClick={() => imageFileInputRef.current?.click()}>
              <ImageIcon className="h-3.5 w-3.5" />
            </ToolBtn>
            <input ref={imageFileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageFileChange} />
          </div>


          {/* ── Insert table grid picker ── */}
          <div className="relative" ref={tableGridRef}>
            <button type="button" title="Insert table"
              onClick={() => setTableGridOpen(p => !p)}
              className={`flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors
                ${tableGridOpen ? 'bg-[#e8f0fe] text-[#1a73e8]' : 'text-[#444746] hover:bg-[#e8eaed]'}`}>
              <Table2 className="h-3.5 w-3.5" />
              Table
            </button>
            {tableGridOpen && (
              <div className="absolute left-0 top-full z-30 mt-1 rounded-lg border border-[#dadce0] bg-white p-2.5 shadow-xl">
                <p className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-[#80868b]">
                  {tableGridHover.r > 0 ? `${tableGridHover.r} × ${tableGridHover.c} table` : 'Insert table'}
                </p>
                <div className="grid gap-0.5" style={{ gridTemplateColumns: 'repeat(6, 20px)' }}>
                  {Array.from({ length: 36 }).map((_, idx) => {
                    const row = Math.floor(idx / 6) + 1;
                    const col = (idx % 6) + 1;
                    const isActive = row <= tableGridHover.r && col <= tableGridHover.c;
                    return (
                      <div key={idx}
                        className={`h-5 w-5 cursor-pointer rounded-sm border transition-colors
                          ${isActive ? 'border-[#1a73e8] bg-[#e8f0fe]' : 'border-[#dadce0] hover:border-[#9aa0a6]'}`}
                        onMouseEnter={() => setTableGridHover({ r: row, c: col })}
                        onMouseLeave={() => setTableGridHover({ r: 0, c: 0 })}
                        onClick={() => {
                          editor?.chain().focus().insertTable({ rows: row, cols: col, withHeaderRow: true }).run();
                          setTableGridOpen(false);
                          setTableGridHover({ r: 0, c: 0 });
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <ToolDivider />

          {/* Header toggle */}
          <button type="button" title="Header options" onClick={() => setShowHeaderEdit(p => !p)}
            className={`flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors
              ${showHeaderEdit ? 'bg-[#e8f0fe] text-[#1a73e8]' : 'text-[#444746] hover:bg-[#e8eaed]'}`}>
            <Layout className="h-3.5 w-3.5" />
            Header
          </button>

          {/* Page style toggle */}
          <button type="button" title="Page style — accent bar, corner logo, footer, watermark, memo mode"
            onClick={() => setShowPageStyle(p => !p)}
            className={`flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors
              ${showPageStyle ? 'bg-[#e8f0fe] text-[#1a73e8]' : 'text-[#444746] hover:bg-[#e8eaed]'}`}>
            <Paintbrush className="h-3.5 w-3.5" />
            Page Style
          </button>

          <input ref={logoFileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoFileChange} />
        </div>

        {/* ── Contextual table toolbar (shown when cursor is in a table) ── */}
        {canEdit && inTable && (
          <div className="table-context-toolbar flex flex-wrap items-center gap-1 overflow-x-clip border-t border-[#dadce0] bg-[#f8f9fa] px-4 py-1 w-full">
            <span className="mr-1 text-[9px] font-bold uppercase tracking-widest text-[#80868b]">Table:</span>
            <button type="button" onClick={() => editor?.chain().focus().addRowBefore().run()}
              className="flex h-6 items-center gap-1 rounded px-2 text-[10px] font-medium text-[#444746] hover:bg-[#e8eaed] transition-colors" title="Add row above">
              ↑ Row above
            </button>
            <button type="button" onClick={() => editor?.chain().focus().addRowAfter().run()}
              className="flex h-6 items-center gap-1 rounded px-2 text-[10px] font-medium text-[#444746] hover:bg-[#e8eaed] transition-colors" title="Add row below">
              ↓ Row below
            </button>
            <button type="button" onClick={() => editor?.chain().focus().addColumnBefore().run()}
              className="flex h-6 items-center gap-1 rounded px-2 text-[10px] font-medium text-[#444746] hover:bg-[#e8eaed] transition-colors" title="Add column left">
              ← Col left
            </button>
            <button type="button" onClick={() => editor?.chain().focus().addColumnAfter().run()}
              className="flex h-6 items-center gap-1 rounded px-2 text-[10px] font-medium text-[#444746] hover:bg-[#e8eaed] transition-colors" title="Add column right">
              → Col right
            </button>
            <div className="mx-1 h-4 w-px bg-[#dadce0]" />
            <button type="button" onClick={() => editor?.chain().focus().deleteRow().run()}
              className="flex h-6 items-center gap-1 rounded px-2 text-[10px] font-medium text-red-500 hover:bg-red-50 transition-colors" title="Delete row">
              Del row
            </button>
            <button type="button" onClick={() => editor?.chain().focus().deleteColumn().run()}
              className="flex h-6 items-center gap-1 rounded px-2 text-[10px] font-medium text-red-500 hover:bg-red-50 transition-colors" title="Delete column">
              Del col
            </button>
            <button type="button" onClick={() => editor?.chain().focus().deleteTable().run()}
              className="flex h-6 items-center gap-1 rounded px-2 text-[10px] font-medium text-red-600 hover:bg-red-50 transition-colors font-semibold" title="Delete entire table">
              Del table
            </button>

            <div className="mx-1 h-4 w-px bg-[#dadce0]" />

            {/* ── Cell / Row / Column fill color ────────────────────────── */}
            <div className="relative" ref={tableFillRef}>
              <button
                type="button"
                onClick={() => setTableFillOpen(v => !v)}
                className={`flex h-6 items-center gap-1 rounded px-2 text-[10px] font-medium transition-colors ${tableFillOpen ? 'bg-[#e8f0fe] text-[#1a73e8]' : 'text-[#444746] hover:bg-[#e8eaed]'}`}
                title="Fill color"
              >
                <span className="inline-flex h-3 w-3 rounded-sm border border-[#bdc1c6]"
                  style={{ background: currentCellColor ?? '#ffffff' }} />
                Fill
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>

              {tableFillOpen && (
                <div className="absolute left-0 top-full z-50 mt-1 w-[168px] rounded-lg border border-[#dadce0] bg-white p-2.5 shadow-xl">
                  {/* Scope selector: Cell / Row / Col */}
                  <div className="mb-2 flex gap-1">
                    {(['cell', 'row', 'col'] as const).map(s => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setTableFillScope(s)}
                        className={`flex-1 rounded py-0.5 text-[9px] font-bold uppercase tracking-widest transition-colors ${
                          tableFillScope === s
                            ? 'bg-[#1a73e8] text-white'
                            : 'bg-[#f1f3f4] text-[#444746] hover:bg-[#e8eaed]'
                        }`}
                      >
                        {s === 'col' ? 'Col' : s === 'row' ? 'Row' : 'Cell'}
                      </button>
                    ))}
                  </div>

                  {/* 5 × 4 colour swatches */}
                  <div className="grid grid-cols-5 gap-1">
                    {TABLE_FILL_COLORS.map(color => (
                      <button
                        key={color}
                        type="button"
                        title={color}
                        onClick={() => { applyTableCellColor(color, tableFillScope); setTableFillOpen(false); }}
                        className="h-5 w-5 rounded border border-[#dadce0] transition-transform hover:scale-110 focus:outline-none"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>

                  {/* Clear */}
                  <button
                    type="button"
                    onClick={() => { applyTableCellColor(null, tableFillScope); setTableFillOpen(false); }}
                    className="mt-2 flex w-full items-center justify-center gap-1 rounded border border-[#dadce0] py-0.5 text-[9px] font-medium text-[#5f6368] hover:bg-[#f1f3f4] transition-colors"
                  >
                    <X className="h-3 w-3" /> Clear fill
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </>)}

      {/* ── Body: sidebar + document + image panel ───────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left outline sidebar — edit mode only */}
        {canEdit && <DocSidebar outline={outline} onHeadingClick={scrollToHeading} />}

        {/* Document scroll area */}
        <div
          ref={editorScrollRef}
          className={`flex-1 overflow-y-auto bg-[#f1f3f4]${!canEdit ? ' select-none' : ''}`}
          onContextMenu={!canEdit ? e => e.preventDefault() : undefined}
          onKeyDown={!canEdit ? e => {
            const k = e.key.toLowerCase();
            // Allow copy / select-all in public view; block save/print shortcuts only
            if ((e.ctrlKey || e.metaKey) && ['s', 'p'].includes(k)) {
              e.preventDefault();
            }
          } : undefined}
        >
          {canEdit && <Ruler editor={editor} canEdit={canEdit} />}

          {/* Vertical ruler + document */}
          <div className="flex bg-[#f1f3f4]">
            {canEdit
              ? <VerticalRuler editor={editor} canEdit={canEdit} />
              /* Read-only: center the page on all screen sizes (no fixed edit-mode spacer) */
              : <div className="hidden shrink-0 lg:block" style={{ width: 40 }} />
            }

            <div className="flex-1 px-3 py-6 sm:px-4 sm:py-8 bg-[#f1f3f4]">
            {/* ── Multi-page document ── */}
            <div className="mx-auto w-full max-w-[816px]">

              {/* Page stacks: each PAGE_H block gets its own white card */}
              <div className="relative" style={{ minHeight: numPages * PAGE_H + (numPages - 1) * PAGE_GAP }}>

                {/* White page backgrounds + per-page decorations */}
                {Array.from({ length: numPages }).map((_, i) => {
                  const pageNum  = i + 1; // 1-based
                  // Resolve per-page style override (falls back to base headerCfg)
                  const pageCfg  = resolvePageCfg(headerCfg, pageNum);
                  // A page is decorated if it has a specific override OR the base config includes it
                  const hasOverride    = !!(headerCfg.page_overrides?.[String(pageNum)]);
                  const baseApply      = headerCfg.page_apply ?? 'all';
                  const decoratedByBase = baseApply === 'all' || !Array.isArray(baseApply)
                    ? true : baseApply.includes(pageNum);
                  const decorated = hasOverride || decoratedByBase;

                  // Compute background style from this page's effective config
                  const bgDesign = decorated ? (pageCfg.bg_design ?? 'none') : 'none';
                  const bgBase   = pageCfg.bg_color ?? '#ffffff';
                  let bgStyle: React.CSSProperties = { backgroundColor: bgBase };
                  if (bgDesign === 'default') {
                    bgStyle = {
                      background: [
                        'repeating-linear-gradient(-45deg, transparent 0px, transparent 14px, rgba(255,255,255,0.55) 14px, rgba(255,255,255,0.55) 15.5px)',
                        'linear-gradient(155deg,#e8ebf0 0%,#f5f6f9 30%,#f9fafb 60%,#edf0f5 100%)',
                      ].join(','),
                    };
                  } else if (bgDesign === 'custom' && pageCfg.bg_design_url) {
                    bgStyle = {
                      backgroundColor: '#ffffff',
                      backgroundImage: `url(${pageCfg.bg_design_url})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    };
                  }

                  return (
                  <div
                    key={i}
                    className={`absolute left-0 right-0 overflow-hidden pointer-events-none${decorated && pageCfg.page_texture === 'crosshatch' ? ' page-texture-crosshatch' : ''}`}
                    style={{
                      top: i * (PAGE_H + PAGE_GAP),
                      height: PAGE_H,
                      boxShadow: '0 1px 3px rgba(60,64,67,.3), 0 4px 8px 3px rgba(60,64,67,.15)',
                      ...bgStyle,
                    }}
                  >
                    {/* Left accent bar */}
                    {decorated && pageCfg.left_bar && (
                      <div className="absolute left-0 top-0 bottom-0 z-10"
                        style={{ width: pageCfg.left_bar_width ?? 7, backgroundColor: pageCfg.left_bar_color ?? '#1a3f6f' }} />
                    )}

                    {/* Watermark */}
                    {decorated && pageCfg.watermark_url && (
                      <div className="absolute inset-0 flex items-center justify-center z-0 overflow-hidden">
                        <img src={pageCfg.watermark_url} alt=""
                          className="select-none object-contain pointer-events-none"
                          style={{
                            opacity:   (pageCfg.watermark_opacity  ?? 8)   / 100,
                            width:      pageCfg.watermark_size      ?? 384,
                            height:     pageCfg.watermark_size      ?? 384,
                            transform: `rotate(${pageCfg.watermark_rotation ?? 0}deg)`,
                          }} />
                      </div>
                    )}

                    {/* Corner logo — top-right, clickable to change when editing.
                        Skipped on page 0 when layout=none because DocHeader
                        renders it above the memo rows in content flow instead. */}
                    {decorated && (pageCfg.corner_logo_url || canEdit) && !(i === 0 && (headerCfg.layout ?? 'none') === 'none') && (
                      <div className="absolute z-10 pointer-events-auto" style={{ top: 16, right: 20 }}>
                        {canEdit ? (
                          <button type="button" title="Click to change logo"
                            onClick={() => setShowPageStyle(true)}
                            className="group relative block rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]">
                            {pageCfg.corner_logo_url ? (
                              <img src={pageCfg.corner_logo_url} alt=""
                                className="object-contain transition-opacity group-hover:opacity-75"
                                style={{
                                  width:     pageCfg.corner_logo_size     ?? 56,
                                  height:    pageCfg.corner_logo_size     ?? 56,
                                  opacity:  (pageCfg.corner_logo_opacity  ?? 100) / 100,
                                  transform: `rotate(${pageCfg.corner_logo_rotation ?? 0}deg)`,
                                }} />
                            ) : (
                              <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed border-[#bdc1c6] bg-white/60 text-[#bdc1c6]">
                                <Paintbrush className="h-5 w-5" />
                              </div>
                            )}
                            <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                              <Pencil className="h-4 w-4 text-white" />
                            </div>
                          </button>
                        ) : (
                          pageCfg.corner_logo_url && (
                            <img src={pageCfg.corner_logo_url} alt=""
                              className="object-contain"
                              style={{
                                width:     pageCfg.corner_logo_size     ?? 56,
                                height:    pageCfg.corner_logo_size     ?? 56,
                                opacity:  (pageCfg.corner_logo_opacity  ?? 100) / 100,
                                transform: `rotate(${pageCfg.corner_logo_rotation ?? 0}deg)`,
                              }} />
                          )
                        )}
                      </div>
                    )}

                    {/* Footer — bottom of every page */}
                    {decorated && pageCfg.footer_text && (
                      <div className="absolute bottom-0 left-0 right-0 z-10 flex flex-col items-center justify-end"
                        style={{ height: PAGE_MARGIN_PX, paddingBottom: 10 }}>
                        {pageCfg.footer_divider_above && (
                          <div className="w-full px-24 mb-1.5">
                            <div className="border-t" style={{ borderColor: pageCfg.footer_color ?? '#666666', opacity: 0.5 }} />
                          </div>
                        )}
                        <p className="text-center select-none px-24"
                          style={{
                            fontSize:      `${pageCfg.footer_size ?? 8}pt`,
                            color:          pageCfg.footer_color ?? '#666666',
                            fontWeight:     pageCfg.footer_bold ? 'bold' : 'normal',
                            letterSpacing: `${pageCfg.footer_letter_spacing ?? 0}px`,
                          }}>
                          {pageCfg.footer_text}
                        </p>
                        {pageCfg.footer_divider_below && (
                          <div className="w-full px-24 mt-1.5">
                            <div className="border-t" style={{ borderColor: pageCfg.footer_color ?? '#666666', opacity: 0.5 }} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  );
                })}

                {/* Page-break gaps — solid background masks any text bleeding out of pages */}
                {numPages > 1 && Array.from({ length: numPages - 1 }).map((_, i) => (
                  <div
                    key={`lbl-${i}`}
                    className="absolute left-0 right-0 z-30 flex items-center justify-center bg-[#f1f3f4]"
                    style={{ top: (i + 1) * PAGE_H + i * PAGE_GAP, height: PAGE_GAP, pointerEvents: canEdit ? 'auto' : 'none' }}
                  >
                    <span className="text-[9px] font-medium tracking-widest text-[#9aa0a6] uppercase select-none">
                      Page {i + 2}
                    </span>
                    {canEdit && (
                      <button
                        type="button"
                        title={`Delete all content on page ${i + 2}`}
                        onClick={() => deletePageContent(i + 2)}
                        className="ml-2 flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-medium text-[#9aa0a6] hover:bg-red-100 hover:text-red-500 transition-colors select-none"
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete page
                      </button>
                    )}
                  </div>
                ))}

                {/* Content — flows across all page backgrounds */}
                <div ref={docWrapRef} className="relative z-10">

                  {/* Document header (first page only) */}
                  <DocHeader
                    cfg={headerCfg} canEdit={canEdit}
                    onLogoUpload={() => logoFileInputRef.current?.click()}
                    onRemoveLogo={() => updateHeader({ logo_url: undefined })}
                    onCfgChange={updateHeader}
                    onCornerLogoClick={() => setShowPageStyle(true)}
                  />

                  {canEdit && showHeaderEdit && (
                    <HeaderEditPanel cfg={headerCfg} onCfgChange={updateHeader} onClose={() => setShowHeaderEdit(false)} />
                  )}

                  {/* Page style panel — in-flow so it sits below the header, but its
                      height is subtracted from scrollHeight so it never adds pages */}
                  {canEdit && showPageStyle && (
                    <div ref={pageStylePanelRef}>
                      <PageStylePanel cfg={headerCfg} onCfgChange={updateHeader} onClose={() => setShowPageStyle(false)} numPages={numPages} />
                    </div>
                  )}

                  {loading ? (
                    <div className="flex items-center justify-center py-32 text-sm text-[#80868b]">Loading…</div>
                  ) : (
                    <div className="px-[96px] pt-4 pb-[96px]">


                      <EditorContent editor={editor} className="doc-editor min-h-[400px] outline-none" />
                    </div>
                  )}
                </div>{/* /content */}
              </div>{/* /relative pages */}
            </div>
            </div>{/* /flex-1 px-4 py-8 */}
          </div>{/* /flex row */}
        </div>

        {/* ── Image options right panel ──────────────────────────────────── */}
        {imgAttrs && (
          <ImageOptionsPanel
            attrs={imgAttrs}
            onUpdate={handleImagePanelUpdate}
            onClose={() => {
              imgUpdaterRef.current = null;
              setImgAttrs(null);
              setImgNaturalSize(null);
            }}
            naturalSize={imgNaturalSize}
          />
        )}
      </div>

      {/* ── Status bar ─────────────────────────────────────────────────────── */}
      <div className="flex h-6 shrink-0 items-center justify-between border-t border-[#dadce0] bg-white px-6 text-[10px] text-[#5f6368] select-none z-10">
        <span>Page {numPages > 0 ? 1 : 1} of {numPages}</span>
        <span>{wordCount.toLocaleString()} word{wordCount !== 1 ? 's' : ''}</span>
      </div>
    </div>
  );
};

export default DocumentEditor;
