/** Public index Departments tab — editable per department via Department Panel → Information → Index. */
export interface IndexInfoContent {
  description: string;
  divisions?: string[];
  sub_departments: { name: string; description: string }[];
  tagline?: string;
  hero_image_url?: string | null;
  hero_image_scale?: number;
  hero_image_position_x?: number;
  hero_image_position_y?: number;
  discord_join_url?: string | null;
}

export interface IndexInfoFormState {
  description: string;
  divisions: string;
  tagline: string;
  hero_image_url: string;
  hero_image_scale: number;
  hero_image_pos_x: number;
  hero_image_pos_y: number;
  discord_join_url: string;
  sub_departments: { name: string; description: string }[];
}

export function emptyIndexInfoForm(): IndexInfoFormState {
  return {
    description: '',
    divisions: '',
    tagline: '',
    hero_image_url: '',
    hero_image_scale: 1,
    hero_image_pos_x: 50,
    hero_image_pos_y: 50,
    discord_join_url: '',
    sub_departments: [{ name: '', description: '' }],
  };
}

export function isInternalAffairsSubDepartment(name: string): boolean {
  return /internal affairs/i.test(name.trim());
}

export function withoutInternalAffairsSubs(
  subs: { name: string; description: string }[] | undefined,
): { name: string; description: string }[] {
  return (subs ?? []).filter(sd => !isInternalAffairsSubDepartment(sd.name));
}

export function normalizeIndexInfo(d: Partial<IndexInfoContent>): IndexInfoContent {
  return {
    description: d.description ?? '',
    divisions: d.divisions,
    sub_departments: withoutInternalAffairsSubs(d.sub_departments),
    tagline: d.tagline,
    hero_image_url: d.hero_image_url,
    hero_image_scale: d.hero_image_scale,
    hero_image_position_x: d.hero_image_position_x,
    hero_image_position_y: d.hero_image_position_y,
    discord_join_url: d.discord_join_url,
  };
}

export function indexInfoHasContent(d: Partial<IndexInfoContent> | null | undefined): boolean {
  if (!d) return false;
  const subs = withoutInternalAffairsSubs(d.sub_departments);
  return !!(
    d.description?.trim()
    || d.tagline?.trim()
    || d.hero_image_url?.trim()
    || d.discord_join_url?.trim()
    || subs.length > 0
  );
}

export function indexInfoFormFromApi(d: Partial<IndexInfoContent>): IndexInfoFormState {
  return {
    description: d.description ?? '',
    divisions: (d.divisions ?? []).join('\n'),
    tagline: d.tagline ?? '',
    hero_image_url: d.hero_image_url ?? '',
    hero_image_scale: d.hero_image_scale ?? 1,
    hero_image_pos_x: d.hero_image_position_x ?? 50,
    hero_image_pos_y: d.hero_image_position_y ?? 50,
    discord_join_url: d.discord_join_url ?? '',
    sub_departments: (() => {
      const subs = withoutInternalAffairsSubs(d.sub_departments);
      return subs.length ? subs : [{ name: '', description: '' }];
    })(),
  };
}

export function indexInfoSavePayload(
  form: IndexInfoFormState,
  divisions: string[],
): IndexInfoContent {
  const sub_departments = withoutInternalAffairsSubs(
    form.sub_departments.filter(s => s.name.trim()),
  );
  return {
    description: form.description.trim(),
    divisions,
    sub_departments,
    tagline: form.tagline.trim() || undefined,
    hero_image_url: form.hero_image_url.trim() || null,
    hero_image_scale: form.hero_image_scale,
    hero_image_position_x: form.hero_image_pos_x,
    hero_image_position_y: form.hero_image_pos_y,
    discord_join_url: form.discord_join_url.trim() || null,
  };
}
