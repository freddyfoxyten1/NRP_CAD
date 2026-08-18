/** Test preview — member portal colours & assets. Set false to restore classic index skin. */
export const INDEX_PREVIEW_SKIN = true;

const BASE = (import.meta.env.BASE_URL as string) ?? '/';

export const DPS_SEAL_URL = `${BASE}dps-seal.png`;
export const DPH_SEAL_URL = `${BASE}dph-seal.png`;
export const DPS_INDEX_BANNER_URL = `${BASE}dps-index-banner.png`;
export const DPH_INDEX_BANNER_URL = `${BASE}dph-index-banner.png`;

/** Pick classic vs preview Tailwind classes. */
export function ix(classic: string, preview: string): string {
  return INDEX_PREVIEW_SKIN ? preview : classic;
}

export const skin = {
  page: ix('min-h-screen bg-[#02060b] text-white', 'relative min-h-screen bg-[#030810] text-white'),
  card: ix(
    'rounded-xl border border-[#131f30] bg-[#070d16]',
    'rounded-xl border border-[#1a2d45] bg-[#070d16]/90 backdrop-blur-sm',
  ),
  panel: ix(
    'rounded-2xl border border-[#1b2738] bg-[#070d16] overflow-hidden',
    'rounded-2xl border border-[#1a2d45] bg-[#070d16]/90 backdrop-blur-sm overflow-hidden',
  ),
  panelHead: ix(
    'flex items-center gap-3 border-b border-[#131f30] bg-[#0b1422] px-4 py-4 sm:px-7 sm:py-5',
    'flex items-center gap-3 border-b border-[#132033] bg-gradient-to-r from-[#0c1628] to-[#070d16] px-4 py-4 sm:px-7 sm:py-5',
  ),
  header: ix(
    'sticky top-0 z-30 h-14 border-b border-[#131f30] bg-[#02060b]',
    'sticky top-[36px] z-30 h-14 border-b border-[#132033]/80 bg-[#030810]/90 backdrop-blur-xl',
  ),
  tabBar: ix(
    'sticky top-14 z-20 border-b border-[#0f1b28] bg-[#02060b]',
    'sticky top-[92px] z-20 border-b border-[#132033] bg-[#050b14]/95 backdrop-blur-xl',
  ),
  footer: ix(
    'border-t border-[#0f1b28] px-4 py-8 text-center',
    'border-t border-[#132033]/80 px-4 py-8 text-center',
  ),
  heroBorder: ix('border-b border-[#0f1b28]', 'border-b border-[#132033]/80'),
  bodyText: ix('text-[#a8b7cd]', 'text-[#8fa3bc]'),
  mutedText: ix('text-[#526179]', 'text-[#5a7090]'),
  accent: '#4384ff',
  divider: ix('bg-[#131f30]', 'bg-[#132033]'),
  signInBtn: ix(
    'inline-flex h-9 items-center rounded-full px-3.5 text-xs font-bold text-[#526179] transition-colors hover:bg-white/5 hover:text-white',
    'inline-flex h-9 items-center rounded-full border border-[#1a2d45] px-3.5 text-xs font-bold text-[#8392aa] transition-colors hover:bg-white/5 hover:text-white',
  ),
  countBadge: ix(
    'rounded-full bg-[#0f1b28] px-2 py-0.5 text-[9px] font-black text-[#526179]',
    'rounded-full border border-[#1a2d45] bg-[#0a1525] px-2 py-0.5 text-[9px] font-black text-[#5a7090]',
  ),
  emptyState: ix(
    'flex flex-col items-center gap-2 rounded-xl border border-[#0f1b28] py-12 text-center',
    'flex flex-col items-center gap-2 rounded-xl border border-[#132033]/60 bg-[#070d16]/50 py-12 text-center backdrop-blur-sm',
  ),
  tabInactive: ix('text-[#526179] hover:text-[#8392aa]', 'text-[#5a7090] hover:text-[#9eb4cc]'),
  heroGradient: ix(
    'pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(20,45,90,0.30)_0,rgba(2,6,11,0)_55%)]',
    'pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(67,132,255,0.14)_0,rgba(3,8,16,0)_60%)]',
  ),
  liveBadge: ix(
    'border-[#173053] bg-[#071120]',
    'border-[#4384ff]/30 bg-[#4384ff]/10',
  ),
  dphAccent: ix('#f87171', '#34d399'),
  dphBtn: ix(
    'bg-[#dc2626] shadow-[0_6px_20px_rgba(220,38,38,0.28)] hover:bg-[#ef4444]',
    'bg-[#059669] shadow-[0_6px_20px_rgba(5,150,105,0.28)] hover:bg-[#34d399]',
  ),
  dphBtnOutline: ix(
    'border-[#dc2626]/40 bg-[#dc2626]/10 text-[#f87171] hover:bg-[#dc2626]/20',
    'border-[#34d399]/40 bg-[#34d399]/10 text-[#34d399] hover:bg-[#34d399]/20',
  ),
};
