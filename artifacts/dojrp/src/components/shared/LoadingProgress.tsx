type SimpleLoadingProps = {
  label?: string;
  className?: string;
  minHeightClass?: string;
};

/** Plain loading text — no percent, no progress bar. */
export function SimpleLoading({
  label = 'Loading…',
  className = '',
  minHeightClass = 'min-h-[55vh]',
}: SimpleLoadingProps) {
  return (
    <div className={`flex ${minHeightClass} items-center justify-center px-6 py-10 ${className}`}>
      <p className="text-sm font-bold text-[#8ea1bb]">{label}</p>
    </div>
  );
}

/** @deprecated Use SimpleLoading */
export function LoadingProgress({
  label = 'Loading…',
  minHeightClass = 'min-h-[55vh]',
  className = '',
}: {
  percent?: number;
  label?: string;
  detail?: string;
  accent?: string;
  className?: string;
  minHeightClass?: string;
  compact?: boolean;
}) {
  return <SimpleLoading label={label} minHeightClass={minHeightClass} className={className} />;
}

/** @deprecated Use SimpleLoading */
export function PageLoadingScreen({
  loading,
  label = 'Loading…',
  minHeightClass = 'min-h-[55vh]',
  className = '',
}: {
  loading: boolean;
  label?: string;
  detail?: string;
  percent?: number;
  accent?: string;
  className?: string;
  minHeightClass?: string;
}) {
  if (!loading) return null;
  return <SimpleLoading label={label} minHeightClass={minHeightClass} className={className} />;
}

/** @deprecated Use SimpleLoading */
export function SimulatedLoadingProgress({
  active = true,
  label = 'Loading…',
  minHeightClass = 'min-h-[260px]',
  className = '',
}: {
  active?: boolean;
  label?: string;
  accent?: string;
  className?: string;
  minHeightClass?: string;
  compact?: boolean;
}) {
  if (!active) return null;
  return <SimpleLoading label={label} minHeightClass={minHeightClass} className={className} />;
}

export function usePageProgress(_loading: boolean): { show: boolean; percent: number } {
  return { show: false, percent: 0 };
}

export function useSimulatedProgress(_active: boolean): number {
  return 0;
}

export default LoadingProgress;
