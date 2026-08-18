// ─────────────────────────────────────────────────────────────────────────────
// DPH page theme switch
//
// Flip DPH_UI_THEME to 'classic' to restore the previous look.
// ─────────────────────────────────────────────────────────────────────────────
import DepartmentOfPublicHealthClassic from './DepartmentOfPublicHealth.classic';

/** 'modern' = preview redesign · 'classic' = current DPH layout */
const DPH_UI_THEME: 'classic' | 'modern' = 'modern';

const DepartmentOfPublicHealth = () => (
  <DepartmentOfPublicHealthClassic shellTheme={DPH_UI_THEME} />
);

export default DepartmentOfPublicHealth;
