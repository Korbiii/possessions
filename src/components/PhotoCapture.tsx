import { useRef, type ChangeEvent, type ReactNode } from 'react';

/**
 * Photo capture (plan section 5, step 1).
 *
 * Two inputs: one opens the camera directly on mobile
 * (`capture="environment"`), the other picks existing files from the gallery.
 */
export function PhotoCapture({
  onFiles,
  busy,
}: {
  onFiles: (files: FileList) => void;
  busy?: boolean;
}): ReactNode {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) onFiles(files);
    // Allow re-selecting the same file twice.
    event.target.value = '';
  };

  return (
    <div className="capture">
      <input
        ref={cameraRef}
        className="visually-hidden"
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        onChange={handleChange}
      />
      <input
        ref={galleryRef}
        className="visually-hidden"
        type="file"
        accept="image/*"
        multiple
        onChange={handleChange}
      />
      <button
        type="button"
        className="btn btn--primary"
        disabled={busy}
        onClick={() => cameraRef.current?.click()}
      >
        📷 Take photos
      </button>
      <button
        type="button"
        className="btn"
        disabled={busy}
        onClick={() => galleryRef.current?.click()}
      >
        🖼️ Add from gallery
      </button>
    </div>
  );
}
