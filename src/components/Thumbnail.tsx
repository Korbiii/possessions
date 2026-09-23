import type { ReactNode } from 'react';
import type { ItemStatus } from '../types';
import { STATUS_LABELS } from '../types';
import { useBlobUrl } from '../hooks/useBlobUrl';

export function Thumbnail({
  blobId,
  alt,
  className,
}: {
  blobId: string | undefined;
  alt: string;
  className?: string;
}): ReactNode {
  const url = useBlobUrl(blobId);
  if (!url) {
    return (
      <div className={`thumb thumb--placeholder ${className ?? ''}`} aria-label={alt} role="img">
        <span aria-hidden="true">🖼️</span>
      </div>
    );
  }
  return <img className={`thumb ${className ?? ''}`} src={url} alt={alt} loading="lazy" />;
}

export function StatusBadge({ status }: { status: ItemStatus }): ReactNode {
  return <span className={`badge badge--${status}`}>{STATUS_LABELS[status]}</span>;
}

export function FullImage({ blobId, alt }: { blobId: string | undefined; alt: string }): ReactNode {
  const url = useBlobUrl(blobId);
  if (!url) return <div className="photo photo--empty">Photo unavailable</div>;
  return <img className="photo" src={url} alt={alt} />;
}
