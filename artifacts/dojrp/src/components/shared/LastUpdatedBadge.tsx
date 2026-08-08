const lastUpdated = new Date(__APP_LAST_UPDATED__);

const formattedDate = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
}).format(lastUpdated);

const LastUpdatedBadge = () => (
  <div className="fixed bottom-4 right-4 z-10 hidden rounded-full border border-[#192336] bg-[#0d1422]/95 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-[#66748a] shadow-lg sm:block">
    Last updated: <span className="text-[#2f70ff]">{formattedDate}</span>
  </div>
);

export default LastUpdatedBadge;
