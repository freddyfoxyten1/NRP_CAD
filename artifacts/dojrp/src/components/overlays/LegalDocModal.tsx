// ----
// components/overlays/LegalDocModal.tsx
// Terms of Service + Privacy Policy overlay (opened from the sign-in popup).
// View-only — content is edited in Admin Portal.
// ----
import { useEffect, useState } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import DojrpShield from '@/components/shared/DojrpShield';
import { renderContentBlocks, type ContentBlock } from '@/components/shared/ContentBlocks';
import {
  DEFAULT_PRIVACY_SECTIONS,
  DEFAULT_TERMS_SECTIONS,
  resolveLegalSections,
} from '@/lib/legal-defaults';

export type LegalDoc = 'terms' | 'privacy';

interface LegalDocModalProps {
  doc: LegalDoc;
  onClose: () => void;
  onSwitch: (doc: LegalDoc) => void;
}

const CONTENT_KEY: Record<LegalDoc, string> = {
  terms: 'terms_of_service',
  privacy: 'privacy_policy',
};

const LegalDocModal = ({ doc, onClose, onSwitch }: LegalDocModalProps) => {
  const [sections, setSections] = useState<ContentBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const isTerms = doc === 'terms';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const fallback = isTerms ? DEFAULT_TERMS_SECTIONS : DEFAULT_PRIVACY_SECTIONS;
    fetch(`/api/portal/content/${CONTENT_KEY[doc]}`, { headers: { accept: 'application/json' } })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { sections?: ContentBlock[] } | null) => {
        if (cancelled) return;
        setSections(resolveLegalSections(d?.sections, fallback));
      })
      .catch(() => {
        if (!cancelled) setSections(fallback);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [doc, isTerms]);

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-[#03070c]/96 px-4 py-8 text-white sm:py-12">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_center,rgba(21,34,56,0.45)_0,rgba(3,7,12,0)_65%)]" />

      <div className="relative w-full max-w-3xl">
        <button
          type="button"
          onClick={onClose}
          className="mb-6 inline-flex items-center gap-2 text-[13px] font-bold text-[#7b91ad] transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to the portal
        </button>

        <div className="mb-6 text-center">
          <DojrpShield className="mx-auto mb-3 h-14 w-14" />
          <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#5b8fd9]">
            DOJRP Community
          </p>
          <h2 className="mt-3 text-3xl font-black tracking-[-0.04em] text-white sm:text-4xl">
            {isTerms ? 'Terms of Service' : 'Privacy Policy'}
          </h2>
        </div>

        <div className="relative rounded-2xl border border-[#1a3a5c] bg-[#0b121f] p-6 shadow-[0_0_40px_rgba(47,102,238,0.12)] sm:p-8">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 rounded-full p-1.5 text-[#4a5568] transition-colors hover:bg-white/5 hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>

          {loading ? (
            <div className="flex min-h-[200px] items-center justify-center">
              <p className="text-sm font-bold text-[#3f5470]">Loading…</p>
            </div>
          ) : (
            renderContentBlocks(sections, {
              emptyTitle: isTerms ? 'Terms not published' : 'Privacy Policy not published',
              emptyHint: 'Check back soon, or contact leadership in Discord.',
              accent: '#5b8fd9',
            })
          )}

          <div className="mt-8 border-t border-[#162033] pt-5">
            {isTerms ? (
              <button
                type="button"
                onClick={() => onSwitch('privacy')}
                className="text-[13px] font-bold text-[#5b8fd9] transition-colors hover:underline"
              >
                Read our Privacy Policy →
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onSwitch('terms')}
                className="text-[13px] font-bold text-[#5b8fd9] transition-colors hover:underline"
              >
                Read our Terms of Service →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LegalDocModal;
