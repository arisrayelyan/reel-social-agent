import React from 'react';
import { AbsoluteFill, OffthreadVideo, useCurrentFrame, useVideoConfig } from 'remotion';
import { groupWords, type CaptionCue } from '../cues';

export interface CaptionedReelProps {
  videoSrc: string;
  cues: CaptionCue[];
  durationSeconds: number;
}

/**
 * Burns kinetic word-group captions over the already audio-synced merged
 * video. The active word is highlighted; groups sit in the lower third,
 * safe-area clear of TikTok UI chrome.
 */
export const CaptionedReel: React.FC<CaptionedReelProps> = ({ videoSrc, cues }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const groups = React.useMemo(() => groupWords(cues), [cues]);
  const active = groups.find((g) => t >= g.start && t <= g.end + 0.08);

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      <OffthreadVideo src={videoSrc} />
      {active ? (
        <AbsoluteFill
          style={{
            justifyContent: 'flex-end',
            alignItems: 'center',
            paddingBottom: 420,
            paddingLeft: 60,
            paddingRight: 60,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              textAlign: 'center',
            }}
          >
            {active.words.map((word, i) => {
              const isSpoken = t >= word.start;
              return (
                <span
                  key={`${word.start}-${i}`}
                  style={{
                    // explicit margins, not flex gap: the 10px text stroke bleeds
                    // ~5px past each glyph and gap alone reads as glued-together
                    margin: '0 14px',
                    fontFamily:
                      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                    fontWeight: 800,
                    fontSize: 66,
                    lineHeight: 1.3,
                    textTransform: 'uppercase',
                    color: isSpoken ? '#FFD400' : '#FFFFFF',
                    WebkitTextStroke: '9px rgba(0,0,0,0.85)',
                    paintOrder: 'stroke fill',
                    transform: isSpoken ? 'scale(1.06)' : 'scale(1)',
                  }}
                >
                  {word.word}
                </span>
              );
            })}
          </div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};
