// ─────────────────────────────────────────────────────────────────────────────
// components/editor/ImageOptionsPanel.tsx  —  Image resize & alignment panel
//
// A floating panel that appears when an image is selected inside DocumentEditor.
// Lets the user set a specific pixel width/height, choose alignment (left /
// center / right / inline), and add alt text.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import type { ImageAlign, ImageNodeAttrs } from '../../extensions/ResizableImage';

// ── Recolour options ──────────────────────────────────────────────────────────
const RECOLOUR_OPTIONS: { id: string; label: string; swatch: string }[] = [
  { id: 'none',        label: 'No re-colour', swatch: 'bg-transparent border border-[#dadce0]' },
  { id: 'grayscale',   label: 'Grayscale',    swatch: 'bg-gradient-to-br from-gray-300 to-gray-600' },
  { id: 'sepia',       label: 'Sepia',        swatch: 'bg-gradient-to-br from-amber-300 to-amber-700' },
  { id: 'tint-red',    label: 'Red',          swatch: 'bg-red-500' },
  { id: 'tint-orange', label: 'Orange',       swatch: 'bg-orange-500' },
  { id: 'tint-yellow', label: 'Yellow',       swatch: 'bg-yellow-400' },
  { id: 'tint-green',  label: 'Green',        swatch: 'bg-green-500' },
  { id: 'tint-teal',   label: 'Teal',         swatch: 'bg-teal-500' },
  { id: 'tint-blue',   label: 'Blue',         swatch: 'bg-blue-500' },
  { id: 'invert',      label: 'Invert',       swatch: 'bg-gradient-to-br from-white to-black border border-[#dadce0]' },
];

// ── Collapsible section ───────────────────────────────────────────────────────
const Section = ({
  title, defaultOpen = true, children,
}: {
  title: string; defaultOpen?: boolean; children: React.ReactNode;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-[#e0e0e0]">
      <button
        type="button"
        onClick={() => setOpen(p => !p)}
        className="flex w-full items-center justify-between px-4 py-3 text-[13px] font-medium text-[#202124] hover:bg-[#f8f9fa] transition-colors"
      >
        {title}
        {open
          ? <ChevronDown className="h-3.5 w-3.5 text-[#5f6368]" />
          : <ChevronRight className="h-3.5 w-3.5 text-[#5f6368]" />}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
};

// ── Small number input ────────────────────────────────────────────────────────
const NumInput = ({
  value, onChange, min, max, step = 1, unit, label, width = 'w-16',
}: {
  value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number;
  unit?: string; label?: string; width?: string;
}) => (
  <div className="flex flex-col gap-0.5">
    {label && <span className="text-[10px] text-[#5f6368]">{label}</span>}
    <div className="flex items-center gap-0.5">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={e => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v)));
        }}
        className={`${width} rounded border border-[#dadce0] px-1.5 py-1 text-right text-[11px] text-[#202124] outline-none focus:border-[#1a73e8] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
      />
      {unit && <span className="text-[10px] text-[#5f6368] w-6 shrink-0">{unit}</span>}
    </div>
  </div>
);

// ── Slider row ────────────────────────────────────────────────────────────────
const SliderRow = ({
  label, value, min, max, onChange,
}: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void;
}) => (
  <div className="flex flex-col gap-1.5 mb-3">
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-[#5f6368]">{label}</span>
      <div className="flex items-center gap-0.5">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={e => {
            const v = parseInt(e.target.value, 10);
            if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
          }}
          className="w-12 rounded border border-[#dadce0] px-1 py-0.5 text-right text-[10px] text-[#202124] outline-none focus:border-[#1a73e8] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <span className="text-[10px] text-[#5f6368]">%</span>
      </div>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      value={value}
      onChange={e => onChange(parseInt(e.target.value, 10))}
      className="h-1 w-full cursor-pointer appearance-none rounded-full bg-[#dadce0] [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#1a73e8]"
    />
  </div>
);

// ── Text wrapping SVG icons ───────────────────────────────────────────────────
const WrapIcons: Record<string, React.ReactNode> = {
  inline: (
    <svg viewBox="0 0 36 28" className="h-8 w-9" fill="currentColor">
      <rect x="1" y="1" width="34" height="26" rx="2" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.2"/>
      <rect x="4" y="5"  width="28" height="2" rx="0.8" opacity="0.35"/>
      <rect x="4" y="9"  width="14" height="2" rx="0.8" opacity="0.35"/>
      <rect x="19" y="9" width="5" height="8" rx="0.6" opacity="0.9"/>
      <rect x="4" y="9"  width="13" height="8" rx="0.6" opacity="0.35"/>
      <rect x="25" y="9" width="7" height="2" rx="0.8" opacity="0.35"/>
      <rect x="4" y="19" width="28" height="2" rx="0.8" opacity="0.35"/>
      <rect x="4" y="23" width="18" height="2" rx="0.8" opacity="0.35"/>
    </svg>
  ),
  wrap: (
    <svg viewBox="0 0 36 28" className="h-8 w-9" fill="currentColor">
      <rect x="1" y="1" width="34" height="26" rx="2" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.2"/>
      <rect x="4" y="5" width="10" height="14" rx="1" opacity="0.9"/>
      <rect x="16" y="5"  width="16" height="2" rx="0.8" opacity="0.35"/>
      <rect x="16" y="9"  width="16" height="2" rx="0.8" opacity="0.35"/>
      <rect x="16" y="13" width="11" height="2" rx="0.8" opacity="0.35"/>
      <rect x="4"  y="21" width="28" height="2" rx="0.8" opacity="0.35"/>
      <rect x="4"  y="24" width="20" height="2" rx="0.8" opacity="0.35"/>
    </svg>
  ),
  'wrap-right': (
    <svg viewBox="0 0 36 28" className="h-8 w-9" fill="currentColor">
      <rect x="1" y="1" width="34" height="26" rx="2" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.2"/>
      <rect x="22" y="5" width="10" height="14" rx="1" opacity="0.9"/>
      <rect x="4"  y="5"  width="16" height="2" rx="0.8" opacity="0.35"/>
      <rect x="4"  y="9"  width="16" height="2" rx="0.8" opacity="0.35"/>
      <rect x="4"  y="13" width="11" height="2" rx="0.8" opacity="0.35"/>
      <rect x="4"  y="21" width="28" height="2" rx="0.8" opacity="0.35"/>
      <rect x="4"  y="24" width="20" height="2" rx="0.8" opacity="0.35"/>
    </svg>
  ),
  break: (
    <svg viewBox="0 0 36 28" className="h-8 w-9" fill="currentColor">
      <rect x="1" y="1" width="34" height="26" rx="2" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.2"/>
      <rect x="4" y="3"  width="28" height="2"  rx="0.8" opacity="0.35"/>
      <rect x="4" y="7"  width="22" height="2"  rx="0.8" opacity="0.35"/>
      <rect x="4" y="11" width="28" height="10" rx="1"   opacity="0.9"/>
      <rect x="4" y="23" width="28" height="2"  rx="0.8" opacity="0.35"/>
    </svg>
  ),
  behind: (
    <svg viewBox="0 0 36 28" className="h-8 w-9" fill="currentColor" opacity="0.35">
      <rect x="1" y="1" width="34" height="26" rx="2" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.4"/>
      <rect x="4" y="5"  width="28" height="18" rx="1" opacity="0.5"/>
      <rect x="4" y="7"  width="28" height="2"  rx="0.8" fill="white" opacity="0.7"/>
      <rect x="4" y="11" width="22" height="2"  rx="0.8" fill="white" opacity="0.7"/>
      <rect x="4" y="15" width="26" height="2"  rx="0.8" fill="white" opacity="0.7"/>
    </svg>
  ),
  front: (
    <svg viewBox="0 0 36 28" className="h-8 w-9" fill="currentColor" opacity="0.35">
      <rect x="1" y="1" width="34" height="26" rx="2" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.4"/>
      <rect x="4" y="5"  width="28" height="2"  rx="0.8" opacity="0.5"/>
      <rect x="4" y="9"  width="22" height="2"  rx="0.8" opacity="0.5"/>
      <rect x="4" y="13" width="26" height="2"  rx="0.8" opacity="0.5"/>
      <rect x="8" y="8"  width="20" height="14" rx="1"   opacity="0.9"/>
    </svg>
  ),
};

// ── Main panel component ──────────────────────────────────────────────────────
interface Props {
  attrs: ImageNodeAttrs;
  onUpdate: (patch: Partial<ImageNodeAttrs>) => void;
  onClose: () => void;
  naturalSize: { w: number; h: number } | null;
}

const ImageOptionsPanel = ({ attrs, onUpdate, onClose, naturalSize }: Props) => {
  // Local mirror of attrs so inputs feel responsive
  const [local, setLocal] = useState<ImageNodeAttrs>(attrs);
  const [lockAspect, setLockAspect] = useState(true);
  const applyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync when external changes arrive (e.g. from floating toolbar)
  useEffect(() => { setLocal(attrs); }, [attrs]);

  const apply = (patch: Partial<ImageNodeAttrs>) => {
    setLocal(prev => ({ ...prev, ...patch }));
    onUpdate(patch);
  };

  const applyDebounced = (patch: Partial<ImageNodeAttrs>) => {
    setLocal(prev => ({ ...prev, ...patch }));
    if (applyTimer.current) clearTimeout(applyTimer.current);
    applyTimer.current = setTimeout(() => onUpdate(patch), 300);
  };

  // ── Helpers ─────────────────────────────────────────────────────────────
  const currentWidth  = local.width  ?? naturalSize?.w ?? 0;
  const currentHeight = local.height ?? naturalSize?.h ?? 0;
  const aspectRatio   = naturalSize ? naturalSize.w / naturalSize.h : 1;

  const handleWidthChange = (v: number) => {
    const patch: Partial<ImageNodeAttrs> = { width: v };
    if (lockAspect && v > 0) patch.height = Math.round(v / aspectRatio);
    apply(patch);
  };

  const handleHeightChange = (v: number) => {
    const patch: Partial<ImageNodeAttrs> = { height: v };
    if (lockAspect && v > 0) patch.width = Math.round(v * aspectRatio);
    apply(patch);
  };

  const handleWidthScale = (pct: number) => {
    if (!naturalSize) return;
    const w = Math.round((naturalSize.w * pct) / 100);
    const patch: Partial<ImageNodeAttrs> = { width: w };
    if (lockAspect) patch.height = Math.round(w / aspectRatio);
    apply(patch);
  };

  const handleHeightScale = (pct: number) => {
    if (!naturalSize) return;
    const h = Math.round((naturalSize.h * pct) / 100);
    const patch: Partial<ImageNodeAttrs> = { height: h };
    if (lockAspect) patch.width = Math.round(h * aspectRatio);
    apply(patch);
  };

  const widthScale  = naturalSize && currentWidth  ? Math.round((currentWidth  / naturalSize.w) * 100) : 100;
  const heightScale = naturalSize && currentHeight ? Math.round((currentHeight / naturalSize.h) * 100) : 100;

  const isFloat = local.align === 'float-left' || local.align === 'float-right';

  // Derive wrapping mode
  const wrapMode = isFloat ? 'wrap' : local.align === 'left' ? 'break' : 'inline';
  const wrapSide = local.align === 'float-right' ? 'right' : 'left';

  const WRAP_CARDS = [
    { id: 'inline',   label: 'In line with\ntext',     icon: 'inline',  disabled: false },
    { id: 'wrap',     label: 'Wrap text',               icon: 'wrap',    disabled: false },
    { id: 'break',    label: 'Break text',              icon: 'break',   disabled: false },
    { id: 'behind',   label: 'Behind text',             icon: 'behind',  disabled: true  },
    { id: 'front',    label: 'In front of\ntext',       icon: 'front',   disabled: true  },
  ];

  const handleWrapCard = (id: string) => {
    if (id === 'inline') apply({ align: 'center' });
    else if (id === 'wrap') apply({ align: wrapSide === 'right' ? 'float-right' : 'float-left' });
    else if (id === 'break') apply({ align: 'left' });
  };

  const currentRecolourLabel = RECOLOUR_OPTIONS.find(r => r.id === local.recolour)?.label ?? 'No re-colour';

  return (
    <div className="flex h-full w-72 shrink-0 flex-col border-l border-[#e0e0e0] bg-white overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-[#e0e0e0] px-4 py-3">
        <span className="text-[13px] font-medium text-[#202124]">Image options</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-[#5f6368] hover:bg-[#f1f3f4] transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">

        {/* ── Size and rotation ── */}
        <Section title="Size and rotation">
          {/* Size */}
          <p className="mb-2 text-[11px] font-medium text-[#5f6368]">Size</p>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <NumInput label="Width" value={currentWidth} min={1} max={4000} onChange={handleWidthChange} unit="px" width="w-full" />
            <NumInput label="Height" value={currentHeight} min={1} max={4000} onChange={handleHeightChange} unit="px" width="w-full" />
          </div>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <NumInput label="Width scale" value={widthScale} min={1} max={500} onChange={handleWidthScale} unit="%" width="w-full" />
            <NumInput label="Height scale" value={heightScale} min={1} max={500} onChange={handleHeightScale} unit="%" width="w-full" />
          </div>
          {/* Lock aspect ratio */}
          <label className="mb-4 flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={lockAspect}
              onChange={e => setLockAspect(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-[#dadce0] accent-[#1a73e8]"
            />
            <span className="text-[11px] text-[#5f6368]">Lock aspect ratio</span>
          </label>

          {/* Rotate */}
          <p className="mb-2 text-[11px] font-medium text-[#5f6368]">Rotate</p>
          <div className="flex items-end gap-2">
            <NumInput label="Angle" value={local.angle ?? 0} min={0} max={359} onChange={v => apply({ angle: v })} unit="°" width="w-14" />
            <button
              type="button"
              title="Rotate 90°"
              onClick={() => apply({ angle: ((local.angle ?? 0) + 90) % 360 })}
              className="mb-px flex h-8 w-8 items-center justify-center rounded border border-[#dadce0] text-[10px] font-semibold text-[#5f6368] hover:bg-[#f1f3f4] transition-colors"
            >
              90°
            </button>
          </div>
        </Section>

        {/* ── Text wrapping ── */}
        <Section title="Text wrapping">
          {/* 5 wrap mode cards */}
          <div className="mb-3 flex gap-1.5">
            {WRAP_CARDS.map(card => (
              <button
                key={card.id}
                type="button"
                disabled={card.disabled}
                onClick={() => !card.disabled && handleWrapCard(card.id)}
                title={card.disabled ? 'Not supported in this editor' : card.label}
                className={`flex flex-col items-center gap-1 rounded border px-1.5 py-1.5 transition-all
                  ${card.disabled ? 'cursor-not-allowed border-[#f1f3f4] opacity-40' :
                    wrapMode === card.id
                      ? 'border-[#1a73e8] bg-[#e8f0fe] text-[#1a73e8]'
                      : 'border-[#dadce0] text-[#444746] hover:border-[#80868b]'}`}
              >
                {WrapIcons[card.icon]}
                <span className="whitespace-pre-wrap text-center text-[8px] font-medium leading-tight">
                  {card.label}
                </span>
              </button>
            ))}
          </div>

          {/* Wrap side — only shown in wrap mode */}
          {wrapMode === 'wrap' && (
            <div className="mb-3">
              <p className="mb-1.5 text-[10px] text-[#5f6368]">Wrap</p>
              <div className="flex gap-2">
                {(['left', 'right'] as const).map(side => (
                  <button
                    key={side}
                    type="button"
                    onClick={() => apply({ align: side === 'left' ? 'float-left' : 'float-right' })}
                    className={`flex-1 rounded border py-1.5 text-xs font-medium transition-all capitalize
                      ${wrapSide === side
                        ? 'border-[#1a73e8] bg-[#e8f0fe] text-[#1a73e8]'
                        : 'border-[#dadce0] text-[#5f6368] hover:border-[#80868b]'}`}
                  >
                    {side}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Margins from text */}
          {wrapMode === 'wrap' && (
            <>
              <p className="mb-2 mt-1 text-[11px] font-medium text-[#5f6368]">Margins from text</p>
              <div className="grid grid-cols-2 gap-2">
                <NumInput label="Top"    value={local.marginTop    ?? 0} min={0} max={200} onChange={v => apply({ marginTop:    v })} unit="px" width="w-full" />
                <NumInput label="Bottom" value={local.marginBottom ?? 0} min={0} max={200} onChange={v => apply({ marginBottom: v })} unit="px" width="w-full" />
                <NumInput label="Left"   value={local.marginLeft   ?? 0} min={0} max={200} onChange={v => apply({ marginLeft:   v })} unit="px" width="w-full" />
                <NumInput label="Right"  value={local.marginRight  ?? 0} min={0} max={200} onChange={v => apply({ marginRight:  v })} unit="px" width="w-full" />
              </div>
            </>
          )}
        </Section>

        {/* ── Position ── */}
        <Section title="Position" defaultOpen={false}>
          <p className="text-[11px] text-[#5f6368]">
            Position controls are available for wrapped images via the margin inputs in Text wrapping.
          </p>
        </Section>

        {/* ── Re-colour ── */}
        <Section title="Re-colour" defaultOpen={false}>
          {/* Swatch grid */}
          <div className="mb-3 grid grid-cols-5 gap-1.5">
            {RECOLOUR_OPTIONS.map(opt => (
              <button
                key={opt.id}
                type="button"
                title={opt.label}
                onClick={() => apply({ recolour: opt.id })}
                className={`relative h-8 w-full rounded border-2 transition-all ${opt.swatch}
                  ${local.recolour === opt.id ? 'border-[#1a73e8]' : 'border-transparent hover:border-[#80868b]'}`}
              >
                {opt.id === 'none' && (
                  <span className="absolute inset-0 flex items-center justify-center text-[8px] text-[#5f6368]">None</span>
                )}
              </button>
            ))}
          </div>
          {/* Dropdown label */}
          <div className="flex items-center justify-between rounded border border-[#dadce0] px-2.5 py-1.5">
            <span className="text-[11px] text-[#202124]">{currentRecolourLabel}</span>
            <svg viewBox="0 0 12 12" className="h-3 w-3 text-[#5f6368]" fill="currentColor">
              <path d="M6 8L1 3h10z"/>
            </svg>
          </div>
        </Section>

        {/* ── Adjustments ── */}
        <Section title="Adjustments" defaultOpen={false}>
          <SliderRow
            label="Opacity"
            value={local.opacity ?? 100}
            min={0} max={100}
            onChange={v => applyDebounced({ opacity: v })}
          />
          <SliderRow
            label="Brightness"
            value={local.brightness ?? 0}
            min={-100} max={100}
            onChange={v => applyDebounced({ brightness: v })}
          />
          <SliderRow
            label="Contrast"
            value={local.contrast ?? 0}
            min={-100} max={100}
            onChange={v => applyDebounced({ contrast: v })}
          />
          <button
            type="button"
            onClick={() => apply({ opacity: 100, brightness: 0, contrast: 0, recolour: 'none' })}
            className="mt-1 rounded border border-[#dadce0] px-4 py-1.5 text-[11px] font-medium text-[#5f6368] hover:bg-[#f1f3f4] transition-colors"
          >
            Reset
          </button>
        </Section>

        {/* ── Alt text ── */}
        <Section title="Alt text" defaultOpen={false}>
          <textarea
            value={local.altText ?? ''}
            onChange={e => applyDebounced({ altText: e.target.value })}
            placeholder="Describe this image for accessibility…"
            rows={3}
            className="w-full resize-none rounded border border-[#dadce0] px-2.5 py-2 text-[11px] text-[#202124] placeholder:text-[#bdc1c6] outline-none focus:border-[#1a73e8] transition-colors"
          />
          <p className="mt-1 text-[9px] text-[#5f6368]">
            Used by screen readers and displayed when the image cannot load.
          </p>
        </Section>

      </div>
    </div>
  );
};

export default ImageOptionsPanel;
