import AdminPortalClassic from './AdminPortal.classic';

const ADMIN_UI_THEME: 'classic' | 'modern' = 'modern';

const AdminPortal = () => (
  <AdminPortalClassic shellTheme={ADMIN_UI_THEME} />
);

export default AdminPortal;
