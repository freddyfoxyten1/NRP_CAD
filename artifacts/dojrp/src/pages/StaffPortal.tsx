// ─────────────────────────────────────────────────────────────────────────────
// Staff Portal theme switch
//
// Flip STAFF_PORTAL_THEME to 'classic' to restore the previous look.
// ─────────────────────────────────────────────────────────────────────────────
import StaffPortalClassic from './StaffPortal.classic';
import StaffPortalIndex from './StaffPortal.index';

/** 'index' = PublicView-matched styling · 'classic' = previous Staff Portal look */
const STAFF_PORTAL_THEME: 'index' | 'classic' = 'index';

const StaffPortal = () =>
  STAFF_PORTAL_THEME === 'classic'
    ? <StaffPortalClassic />
    : <StaffPortalIndex />;

export default StaffPortal;