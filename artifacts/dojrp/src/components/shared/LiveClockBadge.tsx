import { useEffect, useState } from 'react';

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'short',
});

const LiveClockBadge = () => {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="fixed bottom-4 right-4 z-10 hidden rounded-full border border-[#192336] bg-[#0d1422]/95 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-[#66748a] shadow-lg sm:block">
      {dateFormatter.format(now)}{' '}
      <span className="text-[#2f70ff]">{timeFormatter.format(now)}</span>
    </div>
  );
};

export default LiveClockBadge;
