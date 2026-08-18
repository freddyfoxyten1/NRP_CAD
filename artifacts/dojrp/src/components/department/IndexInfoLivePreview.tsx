import { useMemo } from 'react';
import DepartmentIndexPanel from '@/components/public/DepartmentIndexPanel';
import { DPS_INDEX_BANNER_URL, DPS_SEAL_URL } from '@/pages/public-index-skin';
import {
  indexInfoSavePayload,
  normalizeIndexInfo,
  type IndexInfoFormState,
} from '@/lib/index-info-content';

type RosterDivision = {
  id: number;
  name: string;
  sort_order: number;
  unit_key?: string | null;
};

const noop = () => {};

export default function IndexInfoLivePreview({
  form,
  rosterDivisions,
}: {
  form: IndexInfoFormState;
  rosterDivisions: RosterDivision[];
}) {
  const draftInfo = useMemo(() => {
    const divisions = [...rosterDivisions]
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
      .map(d => {
        const key = (d.unit_key ?? '').trim().toUpperCase();
        return key ? `${d.name} (${key})` : d.name;
      });
    return normalizeIndexInfo(indexInfoSavePayload(form, divisions));
  }, [form, rosterDivisions]);

  const fallbackDescription =
    'The Liberty State Department of Public Safety (DPS) is responsible for law enforcement, emergency response, and public security within the county.';

  return (
    <DepartmentIndexPanel
      department="dps"
      title="Department of Public Safety"
      sealUrl={DPS_SEAL_URL}
      info={draftInfo}
      liveDivisions={rosterDivisions}
      fallbackDescription={fallbackDescription}
      fallbackDivisions={draftInfo.divisions ?? []}
      fallbackSubDepartments={[
        { name: 'River City Police Department (RCPD)', description: '' },
        { name: 'Liberty County Sheriff Office (LCSO)', description: '' },
      ]}
      fallbackHeroUrl={DPS_INDEX_BANNER_URL}
      accent="#4384ff"
      accentMuted="#7eb8ff"
      primaryBtnClass="bg-[#2f66ee] shadow-[0_6px_20px_rgba(47,102,238,0.28)] hover:bg-[#3977ff]"
      outlineBtnClass="border-[#2f66ee]/40 bg-[#2f66ee]/10 text-[#4384ff] hover:bg-[#2f66ee]/20"
      divisionDotClass="bg-[#4384ff]"
      onOpenPage={noop}
      onResources={noop}
      onRoster={noop}
      onEvents={noop}
    />
  );
}
