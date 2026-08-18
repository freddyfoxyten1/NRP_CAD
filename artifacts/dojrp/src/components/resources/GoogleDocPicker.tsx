import { useState } from 'react';
import { parseGoogleDocId } from '@/lib/google-doc-url';

export type GoogleDocSelection = {
  fileId: string;
  title: string;
  url?: string;
  integrationId?: number;
};

type Props = {
  createdBy?: string | null;
  adminCode?: string;
  onChange: (selection: GoogleDocSelection | null) => void;
};

const GoogleDocPicker = ({ onChange }: Props) => {
  const [urlInput, setUrlInput] = useState('');
  const [linkedId, setLinkedId] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const applyLink = (raw = urlInput) => {
    const fileId = parseGoogleDocId(raw);
    if (!fileId) {
      setLinkedId('');
      onChange(null);
      setStatus(raw.trim() ? 'Paste a valid Google Doc share link.' : 'Paste a Google Doc share link first.');
      return false;
    }
    setLinkedId(fileId);
    setStatus(null);
    onChange({ fileId, title: 'Google Doc', url: raw.trim() });
    return true;
  };

  return (
    <div
      className="relative z-10 space-y-3 rounded-xl border border-[#2a3b56] bg-[#07111f] p-3"
      onClick={e => e.stopPropagation()}
      onKeyDown={e => e.stopPropagation()}
    >
      <label className="block space-y-1.5">
        <span className="text-[10px] font-black uppercase tracking-widest text-[#3f5470]">Google Doc share link</span>
        <input
          value={urlInput}
          onChange={e => {
            const next = e.target.value;
            setUrlInput(next);
            const fileId = parseGoogleDocId(next);
            if (!fileId) {
              setLinkedId('');
              onChange(null);
              setStatus(/docs\.google|drive\.google/i.test(next) ? 'Paste a valid Google Doc share link.' : null);
              return;
            }
            setLinkedId(fileId);
            setStatus(null);
            onChange({ fileId, title: 'Google Doc', url: next.trim() });
          }}
          onPaste={e => {
            const pasted = e.clipboardData.getData('text');
            if (parseGoogleDocId(pasted)) {
              window.setTimeout(() => applyLink(pasted), 0);
            }
          }}
          placeholder="Paste the Google Doc share link here"
          className="h-10 w-full min-w-0 rounded-lg border border-[#1e2d42] bg-[#070d16] px-3 text-xs text-white placeholder:text-[#3f5470]"
        />
      </label>
      <p className="text-[11px] leading-relaxed text-[#526179]">
        In Google Docs: <span className="font-semibold text-[#8eb0ff]">Share → General access → Anyone with the link → Viewer</span>.
      </p>
      {linkedId && (
        <p className="text-[11px] font-semibold text-[#34d399]">Link ready — click Link Google Doc below.</p>
      )}
      {status && <p className="text-[11px] font-semibold text-[#f0b27a]">{status}</p>}
    </div>
  );
};

export default GoogleDocPicker;
