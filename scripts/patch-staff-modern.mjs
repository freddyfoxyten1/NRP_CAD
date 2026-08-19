import fs from 'fs';
import path from 'path';

const filePath = path.join('artifacts', 'dojrp', 'src', 'pages', 'StaffPortal.classic.tsx');
let s = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');

const importBlock = `import { StaffModernShell } from '@/pages/staff/StaffModernShell';

type StaffTab = 'roster' | 'resources' | 'events';

function getStaffTabSubtitle(tab: StaffTab): string {
  switch (tab) {
    case 'roster': return 'Active staff roster for Northpoint Roleplay.';
    case 'resources': return 'Guides and reference materials for staff. Managed from the Admin Portal.';
    case 'events': return 'Host server events as Northpoint Staff. Public events appear on the website index.';
    default: return 'Staff roster portal.';
  }
}

const STAFF_NAV_TABS = [
  { id: 'roster' as const, label: 'Staff Roster', icon: Users },
  { id: 'resources' as const, label: 'Resources', icon: BookOpen },
  { id: 'events' as const, label: 'Events', icon: CalendarDays },
];

`;

if (!s.includes('StaffModernShell')) {
  s = s.replace(
    "import { sortByRankThenUsername } from '@/lib/roster-sort';",
    "import { sortByRankThenUsername } from '@/lib/roster-sort';\n" + importBlock
  );
}

if (!s.includes('StaffShellTheme')) {
  s = s.replace(
    'const StaffPortalIndex = () => {',
    "type StaffShellTheme = 'classic' | 'modern';\n\nconst StaffPortal = ({ shellTheme = 'classic' }: { shellTheme?: StaffShellTheme } = {}) => {"
  );
  s = s.replace('export default StaffPortalIndex;', 'export default StaffPortal;');
}

if (s.includes('const staffTabPanels')) {
  console.log('Already patched');
  process.exit(0);
}

// Strip per-tab pageLoading wrappers and duplicate headers for panel reuse
function cleanTabBlock(block) {
  return block
    .replace(/\{pageLoading \? \([\s\S]*?\) : \(\s*/g, '')
    .replace(/\s*<>\s*\n\s*<div className="mb-8">[\s\S]*?<\/div>\s*\n/g, '\n')
    .replace(/\s*<\/>\s*\n\s*\)\}\s*\n\s*<\/div>\s*\n\s*\)\}/g, '\n')
    .replace(/className="flex-1 px-8 py-9"\s*\n\s*/g, '');
}

const tabBlockStart = s.indexOf('{/* ─── ROSTER TAB');
const tabBlockEnd = s.indexOf('\n      </section>\n\n      {openDocId', tabBlockStart);
if (tabBlockStart === -1 || tabBlockEnd === -1) throw new Error('staff tab block not found');

const rawTabBlock = s.slice(tabBlockStart, tabBlockEnd);
const cleanedTabs = cleanTabBlock(rawTabBlock);

s = s.slice(0, tabBlockStart) + '{staffTabPanels}' + s.slice(tabBlockEnd);

// Fix pageLoading
s = s.replace(
  `  const pageLoading = authLoading
    || (activeTab === 'roster' && dataLoading)
    || (showResourcesTab && resourcesLoading)
    || (activeTab === 'events' && eventsLoading);`,
  `  const pageLoading = authLoading
    || (activeTab === 'roster' && dataLoading && members.length === 0)
    || (showResourcesTab && resourcesLoading && resources.length === 0)
    || (activeTab === 'events' && eventsLoading && events.length === 0);`
);

const preReturn = `
  const tabTitle = STAFF_NAV_TABS.find(t => t.id === activeTab)?.label ?? 'Staff Roster';
  const tabSubtitle = getStaffTabSubtitle(activeTab);
  const useModernShell = shellTheme === 'modern';
  const canSeeAdminPortal = isSuperAdminSession(session) || (groups.find(g => g.name.toLowerCase() === ((session?.staff_role ?? session?.role) ?? '').toLowerCase().trim())?.admin_access ?? false);
  const username = session?.username ?? '';
  const rankLabel = getStaffSidebarTitle(session);

  const staffTabPanels = (
    <>
${cleanedTabs}
    </>
  );

`;

const returnAnchor = '  const inputCls =';
const returnIdx = s.indexOf(returnAnchor);
if (returnIdx === -1) throw new Error('return anchor not found');
s = s.slice(0, returnIdx) + preReturn + s.slice(returnIdx);

const oldReturn = `  return (
    <main className="min-h-screen bg-[#02060b] text-white">

      {/* ── Sidebar ───────────────────────────────────────────────────────── */}`;

const newReturn = `  return (
    <>
      {useModernShell ? (
        <StaffModernShell
          tabs={STAFF_NAV_TABS}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          tabTitle={tabTitle}
          tabSubtitle={tabSubtitle}
          username={username}
          rankLabel={rankLabel}
          isLoading={authLoading}
          pageLoading={pageLoading}
          session={session}
          profileOpen={profileOpen}
          setProfileOpen={setProfileOpen}
          profileRef={profileRef}
          handleSignOut={() => { clearCadSession(); navigate('/', { replace: true }); }}
          canSeeAdminPortal={canSeeAdminPortal}
          onAdminPortal={() => navigate('/admin_members')}
          navigate={navigate}
        >
          {staffTabPanels}
        </StaffModernShell>
      ) : (
        <main className="min-h-screen bg-[#02060b] text-white">

      {/* ── Sidebar ───────────────────────────────────────────────────────── */}`;

if (!s.includes(oldReturn)) throw new Error('return header not found');
s = s.replace(oldReturn, newReturn);

const closeMain = s.indexOf('\n      {openDocId');
if (closeMain === -1) throw new Error('overlay start not found');
s = s.slice(0, closeMain) + '\n    </main>\n      )}\n' + s.slice(closeMain);

s = s.replace('\n    </main>\n\n      {openDocId', '\n      {openDocId');
s = s.replace('    </main>\n  );', '    </>\n  );');

// Fix classic section to use staffTabPanels inside section after header
const classicHeaderEnd = s.indexOf('        </header>\n\n        {/* ─── ROSTER TAB');
if (classicHeaderEnd !== -1) {
  const insertAt = s.indexOf('\n', classicHeaderEnd + '        </header>'.length) + 1;
  // already replaced roster tab with {staffTabPanels} globally - classic needs header + staffTabPanels
}

// Classic path: replace {staffTabPanels} placeholder under section - the single {staffTabPanels} is inside section already from first replace

// Close fragment at end
if (!s.includes('    </>\n  );\n};')) {
  s = s.replace(/\n    <\/main>\n  \);\n};/, '\n    </>\n  );\n};');
}

fs.writeFileSync(filePath, s);
console.log('Staff patched OK');
