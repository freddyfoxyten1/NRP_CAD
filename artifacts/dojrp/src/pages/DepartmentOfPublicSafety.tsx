// ─────────────────────────────────────────────────────────────────────────────
// DPS page theme switch
//
// Flip DPS_UI_THEME to 'classic' to restore the previous look.
// ─────────────────────────────────────────────────────────────────────────────
import DepartmentOfPublicSafetyClassic from './DepartmentOfPublicSafety.classic';

/** 'modern' = redesigned department layout · 'classic' = previous look */
const DPS_UI_THEME: 'classic' | 'modern' = 'modern';

const DepartmentOfPublicSafety = () => (
  <DepartmentOfPublicSafetyClassic shellTheme={DPS_UI_THEME} />
);

export default DepartmentOfPublicSafety;
