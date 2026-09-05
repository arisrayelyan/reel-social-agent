import type { SourceImage } from '@reel-agent/shared';
import { mediaUrl } from '@/lib/api';

/**
 * The photographs the source article showed, as the story model saw them:
 * each thumbnail carries its vision-pass description as the tooltip, and the
 * line beneath says whether that pass ran. Nothing here is a render asset —
 * these ground the image prompts and stay out of the reel.
 */
export function SourcePhotos({ images }: { images: SourceImage[] }) {
  if (images.length === 0) return null;
  const described = images.filter((img) => img.description);
  const model = described[0]?.analysis_model;
  return (
    <div style={{ marginBottom: 12 }} data-testid="source-photos">
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {images.map((img) => (
          <a
            key={img.sha256}
            href={img.url}
            target="_blank"
            rel="noreferrer"
            title={img.description ?? img.alt ?? img.url}
            style={{
              display: 'block',
              width: 56,
              height: 56,
              borderRadius: 4,
              overflow: 'hidden',
              border: `1px solid ${img.description ? 'var(--line)' : 'var(--warn)'}`,
              opacity: img.description ? 1 : 0.55,
              background: 'var(--bg-0)',
            }}
          >
            <img
              src={mediaUrl(img.file_path)}
              alt={img.alt ?? 'source photo'}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          </a>
        ))}
      </div>
      <div style={{ marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>
        {images.length} source photo{images.length === 1 ? '' : 's'} from the page
        {model
          ? ` · ${described.length} described by ${model} and fed to the image prompts`
          : ' · not described — the story was written from the text alone'}
      </div>
    </div>
  );
}
