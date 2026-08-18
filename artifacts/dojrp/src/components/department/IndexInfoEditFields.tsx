import { Plus, X } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import ImageInput from '@/components/shared/ImageInput';
import type { IndexInfoFormState } from '@/lib/index-info-content';

type RosterDivision = {
  id: number;
  name: string;
  sort_order: number;
  unit_key?: string | null;
};

type Props = {
  form: IndexInfoFormState;
  setForm: Dispatch<SetStateAction<IndexInfoFormState>>;
  rosterDivisions: RosterDivision[];
  labelCls: string;
  accent?: string;
  descriptionPlaceholder: string;
};

export default function IndexInfoEditFields({
  form,
  setForm,
  rosterDivisions,
  labelCls,
  accent = '#22d3ee',
  descriptionPlaceholder,
}: Props) {
  return (
    <>
      <div>
        <label className={labelCls}>Index Panel Image</label>
        <p className="mb-2 text-[10px] text-[#3f5470]">One banner image shown at the top of your department on the public index.</p>
        <ImageInput
          value={form.hero_image_url}
          onChange={url => setForm(p => ({ ...p, hero_image_url: url }))}
          adjust={{ scale: form.hero_image_scale, posX: form.hero_image_pos_x, posY: form.hero_image_pos_y }}
          onAdjustChange={a => setForm(p => ({
            ...p,
            hero_image_scale: a.scale,
            hero_image_pos_x: a.posX,
            hero_image_pos_y: a.posY,
          }))}
          label="Banner image"
          accent={accent}
          frameAspect={2.4}
          previewHeight="h-40"
          hint="Recommended wide landscape photo (roster, patrol, training, etc.)."
        />
      </div>

      <div>
        <label className={labelCls}>Tagline</label>
        <input
          type="text"
          value={form.tagline}
          placeholder="Short line under the department name on the index page"
          onChange={e => setForm(p => ({ ...p, tagline: e.target.value }))}
          className="w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#22d3ee]"
        />
      </div>

      <div>
        <label className={labelCls}>Department Description</label>
        <textarea
          value={form.description}
          rows={4}
          placeholder={descriptionPlaceholder}
          onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
          className="w-full resize-none rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#22d3ee]"
        />
      </div>

      <div>
        <label className={labelCls}>Discord Join Link</label>
        <input
          type="url"
          value={form.discord_join_url}
          placeholder="https://discord.gg/your-invite"
          onChange={e => setForm(p => ({ ...p, discord_join_url: e.target.value }))}
          className="w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#22d3ee]"
        />
        <p className="mt-1.5 text-[10px] text-[#3f5470]">Adds a Join Discord button on the public index Departments tab.</p>
      </div>

      <div>
        <label className={labelCls}>Department Divisions</label>
        <div className="rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-3">
          {rosterDivisions.length === 0 ? (
            <p className="text-xs text-[#3f5470]">
              No divisions yet — add them under Department Panel → Division Roster.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {[...rosterDivisions]
                .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
                .map(d => (
                  <li key={d.id} className="flex items-center gap-2 text-xs font-semibold text-[#a8b7cd]">
                    <span className="h-1 w-1 rounded-full bg-[#22d3ee]" />
                    {d.name}
                    {d.unit_key?.trim() ? (
                      <span className="text-[10px] font-black uppercase tracking-wider text-[#3f5470]">
                        ({d.unit_key.trim().toUpperCase()})
                      </span>
                    ) : null}
                  </li>
                ))}
            </ul>
          )}
          <p className="mt-2 text-[10px] text-[#3f5470]">
            Updated automatically from Division Roster — shown live on the index Departments tab.
          </p>
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <label className={labelCls}>Sub-Departments</label>
          <button
            type="button"
            onClick={() => setForm(p => ({ ...p, sub_departments: [...p.sub_departments, { name: '', description: '' }] }))}
            className="flex items-center gap-1 text-[10px] font-black text-[#22d3ee] hover:text-[#67e8f9] transition-colors"
          >
            <Plus className="h-3 w-3" /> Add
          </button>
        </div>
        <div className="space-y-3">
          {form.sub_departments.map((sd, i) => (
            <div key={i} className="relative rounded-lg border border-[#1f3050] bg-[#07111f] p-4">
              {form.sub_departments.length > 1 && (
                <button
                  type="button"
                  onClick={() => setForm(p => ({ ...p, sub_departments: p.sub_departments.filter((_, j) => j !== i) }))}
                  className="absolute right-3 top-3 rounded p-0.5 text-[#526179] hover:text-red-400 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
              <input
                type="text"
                value={sd.name}
                placeholder="Sub-department name"
                onChange={e => setForm(p => ({
                  ...p,
                  sub_departments: p.sub_departments.map((s, j) => j === i ? { ...s, name: e.target.value } : s),
                }))}
                className="mb-2 w-full rounded border border-[#1f3050] bg-[#0a1520] px-3 py-1.5 text-xs font-black text-white placeholder:text-[#3f5470] outline-none focus:border-[#22d3ee]"
              />
              <textarea
                value={sd.description}
                rows={2}
                placeholder="Brief description…"
                onChange={e => setForm(p => ({
                  ...p,
                  sub_departments: p.sub_departments.map((s, j) => j === i ? { ...s, description: e.target.value } : s),
                }))}
                className="w-full resize-none rounded border border-[#1f3050] bg-[#0a1520] px-3 py-1.5 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#22d3ee]"
              />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
