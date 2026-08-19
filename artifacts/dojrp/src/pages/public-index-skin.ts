const BASE = (import.meta.env.BASE_URL as string) ?? '/';

export const DPS_SEAL_URL = `${BASE}dps-seal.png`;
export const DPH_SEAL_URL = `${BASE}dph-seal.png`;
export const IAB_SEAL_URL = `${BASE}iab-seal.png?v=4`;
export const DPS_INDEX_BANNER_URL = `${BASE}dps-index-banner.png`;
export const DPH_INDEX_BANNER_URL = `${BASE}dph-index-banner.png`;

export const skin = {
  page: 'relative min-h-screen bg-[#030810] text-white',
  card: 'rounded-xl border border-[#1a2d45] bg-[#070d16]/90 backdrop-blur-sm',
  panel: 'rounded-2xl border border-[#1a2d45] bg-[#070d16]/90 backdrop-blur-sm overflow-hidden',
  panelHead:
    'flex items-center gap-3 border-b border-[#132033] bg-gradient-to-r from-[#0c1628] to-[#070d16] px-4 py-4 sm:px-7 sm:py-5',
  header: 'sticky top-0 z-30 h-14 border-b border-[#132033]/80 bg-[#030810]/90 backdrop-blur-xl',
  tabBar: 'sticky top-14 z-20 border-b border-[#132033] bg-[#050b14]/95 backdrop-blur-xl',
  footer: 'border-t border-[#132033]/80 px-4 py-8 text-center',
  heroBorder: 'border-b border-[#132033]/80',
  bodyText: 'text-[#8fa3bc]',
  mutedText: 'text-[#5a7090]',
  accent: '#4384ff',
  divider: 'bg-[#132033]',
  signInBtn:
    'inline-flex h-9 items-center rounded-full border border-[#1a2d45] px-3.5 text-xs font-bold text-[#8392aa] transition-colors hover:bg-white/5 hover:text-white',
  countBadge:
    'rounded-full border border-[#1a2d45] bg-[#0a1525] px-2 py-0.5 text-[9px] font-black text-[#5a7090]',
  emptyState:
    'flex flex-col items-center gap-2 rounded-xl border border-[#132033]/60 bg-[#070d16]/50 py-12 text-center backdrop-blur-sm',
  tabInactive: 'text-[#5a7090] hover:text-[#9eb4cc]',
  heroGradient:
    'pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(67,132,255,0.14)_0,rgba(3,8,16,0)_60%)]',
  liveBadge: 'border-[#4384ff]/30 bg-[#4384ff]/10',
  dphAccent: '#34d399',
  dphBtn: 'bg-[#059669] shadow-[0_6px_20px_rgba(5,150,105,0.28)] hover:bg-[#34d399]',
  dphBtnOutline: 'border-[#34d399]/40 bg-[#34d399]/10 text-[#34d399] hover:bg-[#34d399]/20',
};
