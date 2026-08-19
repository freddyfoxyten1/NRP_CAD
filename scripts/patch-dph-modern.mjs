import fs from 'fs';
import path from 'path';

const filePath = path.join('artifacts', 'dojrp', 'src', 'pages', 'DepartmentOfPublicHealth.classic.tsx');
let s = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');

const importBlock = `import { DphModernShell } from '@/pages/dph/DphModernShell';

function getDphTabSubtitle(activeTab: Tab): string {
  switch (activeTab) {
    case 'personnel-roster': return 'Active personnel roster for the Department of Public Health.';
    case 'division-roster': return 'Select a division to view its roster, ranks, and Discord-linked assignments.';
    case 'divisions-information': return 'Select a division to view its information section.';
    case 'vehicle-roster': return 'Vehicle inventory and assignments for the Department of Public Health.';
    case 'equipment-roster': return 'Equipment inventory and assignments for the Department of Public Health.';
    case 'event-calendar': return 'Upcoming department events, training sessions, and operations.';
    case 'information': return 'Department information, announcements, and updates.';
    case 'resources': return 'Department resources, guides, and reference materials.';
    case 'supervisory-panel': return 'Supervisory tools for department administration and oversight.';
    default: return 'Manage members, ranks, callsigns, unit assignments and certifications.';
  }
}

`;

if (!s.includes('DphModernShell')) {
  s = s.replace(
    "import { PermissionAccessOverview, type PermissionAccessOverviewRow } from '@/components/shared/PermissionAccessOverview';",
    "import { PermissionAccessOverview, type PermissionAccessOverviewRow } from '@/components/shared/PermissionAccessOverview';\n" + importBlock
  );
}

if (!s.includes('DphShellTheme')) {
  s = s.replace(
    'const DepartmentOfPublicHealth = () => {',
    "type DphShellTheme = 'classic' | 'modern';\n\nconst DepartmentOfPublicHealth = ({ shellTheme = 'classic' }: { shellTheme?: DphShellTheme } = {}) => {"
  );
}

function applyFeatureParity(source) {
  let t = source;

  t = t.replace(
    "type Tab = 'personnel-roster' | 'division-roster' | 'divisions-information' | 'vehicle-roster' | 'equipment-roster' | 'event-calendar' | 'information' | 'resources' | 'department-panel';",
    "type Tab = 'personnel-roster' | 'division-roster' | 'divisions-information' | 'vehicle-roster' | 'equipment-roster' | 'event-calendar' | 'information' | 'resources' | 'supervisory-panel' | 'department-panel';"
  );

  t = t.replace(
    `  'resources',
  'department-panel',`,
    `  'resources',
  'supervisory-panel',
  'department-panel',`
  );

  t = t.replace(
    `    resolveParent: (raw) => {
      if (raw === 'department-panel' || raw.startsWith('department-panel-')) return 'department-panel';
      if (raw.startsWith('resources-') || raw.startsWith('edit_resource_') || raw.startsWith('public_resource_')) return 'resources';
      return null;
    },`,
    `    resolveParent: (raw) => {
      if (raw === "supervisory-panel" || raw.startsWith("supervisory-panel-")) return "supervisory-panel";
      if (raw === 'department-panel' || raw.startsWith('department-panel-')) return 'department-panel';
      if (raw.startsWith('resources-') || raw.startsWith('edit_resource_') || raw.startsWith('public_resource_')) return 'resources';
      return null;
    },`
  );

  t = t.replace(
    `  const panelSection = useMemo((): PanelSection | null => {
    const parsed = parseNestedPortalSection(rawSection, 'department-panel');
    if (!parsed.isParent || !parsed.nested || !PANEL_SECTIONS.has(parsed.nested)) return null;
    return parsed.nested as PanelSection;
  }, [rawSection]);
  const setPanelSection = useCallback((next: PanelSection | null) => {
    navigate(nestedPortalSectionPath('dph', 'department-panel', next));
  }, [navigate]);`,
    `  const panelSection = useMemo((): PanelSection | null => {
    for (const parent of ['supervisory-panel', 'department-panel'] as const) {
      const parsed = parseNestedPortalSection(rawSection, parent);
      if (!parsed.isParent) continue;
      if (!parsed.nested) return null;
      if (PANEL_SECTIONS.has(parsed.nested)) return parsed.nested as PanelSection;
    }
    return null;
  }, [rawSection]);
  const setPanelSection = useCallback((next: PanelSection | null) => {
    const parent = activeTab === 'supervisory-panel' ? 'supervisory-panel' : 'department-panel';
    navigate(nestedPortalSectionPath('dph', parent, next));
  }, [navigate, activeTab]);`
  );

  t = t.replace(
    "if (activeTab === 'event-calendar' || activeTab === 'department-panel') fetchEvents();",
    "if (activeTab === 'event-calendar' || activeTab === 'department-panel' || activeTab === 'supervisory-panel') fetchEvents();"
  );

  t = t.replace(
    "if (activeTab !== 'department-panel') return;",
    "if (activeTab !== 'department-panel' && activeTab !== 'supervisory-panel') return;"
  );

  t = t.replace(
    `  const username = session?.username ?? '';
  const rank     = session?.dph_rank || session?.rank || '';

  // Staff Executive Team members (and hardcoded superadmins) get full DPS access
  const isStaffExecutive =
    isSuperAdminSession(session) ||
    session?.staff_role?.toLowerCase() === 'executive team';`,
    `  const username = session?.username ?? '';

  const isSuperAdmin = isSuperAdminSession(session);

  // Staff Executive Team members (and hardcoded superadmins) get full DPH access
  const isStaffExecutive =
    isSuperAdmin ||
    session?.staff_role?.toLowerCase() === 'executive team';`
  );

  t = t.replace(
    `  const canSeeDepartmentPanel = hasFullPanelAccess || myDivisionAccess.length > 0;
  const isDivisionOnlyPanelEditor = !hasFullPanelAccess && myDivisionAccess.length > 0;

  // Division Access / Info editors may only use the Divisions section of the panel.`,
    `  const canSeeDepartmentPanel = hasFullPanelAccess || myDivisionAccess.length > 0;
  const isDivisionOnlyPanelEditor = !hasFullPanelAccess && myDivisionAccess.length > 0;

  const rank = (() => {
    if (isLoading) return '';
    if (myRosterMember) {
      return (myRosterMember.dph_rank || myRosterMember.rank || '').trim() || 'Unranked';
    }
    return 'Unranked';
  })();

  const showPanelContent =
    (activeTab === 'department-panel' && Boolean(session && canSeeDepartmentPanel))
    || (activeTab === 'supervisory-panel' && isSuperAdmin);

  useEffect(() => {
    if (activeTab === 'supervisory-panel' && !isSuperAdminSession(session)) {
      setActiveTab('personnel-roster');
    }
  }, [activeTab, session, setActiveTab]);

  // Division Access / Info editors may only use the Divisions section of the panel.`
  );

  t = t.replace(
    `    : activeTab === 'department-panel' ? (
      panelSection === 'personnel' ? panelLoading`,
    `    : activeTab === 'department-panel' || activeTab === 'supervisory-panel' ? (
      panelSection === 'personnel' ? panelLoading`
  );

  t = t.replace(
    `{activeTab === 'department-panel' && (`,
    `{showPanelContent && (`
  );

  t = t.replace(
    `            <div className="mt-6 flex flex-col gap-2 border-t border-[#131f30] pt-6 lg:mt-5">

              {/* Department Panel link — Executive Team / panel_access ranks / granted division editors */}
              {session && canSeeDepartmentPanel && (
                <button type="button" onClick={() => {
                  if (isDivisionOnlyPanelEditor) setPanelSection('division');
                  else setActiveTab('department-panel');
                }}`,
    `            <div className="mt-6 flex flex-col gap-2 border-t border-[#131f30] pt-6 lg:mt-5">

              {session && isSuperAdmin && (
                <button type="button" onClick={openSupervisoryPanel}
                  className={\`flex w-full items-center gap-3 rounded-md px-4 py-3 text-left text-sm font-black uppercase transition-colors \${
                    activeTab === 'supervisory-panel'
                      ? 'border-l-2 border-[#6ee7b7] bg-[#071120] text-[#6ee7b7]'
                      : 'text-[#8392aa] hover:bg-[#070d16] hover:text-white'
                  }\`}>
                  <Shield className="h-4 w-4" />
                  Supervisory Panel
                </button>
              )}

              {/* Department Panel link — Executive Team / panel_access ranks / granted division editors */}
              {session && canSeeDepartmentPanel && (
                <button type="button" onClick={openDepartmentPanel}`
  );

  return t;
}

if (s.includes('const dphTabPanels')) {
  console.log('Already patched — applying feature parity only');
  s = applyFeatureParity(s);
  fs.writeFileSync(filePath, s);
  console.log('Feature parity OK');
  process.exit(0);
}

const contentIdx = s.indexOf('          <div className="flex-1 px-5 py-7 sm:px-8 sm:py-9">');
const tabStartIdx = s.indexOf("            {activeTab === 'personnel-roster' && (", contentIdx);
if (tabStartIdx === -1) throw new Error('tab start not found');

const tabEndMarker = '\n\n              </>\n            )}\n\n            </>\n            )}\n\n          </div>\n        </section>';
const tabEndIdx = s.indexOf(tabEndMarker, tabStartIdx);
if (tabEndIdx === -1) throw new Error('tab end not found');

const tabPanels = s.slice(tabStartIdx, tabEndIdx);
const tabPanelsWithClose = tabPanels + '\n\n              </>\n            )}';
s = s.slice(0, tabStartIdx) + '            {dphTabPanels}' + s.slice(tabEndIdx);

s = s.replace(
  /              <p className="mt-2 text-sm text-\[#8392aa\]">\s*\{activeTab === 'personnel-roster'[\s\S]*?: 'Manage members, ranks, callsigns, unit assignments and certifications\.'\}\s*\n              <\/p>/,
  '              <p className="mt-2 text-sm text-[#8392aa]">{tabSubtitle}</p>'
);

s = s.replace(
  '            {dphTabPanels}\n\n              </>\n            )}\n\n            </>\n            )}',
  '            {dphTabPanels}\n            </>\n            )}'
);

const preReturn = `
  const tabTitle = activeTab === 'supervisory-panel'
    ? 'Supervisory Panel'
    : tabs.find(t => t.id === activeTab)?.label ?? 'Department of Public Health';
  const tabSubtitle = getDphTabSubtitle(activeTab);
  const openDepartmentPanel = () => {
    if (isDivisionOnlyPanelEditor) setPanelSection('division');
    else setActiveTab('department-panel');
  };
  const openSupervisoryPanel = () => setActiveTab('supervisory-panel');
  const useModernShell = shellTheme === 'modern';

  const dphTabPanels = (
    <>
${tabPanelsWithClose}
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
const afterMain = s.slice(mainCloseIdx).replace(/^\s*<\/main>\s*\n/, '');

const modernBranch = `      {useModernShell ? (
        <DphModernShell
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
          canSeeSupervisoryPanel={isSuperAdmin}
          onSupervisoryPanel={openSupervisoryPanel}
          canSeeDepartmentPanel={canSeeDepartmentPanel}
          onDepartmentPanel={openDepartmentPanel}
          navigate={navigate}
        >
          {dphTabPanels}
        </DphModernShell>
      ) : (
        <main className="min-h-screen bg-[#02060b] text-white">
${classicShell}    </main>
      )}

`;

s = s.slice(0, s.indexOf('  return (\n    <>\n')) + '  return (\n    <>\n' + modalsBlock + modernBranch + afterMain;

s = applyFeatureParity(s);

fs.writeFileSync(filePath, s);
console.log('Patched DPH OK');
