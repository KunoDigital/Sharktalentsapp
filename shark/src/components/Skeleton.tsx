import './skeleton.css';

type Props = {
  width?: string | number;
  height?: string | number;
  rounded?: boolean | 'full';
  className?: string;
};

export function Skeleton({ width, height, rounded, className }: Props) {
  const style: React.CSSProperties = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
    borderRadius: rounded === 'full' ? '9999px' : rounded ? '6px' : '4px',
  };
  return <div className={`skeleton ${className ?? ''}`} style={style} aria-hidden="true" />;
}

export function SkeletonRow({ cols = 5 }: { cols?: number }) {
  return (
    <tr className="skeleton-row">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i}><Skeleton height={16} /></td>
      ))}
    </tr>
  );
}

export function SkeletonStatCard() {
  return (
    <div className="stat-card">
      <Skeleton width={60} height={28} className="skel-mb" />
      <Skeleton width="80%" height={12} />
    </div>
  );
}

export function SkeletonCard({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton-card">
      <Skeleton width="60%" height={20} className="skel-mb" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} width={i === rows - 1 ? '40%' : '100%'} height={12} className="skel-mb-sm" />
      ))}
    </div>
  );
}

export function SkeletonChart({ height = 220 }: { height?: number }) {
  return (
    <div className="chart-card">
      <Skeleton width="40%" height={14} className="skel-mb" />
      <Skeleton width="100%" height={height} />
    </div>
  );
}
