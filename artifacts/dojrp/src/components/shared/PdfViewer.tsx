// ─────────────────────────────────────────────────────────────────────────────
// components/shared/PdfViewer.tsx  —  In-app PDF viewer
//
// Renders PDF resources directly in the page using pdf.js, so members never
// depend on their browser's built-in PDF plugin. All pages are rendered in a
// continuous scrollable column; the toolbar tracks the page currently in view
// and lets members jump to a specific page, zoom, or download.
// Uses the same pdfjs-dist version already bundled for the document editor.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

interface PdfViewerProps {
  /** URL of the PDF file to display. */
  fileUrl: string;
  /** Filename used for the download button. */
  downloadName?: string;
  /** When set, refetch the file on this interval so live Google Docs stay current. */
  liveRefreshMs?: number;
}

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

// ── Single page: lazily renders its canvas only when near the viewport ───────
// Rendering every page of a large PDF at once can freeze the tab, so each page
// waits until it scrolls close (±1500px) before drawing, and shows a
// correctly-sized placeholder until then so scroll position stays stable.
const PdfPageCanvas = ({
  doc, pageNumber, zoom, fitWidth, aspectRatio, scrollRoot,
}: {
  doc: PDFDocumentProxy; pageNumber: number; zoom: number; fitWidth: number;
  aspectRatio: number; scrollRoot: HTMLDivElement | null;
}) => {
  const canvasRef  = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [shouldRender, setShouldRender] = useState(false);
  const [renderFailed, setRenderFailed] = useState(false);

  // Start rendering once the page approaches the viewport (never un-render).
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || shouldRender) return;
    const observer = new IntersectionObserver(
      entries => { if (entries.some(e => e.isIntersecting)) setShouldRender(true); },
      { root: scrollRoot, rootMargin: '1500px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollRoot, shouldRender]);

  useEffect(() => {
    if (!shouldRender) return;
    let cancelled = false;
    let renderTask: ReturnType<import('pdfjs-dist').PDFPageProxy['render']> | null = null;
    (async () => {
      try {
        const pdfPage = await doc.getPage(pageNumber);
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        const baseViewport = pdfPage.getViewport({ scale: 1 });
        const scale = (fitWidth / baseViewport.width) * zoom;
        const dpr = window.devicePixelRatio || 1;
        const viewport = pdfPage.getViewport({ scale });

        canvas.width  = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width  = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        renderTask = pdfPage.render({
          canvas,
          canvasContext: ctx,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        await renderTask.promise;
      } catch (e) {
        // A cancelled render (rapid zoom changes / close) is expected — ignore.
        if (!cancelled && (e as { name?: string })?.name !== 'RenderingCancelledException') {
          setRenderFailed(true);
        }
      }
    })();
    return () => { cancelled = true; renderTask?.cancel(); };
  }, [doc, pageNumber, zoom, fitWidth, shouldRender]);

  const placeholderW = Math.floor(fitWidth * zoom);
  const placeholderH = Math.floor(placeholderW * aspectRatio);

  return (
    <div ref={wrapperRef}>
      {renderFailed ? (
        <div style={{ width: placeholderW, height: placeholderH }}
          className="flex items-center justify-center bg-[#0a101c] text-xs font-bold text-red-400">
          Page {pageNumber} could not be displayed.
        </div>
      ) : shouldRender ? (
        <canvas ref={canvasRef} className="shadow-[0_16px_48px_rgba(0,0,0,0.6)]" />
      ) : (
        <div style={{ width: placeholderW, height: placeholderH }} className="bg-[#0a101c]/60" />
      )}
    </div>
  );
};

const PdfViewer = ({ fileUrl, downloadName = 'document.pdf', liveRefreshMs }: PdfViewerProps) => {
  const [doc, setDoc]           = useState<PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput]     = useState('1');
  const [zoomIdx, setZoomIdx]   = useState(2); // 1x
  const [fitWidth, setFitWidth] = useState(0);
  const [aspectRatio, setAspectRatio] = useState(11 / 8.5); // updated from page 1
  const [scrollRoot, setScrollRoot]   = useState<HTMLDivElement | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs     = useRef<(HTMLDivElement | null)[]>([]);
  const etagRef      = useRef<string | null>(null);

  useEffect(() => {
    if (!liveRefreshMs || liveRefreshMs < 5_000) return;
    const timer = window.setInterval(() => setReloadToken(n => n + 1), liveRefreshMs);
    return () => window.clearInterval(timer);
  }, [liveRefreshMs, fileUrl]);

  // ── Load the document ───────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;
    if (reloadToken === 0) {
      setDoc(null);
      setError(null);
      setCurrentPage(1);
      setPageInput('1');
      etagRef.current = null;
    }

    (async () => {
      try {
        const headers: Record<string, string> = { accept: 'application/pdf, application/json' };
        if (etagRef.current) headers['If-None-Match'] = etagRef.current;
        const res = await fetch(fileUrl, { headers, cache: 'no-store' });
        if (res.status === 304) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? (
            res.status === 401 ? 'Google access expired. Reconnect the Google account.'
              : res.status === 403 ? 'This Google account can no longer open that document.'
                : res.status === 404 ? 'That document was deleted or is no longer available.'
                  : res.status === 429 ? 'Google is rate-limiting requests. Try again shortly.'
                    : 'Could not display this document.'
          ));
        }
        const revision = res.headers.get('etag') || res.headers.get('x-google-revision');
        if (revision) etagRef.current = revision;
        const data = await res.arrayBuffer();
        loadingTask = pdfjsLib.getDocument({ data });
        const d = await loadingTask.promise;
        if (cancelled) return;
        try {
          const first = await d.getPage(1);
          const vp = first.getViewport({ scale: 1 });
          if (!cancelled) setAspectRatio(vp.height / vp.width);
        } catch { /* keep default aspect */ }
        if (!cancelled) {
          setError(null);
          setDoc(d);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not display this PDF.');
      }
    })();

    return () => {
      cancelled = true;
      loadingTask?.destroy();
    };
  }, [fileUrl, reloadToken]);

  // ── Track container width so pages fill the space at 1x zoom ───────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setFitWidth(Math.min(el.clientWidth - 32, 860));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Track which page is currently in view while scrolling ──────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!doc || !container) return;
    const observer = new IntersectionObserver(
      entries => {
        // Pick the visible page closest to the top of the viewport.
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          const idx = pageRefs.current.indexOf(visible[0].target as HTMLDivElement);
          if (idx >= 0) {
            setCurrentPage(idx + 1);
            setPageInput(String(idx + 1));
          }
        }
      },
      { root: container, threshold: 0.25 },
    );
    pageRefs.current.forEach(el => el && observer.observe(el));
    return () => observer.disconnect();
  }, [doc, fitWidth, zoomIdx]);

  const numPages = doc?.numPages ?? 0;
  const zoom = ZOOM_STEPS[zoomIdx];

  const scrollToPage = (n: number) => {
    const target = Math.min(Math.max(n, 1), numPages);
    pageRefs.current[target - 1]?.scrollIntoView({ block: 'start' });
    setCurrentPage(target);
    setPageInput(String(target));
  };

  const commitPageInput = () => {
    const n = parseInt(pageInput, 10);
    if (Number.isFinite(n)) scrollToPage(n);
    else setPageInput(String(currentPage));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 border-b border-[#1e2d42] bg-[#0a101c] px-4 py-2">
        {/* Page nav */}
        <div className="flex items-center gap-1.5">
          <button type="button" disabled={currentPage <= 1} onClick={() => scrollToPage(currentPage - 1)}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#1e2d42] text-[#a8b7cd] hover:bg-white/5 disabled:opacity-30" aria-label="Previous page">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-1 text-[11px] font-black text-[#a8b7cd]">
            <input
              type="text"
              inputMode="numeric"
              value={pageInput}
              onChange={e => setPageInput(e.target.value.replace(/[^0-9]/g, ''))}
              onBlur={commitPageInput}
              onKeyDown={e => { if (e.key === 'Enter') commitPageInput(); }}
              className="h-7 w-10 rounded-lg border border-[#1e2d42] bg-transparent text-center text-[11px] font-black text-[#e6ecf5] focus:border-[#2f66ee] focus:outline-none"
              aria-label="Go to page"
            />
            <span>/ {numPages || '—'}</span>
          </div>
          <button type="button" disabled={currentPage >= numPages} onClick={() => scrollToPage(currentPage + 1)}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#1e2d42] text-[#a8b7cd] hover:bg-white/5 disabled:opacity-30" aria-label="Next page">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Zoom + download */}
        <div className="flex items-center gap-1.5">
          <button type="button" disabled={zoomIdx <= 0} onClick={() => setZoomIdx(i => i - 1)}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#1e2d42] text-[#a8b7cd] hover:bg-white/5 disabled:opacity-30" aria-label="Zoom out">
            <Minus className="h-4 w-4" />
          </button>
          <span className="min-w-[44px] text-center text-[11px] font-black text-[#a8b7cd]">{Math.round(zoom * 100)}%</span>
          <button type="button" disabled={zoomIdx >= ZOOM_STEPS.length - 1} onClick={() => setZoomIdx(i => i + 1)}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#1e2d42] text-[#a8b7cd] hover:bg-white/5 disabled:opacity-30" aria-label="Zoom in">
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Continuous page column */}
      <div ref={el => { containerRef.current = el; setScrollRoot(el); }} className="min-h-0 flex-1 overflow-auto bg-[#060a12] p-4">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm font-black text-red-400">{error}</p>
            <a href={fileUrl} download={downloadName} className="text-xs font-bold text-[#4384ff] underline">Download it instead</a>
          </div>
        ) : !doc || !fitWidth ? (
          <p className="mt-16 text-center text-sm font-bold text-[#526179]">Loading document…</p>
        ) : (
          <div className="flex flex-col items-center gap-4">
            {Array.from({ length: numPages }, (_, i) => (
              <div key={i} ref={el => { pageRefs.current[i] = el; }} className="scroll-mt-4">
                <PdfPageCanvas doc={doc} pageNumber={i + 1} zoom={zoom} fitWidth={fitWidth}
                  aspectRatio={aspectRatio} scrollRoot={scrollRoot} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default PdfViewer;
