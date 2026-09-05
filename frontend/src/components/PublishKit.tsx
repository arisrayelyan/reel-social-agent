import type { Story } from '@reel-agent/shared';
import { Pill, SectionLabel } from '@/components/design';

/**
 * What the producer carries into TikTok at post time: the caption (one string —
 * curiosity line plus hashtags) and the music suggestion. Music is added
 * inside TikTok, never in the render, so this is advice, laid out to be
 * copied: the caption selects in one click, and so does each search term.
 */
export function PublishKit({ story }: { story: Story }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {story.tiktok_caption && (
        <div>
          <SectionLabel>Suggested caption</SectionLabel>
          <div
            style={{
              fontSize: 13,
              color: 'var(--text-2)',
              background: 'var(--bg-0)',
              border: '1px solid var(--line)',
              borderRadius: 6,
              padding: 10,
              maxWidth: 420,
              userSelect: 'all',
              whiteSpace: 'pre-wrap',
            }}
          >
            {story.tiktok_caption}
          </div>
        </div>
      )}
      {story.music && (
        <div data-testid="music-suggestion">
          <SectionLabel>Music</SectionLabel>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Pill tone="amber">{story.music.genre}</Pill>
            {story.music.search_terms.map((term) => (
              <span key={term} style={{ userSelect: 'all', display: 'inline-flex' }}>
                <Pill tone="gray">{term}</Pill>
              </span>
            ))}
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-2)', maxWidth: 420 }}>
            {story.music.note ? `${story.music.note} ` : ''}
            <span style={{ color: 'var(--text-3)' }}>
              Search these in TikTok's sound library when posting.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
