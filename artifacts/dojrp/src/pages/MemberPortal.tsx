// ─────────────────────────────────────────────────────────────────────────────
// Member Portal theme switch
//
// Flip MEMBER_PORTAL_THEME to 'classic' to restore the previous look.
// ─────────────────────────────────────────────────────────────────────────────
import MemberPortalClassic from './MemberPortal.classic';
import MemberPortalIndex from './MemberPortal.index';
import MemberPortalModern from './MemberPortal.modern';

/** 'modern' = redesigned member portal · 'index' = PublicView-matched · 'classic' = older look */
const MEMBER_PORTAL_THEME: 'index' | 'classic' | 'modern' = 'modern';

const MemberPortal = () => {
  if (MEMBER_PORTAL_THEME === 'classic') return <MemberPortalClassic />;
  if (MEMBER_PORTAL_THEME === 'modern') return <MemberPortalModern />;
  return <MemberPortalIndex />;
};

export default MemberPortal;
