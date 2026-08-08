// ─────────────────────────────────────────────────────────────────────────────
// ImageInput.tsx
//
// URL or file-upload image picker.
// After uploading a file (and optionally when clicking "Adjust" on an existing
// image) a full-screen ImageCropModal opens so the user can drag and zoom the
// image into the right position before confirming.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useRef, useState } from 'react';
import { ImageIcon, Link2, Settings2, Upload, X } from 'lucide-react';
import ImageCropModal from './ImageCropModal';

export interface ImageAdjust {
  scale: number;   // 1.0 – 3.0
  posX:  number;   // 0 – 100  (CSS object-position X %)
  posY:  number;   // 0 – 100  (CSS object-position Y %)
}

export const DEFAULT_ADJUST: ImageAdjust = { scale: 1, posX: 50, posY: 50 };

interface ImageInputProps {
  value:           string;
  onChange:        (url: string) => void;
  adjust?:         ImageAdjust;
  onAdjustChange?: (a: ImageAdjust) => void;
  label:           string;
  accent?:         string;
  required?:       boolean;
  hint?:           string;
  labelClassName?: string;
  previewHeight?:  string;
  /** width÷height of the target display area — passed to the crop modal's frame. Default 2. */
  frameAspect?:    number;
}

export default function ImageInput({
  value,
  onChange,
  adjust,
  onAdjustChange,
  label,
  accent        = '#4384ff',
  required      = false,
  hint,
  labelClassName = 'mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]',
  previewHeight  = 'h-36',
  frameAspect    = 2,
}: ImageInputProps) {
  const [mode,        setMode]        = useState<'url' | 'upload'>('url');
  const [uploading,   setUploading]   = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Crop-modal state
  const [cropUrl,     setCropUrl]     = useState<string | null>(null);
  const [cropForNew,  setCropForNew]  = useState(false); // true = newly uploaded, false = re-adjusting

  const adj       = adjust ?? DEFAULT_ADJUST;
  const hasAdjust = !!onAdjustChange;

  /* ── helpers ──────────────────────────────────────────────────────────────── */
  const baseBtnCls    = 'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[10px] font-black transition-colors';
  const activeBtnCls  = `${baseBtnCls} border bg-[${accent}]/10 text-[${accent}]`;
  const inactiveBtnCls= `${baseBtnCls} border border-[#1f3050] text-[#526179] hover:text-[#a8b7cd] hover:border-[#2a3a50]`;

  const handleFile = async (file: File) => {
    setUploadError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res  = await fetch('/api/images/upload', { method: 'POST', body: fd });
      const json = await res.json().catch(() => ({})) as { url?: string; error?: string };
      if (!res.ok || !json.url) throw new Error(json.error ?? 'Upload failed.');

      // Always open the crop modal so the user can frame the image before confirming.
      // If onAdjustChange isn't wired up we still let them crop; adjustments just aren't saved.
      setCropForNew(true);
      setCropUrl(json.url);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed.';
      setUploadError(
        /failed to fetch|networkerror|load failed/i.test(msg)
          ? 'Could not reach the API to upload. Make sure the API server is running, then try again.'
          : msg,
      );
    } finally {
      setUploading(false);
    }
  };

  const openAdjust = () => {
    if (!value || !hasAdjust) return;
    setCropForNew(false);
    setCropUrl(value);
  };

  const onCropConfirm = (newAdj: ImageAdjust) => {
    if (cropForNew && cropUrl) onChange(cropUrl);
    onAdjustChange?.(newAdj);
    setCropUrl(null);
  };

  const onCropCancel = () => setCropUrl(null);

  /* ── image style ──────────────────────────────────────────────────────────── */
  const imgStyle: React.CSSProperties = imageStyle(adj.scale, adj.posX, adj.posY);

  return (
    <>
      {/* Crop modal — rendered in a portal above everything */}
      {cropUrl && (
        <ImageCropModal
          imageUrl={cropUrl}
          initialAdjust={cropForNew ? DEFAULT_ADJUST : adj}
          frameAspect={frameAspect}
          autoFit={cropForNew}
          onConfirm={onCropConfirm}
          onCancel={onCropCancel}
        />
      )}

      <div className="col-span-2 space-y-2">
        {/* Label row + mode toggle */}
        <div className="flex items-center justify-between">
          <label className={labelClassName}>
            {label}{required && <span className="ml-1 text-red-400">*</span>}
          </label>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => { setMode('url'); setUploadError(null); }}
              className={mode === 'url' ? activeBtnCls : inactiveBtnCls}
              style={mode === 'url' ? { borderColor: accent, color: accent } : undefined}
            >
              <Link2 className="h-3 w-3" />URL
            </button>
            <button
              type="button"
              onClick={() => { setMode('upload'); setUploadError(null); }}
              className={mode === 'upload' ? activeBtnCls : inactiveBtnCls}
              style={mode === 'upload' ? { borderColor: accent, color: accent } : undefined}
            >
              <Upload className="h-3 w-3" />Upload
            </button>
          </div>
        </div>

        {/* Input area */}
        {mode === 'url' ? (
          <input
            type="text"
            placeholder="https://…"
            value={value}
            onChange={e => onChange(e.target.value)}
            className="w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none transition-colors"
            onFocus={e => (e.target.style.borderColor = accent)}
            onBlur={e  => (e.target.style.borderColor = '')}
          />
        ) : (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[#1f3050] bg-[#07111f] px-3 py-5 text-xs font-semibold text-[#526179] transition-colors hover:text-[#a8b7cd] disabled:opacity-50"
              onMouseEnter={e => (e.currentTarget.style.borderColor = accent + '80')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = '')}
            >
              {uploading ? (
                <span className="flex items-center gap-2">
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                  </svg>
                  Uploading…
                </span>
              ) : (
                <>
                  <Upload className="h-3.5 w-3.5" />
                  Click or drag image here
                  <span className="text-[#3f5470]">· JPG PNG GIF WebP · max 8 MB</span>
                </>
              )}
            </button>
            {uploadError && <p className="text-[10px] text-red-400">{uploadError}</p>}
          </>
        )}

        {/* Preview + clear + adjust */}
        {value && (
          <div className={`relative overflow-hidden rounded-lg border border-[#1f3050] bg-[#07111f] ${previewHeight}`}>
            <img
              src={value}
              alt="Preview"
              className="h-full w-full"
              style={imgStyle}
              onError={e => { (e.target as HTMLImageElement).style.opacity = '0'; }}
              onLoad={e  => { (e.target as HTMLImageElement).style.opacity = '1'; }}
            />

            {/* Clear button */}
            <button
              type="button"
              onClick={() => { onChange(''); setUploadError(null); }}
              className="absolute right-1.5 top-1.5 rounded-full border border-[#1f3050] bg-[#0a1525]/80 p-1 text-[#526179] backdrop-blur-sm transition-colors hover:bg-red-500/20 hover:text-red-400"
              title="Clear image"
            >
              <X className="h-3 w-3" />
            </button>

            {/* Adjust button — only when parent has wired up adjust callbacks */}
            {hasAdjust && (
              <button
                type="button"
                onClick={openAdjust}
                className="absolute right-1.5 bottom-1.5 flex items-center gap-1 rounded-lg border border-[#1f3050] bg-[#0a1525]/80 px-2 py-1 backdrop-blur-sm transition-colors hover:border-[#4384ff]/60 hover:text-white"
                title="Adjust crop & zoom"
                style={{ color: accent }}
              >
                <Settings2 className="h-3 w-3" />
                <span className="text-[9px] font-black">Adjust</span>
              </button>
            )}

            {/* Uploaded badge */}
            {!value.startsWith('http') && (
              <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded border border-[#1f3050] bg-[#0a1525]/80 px-1.5 py-0.5 backdrop-blur-sm">
                <ImageIcon className="h-2.5 w-2.5 text-[#526179]" />
                <span className="text-[9px] font-semibold text-[#526179]">Uploaded</span>
              </div>
            )}
          </div>
        )}

        {hint && <p className="text-[10px] text-[#3f5470]">{hint}</p>}
      </div>
    </>
  );
}

/**
 * Build a CSS style object from stored adjust values (for card displays).
 *
 * scale < 1 → image is contained within the box (full image visible, background
 *             shows around edges).  CSS: object-fit: contain.
 * scale = 1 → image exactly fills / covers the box. CSS: object-fit: cover.
 * scale > 1 → zoomed-in further beyond cover.  CSS: cover + transform scale.
 */
export function imageStyle(
  scale = 1,
  posX  = 50,
  posY  = 50,
): React.CSSProperties {
  if (scale < 1) {
    // Contain: show the whole image, dark background visible around edges.
    return {
      objectFit:      'contain',
      objectPosition: `${posX}% ${posY}%`,
    };
  }
  return {
    objectFit:       'cover',
    objectPosition:  `${posX}% ${posY}%`,
    transform:       `scale(${scale})`,
    transformOrigin: `${posX}% ${posY}%`,
  };
}
