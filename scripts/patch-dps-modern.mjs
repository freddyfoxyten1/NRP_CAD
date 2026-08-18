import fs from 'fs';
import path from 'path';

const filePath = path.join('artifacts', 'dojrp', 'src', 'pages', 'DepartmentOfPublicSafety.classic.tsx');
let s = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');

const importBlock = `import { DpsModernShell } from '@/pages/dps/DpsModernShell';

function getDpsTabSubtitle(activeTab: Tab): string {
  switch (activeTab) {
    case 'personnel-roster': return 'Active personnel roster for the Department of Public Safety.';
    case 'division-roster': return 'Select a division to view its roster, ranks, and Discord-linked assignments.';
    case 'divisions-information': return 'Select a division to view its information section.';
    case 'vehicle-roster': return 'Vehicle inventory and assignments for the Department of Public Safety.';
    case 'equipment-roster': return 'Equipment inventory and assignments for the Department of Public Safety.';
    case 'event-calendar': return 'Upcoming department events, training sessions, and operations.';
    case 'information': return 'Department information, announcements, and updates.';
    case 'resources': return 'Department resources, guides, and reference materials.';
    default: return 'Manage officers, ranks, callsigns, unit assignments and certifications.';
  }
}

`;

if (!s.includes('DpsModernShell')) {
  s = s.replace(
    "import { PermissionAccessOverview, type PermissionAccessOverviewRow } from '@/components/shared/PermissionAccessOverview';",
    "import { PermissionAccessOverview, type PermissionAccessOverviewRow } from '@/components/shared/PermissionAccessOverview';\n" + importBlock
  );
}

if (!s.includes('DpsShellTheme')) {
  s = s.replace(
    'const DepartmentOfPublicSafety = () => {',
    "type DpsShellTheme = 'classic' | 'modern';\n\nconst DepartmentOfPublicSafety = ({ shellTheme = 'classic' }: { shellTheme?: DpsShellTheme } = {}) => {"
  );
}

if (s.includes('const dpsTabPanels')) {
  console.log('Already patched');
  process.exit(0);
}

const contentIdx = s.indexOf('          <div className="flex-1 px-5 py-7 sm:px-8 sm:py-9">');
const tabStartIdx = s.indexOf("            {activeTab === 'personnel-roster' && (", contentIdx);
if (tabStartIdx === -1) throw new Error('tab start not found');

const tabEndMarker = '\n\n              </>\n            )}\n\n            </>\n            )}\n\n          </div>\n        </section>';
const tabEndIdx = s.indexOf(tabEndMarker, tabStartIdx);
if (tabEndIdx === -1) throw new Error('tab end not found');

const tabPanels = s.slice(tabStartIdx, tabEndIdx);
s = s.slice(0, tabStartIdx) + '            {dpsTabPanels}' + s.slice(tabEndIdx);

s = s.replace(
  /              <p className="mt-2 text-sm text-\[#8392aa\]">\s*\{activeTab === 'personnel-roster'[\s\S]*?: 'Manage officers, ranks, callsigns, unit assignments and certifications\.'\}\s*\n              <\/p>/,
  '              <p className="mt-2 text-sm text-[#8392aa]">{tabSubtitle}</p>'
);

s = s.replace(
  '            {dpsTabPanels}\n\n              </>\n            )}\n\n            </>\n            )}',
  '            {dpsTabPanels}\n            </>\n            )}'
);

const preReturn = `
  const tabTitle = tabs.find(t => t.id === activeTab)?.label ?? 'Department of Public Safety';
  const tabSubtitle = getDpsTabSubtitle(activeTab);
  const openDepartmentPanel = () => {
    if (isDivisionOnlyPanelEditor) setPanelSection('division');
    else setActiveTab('department-panel');
  };
  const useModernShell = shellTheme === 'modern';

  const dpsTabPanels = (
    <>
${tabPanels}
    </>
  );

`;

const returnAnchor = '    : false\n  );\n\n  return (';
const returnIdx = s.lastIndexOf(returnAnchor);
if (returnIdx === -1) throw new Error('return anchor not found');
const insertAt = returnIdx + '    : false\n  );\n\n'.length;
s = s.slice(0, insertAt) + preReturn + s.slice(insertAt);

const oldReturn = `  return (
    <>
    <main className="min-h-screen bg-[#02060b] text-white">

      {/* Modals */}`;

const newReturn = `  return (
    <>
      {/* Modals */}`;

if (!s.includes(oldReturn)) throw new Error('return header not found');
s = s.replace(oldReturn, newReturn);

const shellStart = '      {/* Mobile top bar */}';
const mainClose = `    </main>

      {/*`;

const shellStartIdx = s.indexOf(shellStart);
const mainCloseIdx = s.indexOf(mainClose);
if (shellStartIdx === -1 || mainCloseIdx === -1) throw new Error('shell bounds not found');

const modalsStart = s.indexOf('      {/* Modals */}');
const modalsBlock = s.slice(modalsStart, shellStartIdx);
const classicShell = s.slice(shellStartIdx, mainCloseIdx);
const afterMain = s.slice(mainCloseIdx);

const modernBranch = `      {useModernShell ? (
        <DpsModernShell
          tabs={tabs}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          tabTitle={tabTitle}
          tabSubtitle={tabSubtitle}
          username={username}
          rank={rank}
          isLoading={isLoading}
          pageLoading={pageLoading}
          cadOnline={cadOnline}
          cadMode={cadMode}
          session={session}
          profileOpen={profileOpen}
          setProfileOpen={setProfileOpen}
          profileRef={profileRef}
          handleSignOut={handleSignOut}
          isSigningOut={isSigningOut}
          canSeeDepartmentPanel={canSeeDepartmentPanel}
          onDepartmentPanel={openDepartmentPanel}
          navigate={navigate}
        >
          {dpsTabPanels}
        </DpsModernShell>
      ) : (
        <main className="min-h-screen bg-[#02060b] text-white">
${classicShell}    </main>
      )}

`;

s = s.slice(0, s.indexOf('  return (\n    <>\n')) + '  return (\n    <>\n' + modalsBlock + modernBranch + afterMain;

fs.writeFileSync(filePath, s);
console.log('Patched OK');
