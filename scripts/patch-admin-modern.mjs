import fs from 'fs';
import path from 'path';

const filePath = path.join('artifacts', 'dojrp', 'src', 'pages', 'AdminPortal.classic.tsx');
let s = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');

const importBlock = `import { AdminModernShell, type AdminNavTab } from '@/pages/admin/AdminModernShell';

function getAdminTabSubtitle(tab: AdminTab): string {
  switch (tab) {
    case 'members': return 'View members of the DOJRP Discord server — username, Discord ID, website rank, and server roles.';
    case 'staff-roster': return 'Manage staff rank groups and members. Only superadmins can manage the Executive Team or reorder its ranks.';
    case 'announcement': return 'Compose and publish announcements visible to all DOJRP CAD members.';
    case 'information-support': return 'Edit the Information & Support page shown in the Member Portal.';
    case 'staff-resources': return 'Add, edit, and remove resources shown on the Staff Roster Resources tab.';
    case 'terms-privacy': return 'Edit the Terms of Service and Privacy Policy shown on the sign-in screen.';
    case 'gallery': return 'Manage gallery images shown on the public website.';
    case 'store': return 'Manage server store products shown on the public website.';
    case 'terminal': return 'Control CAD terminal mode and lockdown settings.';
    case 'logs': return 'Review audit logs for admin actions across the system.';
    default: return 'Admin portal.';
  }
}

const ADMIN_TAB_ICONS: Record<AdminTab, React.ElementType> = {
  members: Users,
  'staff-roster': Shield,
  announcement: Megaphone,
  'information-support': Info,
  'staff-resources': BookOpen,
  'terms-privacy': Scale,
  gallery: ImageIcon,
  store: ShoppingBag,
  terminal: Monitor,
  logs: FileText,
};

`;

if (!s.includes('AdminModernShell')) {
  s = s.replace(
    "import { PermissionAccessOverview, type PermissionAccessOverviewRow } from '@/components/shared/PermissionAccessOverview';",
    "import { PermissionAccessOverview, type PermissionAccessOverviewRow } from '@/components/shared/PermissionAccessOverview';\n" + importBlock
  );
}

if (!s.includes('AdminShellTheme')) {
  s = s.replace(
    'const AdminPortal = () => {',
    "type AdminShellTheme = 'classic' | 'modern';\n\nconst AdminPortal = ({ shellTheme = 'classic' }: { shellTheme?: AdminShellTheme } = {}) => {"
  );
}

if (s.includes('const adminTabPanels')) {
  console.log('Already patched');
  process.exit(0);
}

const contentIdx = s.indexOf('          <div className="flex-1 px-5 py-8 sm:px-8 lg:px-9">');
const tabStartIdx = s.indexOf("            {activeTab === 'members' &&", contentIdx);
if (tabStartIdx === -1) throw new Error('tab start not found');

const overlayIdx = s.indexOf('\n\n      {staffOpenDocId !== null && (');
if (overlayIdx === -1) throw new Error('overlay not found');
const tabEndIdx = s.lastIndexOf('\n            </>\n            )}', overlayIdx);
if (tabEndIdx === -1 || tabStartIdx === -1 || tabEndIdx <= tabStartIdx) throw new Error('tab bounds not found');

const tabPanels = s.slice(tabStartIdx, tabEndIdx);
const tabPanelsWithClose = tabPanels;
s = s.slice(0, tabStartIdx) + '            {adminTabPanels}' + s.slice(tabEndIdx);

s = s.replace(
  /              <p className="mt-2 text-sm text-\[#8392aa\] sm:text-base">\s*\{activeTab === 'members'[\s\S]*?: 'Control CAD terminal mode and lockdown settings\.'\}\s*\n              <\/p>/,
  '              <p className="mt-2 text-sm text-[#8392aa] sm:text-base">{tabSubtitle}</p>'
);

s = s.replace(
  /              <h2 className="text-3xl font-black leading-none tracking-\[-0\.05em\] text-white sm:text-4xl">\s*\{activeTab === 'members'[\s\S]*?: 'Terminal'\}\s*\n              <\/h2>/,
  '              <h2 className="text-3xl font-black leading-none tracking-[-0.05em] text-white sm:text-4xl">{tabTitle}</h2>'
);

// Cache-aware pageLoading
s = s.replace(
  `  const pageLoading = isLoading || (
    activeTab === 'members' ? guildMembersLoading
    : activeTab === 'staff-roster' ? staffRosterLoading
    : activeTab === 'information-support' ? infoSupportLoading
    : activeTab === 'terms-privacy' ? legalLoading
    : showStaffResourcesTab ? staffResourcesLoading
    : activeTab === 'gallery' ? galleryLoading
    : activeTab === 'store' ? storeLoading
    : activeTab === 'logs' ? (logsSubTab !== null && auditLogsLoading)
    : false
  );`,
  `  const pageLoading = isLoading || (
    activeTab === 'members' ? (guildMembersLoading && guildMembers.length === 0)
    : activeTab === 'staff-roster' ? (staffRosterLoading && staffRosterMembers.length === 0)
    : activeTab === 'information-support' ? (infoSupportLoading && infoSupportSections.length === 0)
    : activeTab === 'terms-privacy' ? (legalLoading && termsSections.length === 0)
    : showStaffResourcesTab ? (staffResourcesLoading && staffResources.length === 0)
    : activeTab === 'gallery' ? (galleryLoading && galleryImages.length === 0)
    : activeTab === 'store' ? (storeLoading && storeProducts.length === 0)
    : activeTab === 'logs' ? (logsSubTab !== null && auditLogsLoading && auditLogs.length === 0)
    : false
  );`
);

const preReturn = `
  const tabTitle = adminNavTabs.find(t => t.id === activeTab)?.label ?? 'Admin Portal';
  const tabSubtitle = getAdminTabSubtitle(activeTab);
  const useModernShell = shellTheme === 'modern';
  const adminModernTabs: AdminNavTab[] = adminNavTabs.map(t => ({
    id: t.id,
    label: t.label,
    icon: ADMIN_TAB_ICONS[t.id],
  }));

  const adminTabPanels = (
    <>
${tabPanelsWithClose}
    </>
  );

`;

const returnAnchor = '  const guildLoadDetail =';
const returnIdx = s.indexOf(returnAnchor);
if (returnIdx === -1) throw new Error('return anchor not found');
s = s.slice(0, returnIdx) + preReturn + s.slice(returnIdx);

const oldReturn = `  return (
    <main className="min-h-screen bg-[#02060b] text-white">
      {/* Mobile-only fixed top bar */}`;

const newReturn = `  return (
    <>
      {/* Mobile-only fixed top bar */}`;

if (!s.includes(oldReturn)) throw new Error('return header not found');
s = s.replace(oldReturn, newReturn);

const shellStart = '      {/* Mobile-only fixed top bar */}';
const overlayStart = '\n\n      {staffOpenDocId !== null && (';
const shellStartIdx = s.indexOf(shellStart);
const overlayStartIdx = s.indexOf(overlayStart);
if (shellStartIdx === -1 || overlayStartIdx === -1) throw new Error('shell bounds not found');

const classicShell = s.slice(shellStartIdx, overlayStartIdx);
const overlaysBlock = s.slice(overlayStartIdx);

const modernBranch = `      {useModernShell ? (
        <AdminModernShell
          tabs={adminModernTabs}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          tabTitle={tabTitle}
          tabSubtitle={tabSubtitle}
          username={currentAdmin?.username ?? ''}
          rankLabel={getStaffSidebarTitle(currentAdmin)}
          isLoading={isLoading}
          pageLoading={pageLoading}
          loadingLabel={activeTab === 'members' && guildMembersLoading ? guildLoadProgress.label : 'Loading…'}
          cadOnline={cadOnline}
          cadMode={cadMode}
          session={currentAdmin}
          profileOpen={profileOpen}
          setProfileOpen={setProfileOpen}
          profileRef={profileRef}
          handleSignOut={handleSignOut}
          isSigningOut={isSigningOut}
          navigate={navigate}
        >
          {adminTabPanels}
        </AdminModernShell>
      ) : (
        <main className="min-h-screen bg-[#02060b] text-white">
${classicShell}    </main>
      )}

`;

s = s.slice(0, s.indexOf('  return (\n    <>\n')) + '  return (\n    <>\n' + modernBranch + overlaysBlock;

const afterMain = s.indexOf('    </main>\n      )}\n\n\n      {staffOpenDocId');
if (afterMain !== -1) {
  // ok
} else {
  s = s.replace(/\n    <\/main>\n      \)\}\n\n      \{staffOpenDocId/, '\n      {staffOpenDocId');
}

s = s.replace('    </main>\n  );', '    </>\n  );');
if (!s.trimEnd().endsWith('};')) {
  s = s.replace(/\n    <\/main>\n  \);\n};/, '\n    </>\n  );\n};');
}

fs.writeFileSync(filePath, s);
console.log('Admin patched OK');
