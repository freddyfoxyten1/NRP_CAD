// ─────────────────────────────────────────────────────────────────────────────
// Member Portal theme switch
//
// Flip MEMBER_PORTAL_THEME to 'classic' to restore the previous look.
// ─────────────────────────────────────────────────────────────────────────────
import MemberPortalClassic from './MemberPortal.classic';
import MemberPortalIndex from './MemberPortal.index';

/** 'index' = PublicView-matched styling · 'classic' = previous Member Portal look */
const MEMBER_PORTAL_THEME: 'index' | 'classic' = 'index';

const MemberPortal = () =>
  MEMBER_PORTAL_THEME === 'classic'
    ? <MemberPortalClassic />
    : <MemberPortalIndex />;

export default MemberPortal;
