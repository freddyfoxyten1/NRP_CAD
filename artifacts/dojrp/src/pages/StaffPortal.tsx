import StaffPortalClassic from './StaffPortal.classic';

const STAFF_UI_THEME: 'classic' | 'modern' = 'modern';

const StaffPortal = () => (
  <StaffPortalClassic shellTheme={STAFF_UI_THEME} />
);

export default StaffPortal;
