// ─────────────────────────────────────────────────────────────────────────────
// ImageCropModal.tsx
// ─────────────────────────────────────────────────────────────────────────────
// A Discord-style image-crop / reposition modal.
//
// Two separate scales are tracked:
//
//   baseScale   – display scale in the canvas  (natural size, capped to canvas)
//   coverScale  – the CSS object-fit:cover scale for the FRAME dimensions
//
// The canvas lets the user see the image at its natural size and drag it.
//
// Scale semantics:
//   zoom < 1  → image is "contained" within the frame (full image visible,
//               some frame space empty).  CSS: object-fit:contain.
//   zoom = 1  → image exactly covers the frame at coverScale.
//   zoom > 1  → additional zoom-in beyond cover.
//
// Math (posX, same for posY — used when zoom ≥ 1):
//   overflowX   = max(0, naturalW × coverScale × zoom − FRAME_W)
//   focusX_nat  = (cx − imgX) / (baseScale × zoom)          ← canvas centre → natural px
//   posX%       = 100 × (focusX_nat × coverScale × zoom − FRAME_W/2) / overflowX
//
// Inverse (posX → imgX, used for initialisation):
//   focusX_nat  = (posX/100 × overflowX + FRAME_W/2) / (coverScale × zoom)
//   imgX        = cx − focusX_nat × baseScale × zoom
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';
import { type ImageAdjust, DEFAULT_ADJUST, imageStyle } from './ImageInput';

interface Props {
  imageUrl:       string;
  initialAdjust?: ImageAdjust;
  /** width ÷ height of target display area (default 2 = landscape card). */
  frameAspect?:   number;
  /**
   * When true (new upload), auto-size the image to "contain" within the frame
   * so the full image is visible by default.  The user can zoom in from there.
   */
  autoFit?:       boolean;
  onConfirm:      (adjust: ImageAdjust) => void;
  onCancel:       () => void;
}

// Canvas layout constants
const CANVAS_W = 400;
const CANVAS_H = 300;
const cx       = CANVAS_W / 2;
const cy       = CANVAS_H / 2;

/** Slider minimum — allows zooming out to contain mode. */
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;

export default function ImageCropModal({
  imageUrl,
  initialAdjust = DEFAULT_ADJUST,
  frameAspect   = 2,
  autoFit       = false,
  onConfirm,
  onCancel,
}: Props) {
  const FRAME_H = Math.min(220, CANVAS_H - 40);
  const FRAME_W = Math.min(Math.round(FRAME_H * frameAspect), CANVAS_W - 40);

  // ── Natural image dimensions (loaded once) ─────────────────────────────────
  const [naturalW, setNaturalW] = useState(0);
  const [naturalH, setNaturalH] = useState(0);
  const [loaded,   setLoaded]   = useState(false);

  // baseScale  = display scale: natural size, shrunk only if larger than canvas
  // coverScale = CSS cover scale for the FRAME (what the card uses)
  const baseScale  = naturalW && naturalH ? Math.min(1, CANVAS_W / naturalW, CANVAS_H / naturalH) : 1;
  const coverScale = naturalW && naturalH ? Math.max(FRAME_W / naturalW, FRAME_H / naturalH) : 1;

  // ── Crop state ─────────────────────────────────────────────────────────────
  const [zoom, setZoom] = useState(initialAdjust.scale);
  const [imgX, setImgX] = useState(0);   // top-left of scaled image in canvas
  const [imgY, setImgY] = useState(0);

  // Refs for stale-closure safety
  const imgXRef       = useRef(0);
  const imgYRef       = useRef(0);
  const zoomRef       = useRef(zoom);
  const baseScaleRef  = useRef(baseScale);
  const coverScaleRef = useRef(coverScale);

  const syncPos = (x: number, y: number) => {
    imgXRef.current = x; imgYRef.current = y;
    setImgX(x); setImgY(y);
  };

  // ── Clamp ─────────────────────────────────────────────────────────────────
  // If the image (at display scale) covers the frame: keep frame fully covered.
  // If image is smaller than frame: force it centred inside the frame.
  const clampPos = useCallback((x: number, y: number, z: number): [number, number] => {
    const ts  = baseScaleRef.current * z;
    const dw  = naturalW * ts;
    const dh  = naturalH * ts;
    const cx2 = CANVAS_W / 2, cy2 = CANVAS_H / 2;
    const fw2 = FRAME_W / 2,  fh2 = FRAME_H / 2;

    // Cover branch: image is at least as wide as the frame → keep frame covered.
    // Contain branch: image is narrower than the frame → centre it in the frame.
    const cx_ = dw >= FRAME_W
      ? Math.min(cx2 - fw2, Math.max(cx2 + fw2 - dw, x))
      : cx2 - dw / 2;

    const cy_ = dh >= FRAME_H
      ? Math.min(cy2 - fh2, Math.max(cy2 + fh2 - dh, y))
      : cy2 - dh / 2;

    return [cx_, cy_];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naturalW, naturalH, FRAME_W, FRAME_H]);

  // ── Convert CSS posX/posY → canvas imgX/imgY ──────────────────────────────
  const posToImg = useCallback((posX: number, posY: number, z: number): [number, number] => {
    const cs  = coverScaleRef.current;
    const bs  = baseScaleRef.current;
    const ets = cs * z;   // effective total CSS scale
    const ovX = Math.max(0, naturalW * ets - FRAME_W);
    const ovY = Math.max(0, naturalH * ets - FRAME_H);
    const focX = ovX > 0 ? (posX / 100 * ovX + FRAME_W / 2) / ets : naturalW / 2;
    const focY = ovY > 0 ? (posY / 100 * ovY + FRAME_H / 2) / ets : naturalH / 2;
    return [cx - focX * bs * z, cy - focY * bs * z];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naturalW, naturalH, FRAME_W, FRAME_H]);

  // ── Convert canvas imgX/imgY → CSS posX/posY ─────────────────────────────
  const imgToPos = (): { posX: number; posY: number } => {
    if (!naturalW || !naturalH) return { posX: 50, posY: 50 };
    const cs  = coverScaleRef.current;
    const bs  = baseScaleRef.current;
    const z   = zoomRef.current;
    const ets = cs * z;
    const ovX = Math.max(0, naturalW * ets - FRAME_W);
    const ovY = Math.max(0, naturalH * ets - FRAME_H);
    const focX = (cx - imgXRef.current) / (bs * z);  // natural px at canvas centre
    const focY = (cy - imgYRef.current) / (bs * z);
    const px = ovX > 0 ? 100 * (focX * ets - FRAME_W / 2) / ovX : 50;
    const py = ovY > 0 ? 100 * (focY * ets - FRAME_H / 2) / ovY : 50;
    return {
      posX: Math.max(0, Math.min(100, px)),
      posY: Math.max(0, Math.min(100, py)),
    };
  };

  // ── Compute "contain" zoom — the largest zoom at which the full image fits ─
  // within the canvas frame.  Used to initialise auto-fit on new uploads.
  const computeContainZoom = (nw: number, nh: number, bs: number): number => {
    if (!nw || !nh || !bs) return 1;
    const zx = FRAME_W / (nw * bs);
    const zy = FRAME_H / (nh * bs);
    // If the image already fits at zoom=1, don't zoom out further.
    return Math.max(ZOOM_MIN, Math.min(1, zx, zy));
  };

  // ── Initialise from initialAdjust (or auto-fit) when image loads ──────────
  useEffect(() => {
    if (!loaded || !naturalW || !naturalH) return;
    const bs = Math.min(1, CANVAS_W / naturalW, CANVAS_H / naturalH);
    const cs = Math.max(FRAME_W / naturalW, FRAME_H / naturalH);
    baseScaleRef.current  = bs;
    coverScaleRef.current = cs;

    const initZoom = autoFit
      ? computeContainZoom(naturalW, naturalH, bs)
      : initialAdjust.scale;

    zoomRef.current = initZoom;
    setZoom(initZoom);

    const [x, y] = posToImg(initialAdjust.posX, initialAdjust.posY, initZoom);
    const [cx_, cy_] = clampPos(x, y, initZoom);
    syncPos(cx_, cy_);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, naturalW, naturalH]);

  // ── Keep focus point stable while zoom changes ───────────────────────────
  useEffect(() => {
    if (!loaded || !naturalW) return;
    // Save current CSS posX/posY before zoom changes
    const { posX: px, posY: py } = imgToPos();
    baseScaleRef.current  = Math.min(1, CANVAS_W / naturalW, CANVAS_H / naturalH);
    coverScaleRef.current = Math.max(FRAME_W / naturalW, FRAME_H / naturalH);
    zoomRef.current = zoom;
    const [x, y] = posToImg(px, py, zoom);
    const [cx_, cy_] = clampPos(x, y, zoom);
    syncPos(cx_, cy_);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  // ── Drag ──────────────────────────────────────────────────────────────────
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ mouseX: 0, mouseY: 0, imgX: 0, imgY: 0 });

  const onMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    dragStart.current = { mouseX: e.clientX, mouseY: e.clientY, imgX: imgXRef.current, imgY: imgYRef.current };
    e.preventDefault();
  };

  const onMouseMove = useCallback((e: MouseEvent) => {
    const dx = e.clientX - dragStart.current.mouseX;
    const dy = e.clientY - dragStart.current.mouseY;
    const [nx, ny] = clampPos(dragStart.current.imgX + dx, dragStart.current.imgY + dy, zoomRef.current);
    syncPos(nx, ny);
  }, [clampPos]);

  const onMouseUp = useCallback(() => setIsDragging(false), []);

  useEffect(() => {
    if (!isDragging) return;
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup',  onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup',  onMouseUp);
    };
  }, [isDragging, onMouseMove, onMouseUp]);

  // ── Keyboard close ────────────────────────────────────────────────────────
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onCancel]);

  // ── Derived values for render ─────────────────────────────────────────────
  const totalScale  = baseScale * zoom;
  const dispW       = naturalW * totalScale;
  const dispH       = naturalH * totalScale;
  const { posX, posY } = imgToPos();

  const frameLeft = cx - FRAME_W / 2;
  const frameTop  = cy - FRAME_H / 2;

  // ── Reset — return to auto-fit (if autoFit) or initial zoom ───────────────
  const handleReset = () => {
    const targetZoom = autoFit
      ? computeContainZoom(naturalW, naturalH, baseScale)
      : 1;
    setZoom(targetZoom);
    setTimeout(() => {
      baseScaleRef.current  = Math.min(1, CANVAS_W / naturalW, CANVAS_H / naturalH);
      coverScaleRef.current = Math.max(FRAME_W / naturalW, FRAME_H / naturalH);
      zoomRef.current = targetZoom;
      const [x, y] = posToImg(50, 50, targetZoom);
      const [cx_, cy_] = clampPos(x, y, targetZoom);
      syncPos(cx_, cy_);
    }, 0);
  };

  // ── Finish ────────────────────────────────────────────────────────────────
  const handleFinish = () => {
    const { posX: px, posY: py } = imgToPos();
    onConfirm({ scale: zoom, posX: px, posY: py });
  };

  // ── Zoom label ────────────────────────────────────────────────────────────
  const zoomLabel = zoom < 1 ? `${Math.round(zoom * 100)}%` : `${zoom.toFixed(2)}×`;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="flex w-full max-w-[640px] rounded-2xl border border-[#1e3050] bg-[#0d1520] shadow-2xl overflow-hidden">

        {/* ── Left: canvas ──────────────────────────────────────────────── */}
        <div className="flex flex-col flex-1 min-w-0">

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#172235] shrink-0">
            <h3 className="text-sm font-black text-white">Adjust Image</h3>
            <div className="flex items-center gap-1">
              <button type="button" onClick={handleReset} title="Reset to fit"
                className="rounded p-1.5 text-[#526179] hover:text-white transition-colors">
                <RotateCcw className="h-4 w-4" />
              </button>
              <button type="button" onClick={onCancel}
                className="rounded p-1.5 text-[#526179] hover:text-white transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Canvas */}
          <div
            className="relative select-none overflow-hidden shrink-0"
            style={{
              width: CANVAS_W, height: CANVAS_H,
              background: '#070d16',
              cursor: isDragging ? 'grabbing' : (loaded ? (zoom >= 1 ? 'grab' : 'default') : 'default'),
            }}
            onMouseDown={loaded && zoom >= 1 ? onMouseDown : undefined}
          >
            {/* Checkerboard */}
            <div className="absolute inset-0" style={{
              backgroundImage: 'repeating-conic-gradient(#141e2e 0% 25%, #0a1220 0% 50%)',
              backgroundSize: '18px 18px', opacity: 0.6,
            }} />

            {/* Image */}
            {loaded && naturalW > 0 && (
              <img src={imageUrl} alt="crop-canvas" draggable={false}
                className="absolute pointer-events-none"
                style={{ width: dispW, height: dispH, left: imgX, top: imgY }}
              />
            )}

            {/* Vignette + white frame border */}
            {loaded && (
              <div className="absolute pointer-events-none" style={{
                left: frameLeft, top: frameTop,
                width: FRAME_W, height: FRAME_H,
                boxShadow: `0 0 0 ${CANVAS_W + CANVAS_H}px rgba(0,0,0,0.55)`,
                border: '2px solid rgba(255,255,255,0.85)',
                zIndex: 2,
              }} />
            )}

            {/* Contain hint — shown when image is smaller than frame */}
            {loaded && zoom < 1 && (
              <div className="absolute pointer-events-none" style={{
                left: frameLeft, top: frameTop,
                width: FRAME_W, height: FRAME_H,
                zIndex: 3,
                display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                paddingBottom: 6,
              }}>
                <span style={{
                  fontSize: 9, color: 'rgba(255,255,255,0.35)', fontWeight: 700,
                  letterSpacing: '0.08em', textTransform: 'uppercase',
                }}>
                  Zoom in to fill frame
                </span>
              </div>
            )}

            {/* Loading spinner */}
            {!loaded && (
              <div className="absolute inset-0 flex items-center justify-center">
                <svg className="h-6 w-6 animate-spin text-[#526179]" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              </div>
            )}
          </div>

          {/* Hidden img — loads natural dimensions */}
          <img src={imageUrl} alt="" className="hidden"
            onLoad={e => {
              const el = e.target as HTMLImageElement;
              setNaturalW(el.naturalWidth);
              setNaturalH(el.naturalHeight);
              setLoaded(true);
            }}
          />

          <p className="text-center text-[10px] text-[#3f5470] py-2 shrink-0">
            {zoom >= 1 ? 'Drag image to reposition' : 'Zoom in to crop & reposition'}
          </p>

          {/* Zoom slider */}
          <div className="flex items-center gap-3 px-5 pb-4 shrink-0">
            <button type="button"
              onClick={() => setZoom(z => Math.max(ZOOM_MIN, parseFloat((z - 0.05).toFixed(2))))}
              className="rounded p-1 text-[#526179] hover:text-white transition-colors">
              <ZoomOut className="h-4 w-4" />
            </button>
            <div className="relative flex-1">
              <input type="range" min={ZOOM_MIN} max={ZOOM_MAX} step={0.05} value={zoom}
                onChange={e => setZoom(parseFloat(e.target.value))}
                className="w-full h-1 rounded-full appearance-none cursor-pointer"
                style={{ accentColor: '#4384ff', background: '#1f3050' }}
              />
              {/* "Fill" marker at zoom=1 */}
              <div
                className="absolute top-1/2 -translate-y-1/2 w-0.5 h-3 rounded-full bg-[#4384ff]/40 pointer-events-none"
                style={{ left: `${((1 - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)) * 100}%` }}
                title="Fill frame"
              />
            </div>
            <button type="button"
              onClick={() => setZoom(z => Math.min(ZOOM_MAX, parseFloat((z + 0.05).toFixed(2))))}
              className="rounded p-1 text-[#526179] hover:text-white transition-colors">
              <ZoomIn className="h-4 w-4" />
            </button>
            <span className="text-[9px] font-black tabular-nums text-[#4384ff] w-8 text-right">
              {zoomLabel}
            </span>
          </div>
        </div>

        {/* ── Right: preview + actions ───────────────────────────────────── */}
        <div className="flex flex-col border-l border-[#172235] bg-[#091018] px-4 py-5 gap-4 shrink-0"
          style={{ width: 160 }}>
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#526179] mb-2">Preview</p>

            {/* Landscape (card-sized) */}
            <div className="relative overflow-hidden rounded-lg border border-[#1f3050] bg-[#07111f] mb-2"
              style={{ height: 70 }}>
              {loaded && (
                <img src={imageUrl} alt="preview-wide" className="absolute inset-0 w-full h-full"
                  style={imageStyle(zoom, posX, posY)} />
              )}
            </div>

            {/* Square (icon-sized) */}
            <div className="relative overflow-hidden rounded-lg border border-[#1f3050] bg-[#07111f]"
              style={{ height: 60, width: 60 }}>
              {loaded && (
                <img src={imageUrl} alt="preview-sq" className="absolute inset-0 w-full h-full"
                  style={imageStyle(zoom, posX, posY)} />
              )}
            </div>
            <p className="text-[8px] text-[#3f5470] mt-1">Card · Icon</p>
          </div>

          <div className="mt-auto flex flex-col gap-2">
            <button type="button" onClick={handleFinish} disabled={!loaded}
              className="w-full rounded-lg bg-[#4384ff] px-3 py-2 text-xs font-black text-white hover:bg-[#2f6fe0] transition-colors disabled:opacity-50">
              Finish
            </button>
            <button type="button" onClick={onCancel}
              className="w-full rounded-lg border border-[#1f3050] px-3 py-2 text-xs font-black text-[#526179] hover:text-white hover:border-[#2a3a50] transition-colors">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
