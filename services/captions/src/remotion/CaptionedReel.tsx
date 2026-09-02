import React from 'react';
import { AbsoluteFill, OffthreadVideo, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { groupWords, type CaptionCue } from '../cues';
import {
  captionsSuppressedUntil,
  hookOverlayStateAt,
  overlayCueOpacityAt,
  selectActiveGroup,
  type OverlayCue,
} from '../hook';

export interface OverlayProps {
  hook: string | null;
  stamps: OverlayCue[];
  exhibits: OverlayCue[];
  /** "AI RECONSTRUCTION" under the first stamp — the AIGC label, on screen. */
  notice?: OverlayCue | null;
}

export interface CaptionedReelProps {
  videoSrc: string;
  cues: CaptionCue[];
  durationSeconds: number;
  /** The Evidence File overlay layer. Scheduled by the API, animated here. */
  overlay?: OverlayProps | null;
}

const SANS =
  '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
/**
 * The annotation face. IBM Plex Mono is not bundled yet, so a headless render
 * resolves this to the platform mono — a real mono face, just not Plex. See
 * the README note: committing the woff2 is what makes it deterministic.
 */
const MONO = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';

const STROKE = 'rgba(0,0,0,0.85)';

/**
 * Burns the overlay layer and kinetic word-group captions over the merged,
 * already audio-synced video.
 *
 * Layer order, front to back: centre-frame hook (first ~2.5s), upper-third
 * location/date stamp, lower-third captions. The captions stay hidden while
 * the hook is up — two competing text blocks in second one is noise.
 */
export const CaptionedReel: React.FC<CaptionedReelProps> = ({ videoSrc, cues, overlay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const groups = React.useMemo(() => groupWords(cues), [cues]);
  const hook = overlay?.hook?.trim() ? overlay.hook.trim() : null;
  const active = selectActiveGroup(groups, t, captionsSuppressedUntil(Boolean(hook)));

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      <OffthreadVideo src={videoSrc} />

      {(overlay?.stamps ?? []).map((stamp, i) => (
        <EvidenceStamp key={`stamp-${i}`} cue={stamp} t={t} />
      ))}
      {(overlay?.exhibits ?? []).map((exhibit, i) => (
        <ExhibitTag key={`exhibit-${i}`} cue={exhibit} t={t} />
      ))}
      {overlay?.notice ? <ReconstructionNotice cue={overlay.notice} t={t} /> : null}

      {hook ? <HookOverlay text={hook} t={t} frame={frame} fps={fps} /> : null}

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
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', textAlign: 'center' }}>
            {active.words.map((word, i) => {
              const isSpoken = t >= word.start;
              return (
                <span
                  key={`${word.start}-${i}`}
                  style={{
                    // explicit margins, not flex gap: the 10px text stroke bleeds
                    // ~5px past each glyph and gap alone reads as glued-together
                    margin: '0 14px',
                    fontFamily: SANS,
                    fontWeight: 800,
                    fontSize: 66,
                    lineHeight: 1.3,
                    textTransform: 'uppercase',
                    color: isSpoken ? '#FFD400' : '#FFFFFF',
                    WebkitTextStroke: `9px ${STROKE}`,
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

/**
 * The swipe-stopper. Centre frame, 88px, the captions' stroke scaled
 * proportionally (9px at 66px becomes 12px at 88px). Present at full opacity
 * from frame 0 so the cover frame carries it.
 */
const HookOverlay: React.FC<{ text: string; t: number; frame: number; fps: number }> = ({
  text,
  t,
  frame,
  fps,
}) => {
  const state = hookOverlayStateAt(t);
  if (!state.visible) return null;

  // entrance settle only: 0.94 -> 1.00, overdamped so it never overshoots into
  // the safe area. Opacity belongs to hookOverlayStateAt.
  const settle = spring({
    frame,
    fps,
    from: 0.94,
    to: 1,
    config: { damping: 200, mass: 0.6, stiffness: 120 },
    durationInFrames: Math.round(fps * 0.45),
  });

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', paddingLeft: 90, paddingRight: 90 }}>
      <div
        style={{
          maxWidth: 900,
          textAlign: 'center',
          opacity: state.opacity,
          transform: `translateY(${state.translateY}px) scale(${settle * state.scale})`,
          fontFamily: SANS,
          fontWeight: 800,
          fontSize: 88,
          lineHeight: 1.15,
          textTransform: 'uppercase',
          color: '#FFFFFF',
          WebkitTextStroke: `12px ${STROKE}`,
          paintOrder: 'stroke fill',
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

/**
 * Upper-third location/date stamp with a hairline rule beneath it — the
 * investigator's annotation, and the one thing that stays constant while the
 * capture medium changes with the era.
 */
const EvidenceStamp: React.FC<{ cue: OverlayCue; t: number }> = ({ cue, t }) => {
  const opacity = overlayCueOpacityAt(cue, t);
  if (opacity <= 0) return null;
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'center', paddingTop: 300 }}>
      <div style={{ opacity, textAlign: 'center', maxWidth: 880 }}>
        <div
          style={{
            fontFamily: MONO,
            fontWeight: 500,
            fontSize: 34,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: '#FFFFFF',
            WebkitTextStroke: `5px ${STROKE}`,
            paintOrder: 'stroke fill',
          }}
        >
          {cue.text}
        </div>
        <div
          style={{
            marginTop: 12,
            height: 1,
            background: 'rgba(255,255,255,0.72)',
            boxShadow: `0 0 3px ${STROKE}`,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

/**
 * The AIGC disclosure, in the annotation face, tucked under the stamp's rule
 * line. Small on purpose: it is a label, not a hook.
 */
const ReconstructionNotice: React.FC<{ cue: OverlayCue; t: number }> = ({ cue, t }) => {
  const opacity = overlayCueOpacityAt(cue, t);
  if (opacity <= 0) return null;
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'center', paddingTop: 372 }}>
      <div
        style={{
          opacity: opacity * 0.85,
          fontFamily: MONO,
          fontWeight: 500,
          fontSize: 22,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: '#FFFFFF',
          WebkitTextStroke: `4px ${STROKE}`,
          paintOrder: 'stroke fill',
        }}
      >
        {cue.text}
      </div>
    </AbsoluteFill>
  );
};

/** EXHIBIT-style tag for a map or diagram beat. */
const ExhibitTag: React.FC<{ cue: OverlayCue; t: number }> = ({ cue, t }) => {
  const opacity = overlayCueOpacityAt(cue, t);
  if (opacity <= 0) return null;
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'flex-start', padding: '420px 0 0 72px' }}>
      <div
        style={{
          opacity,
          fontFamily: MONO,
          fontWeight: 500,
          fontSize: 26,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: '#FFFFFF',
          padding: '6px 14px',
          border: '1px solid rgba(255,255,255,0.72)',
          background: 'rgba(0,0,0,0.42)',
        }}
      >
        {cue.text}
      </div>
    </AbsoluteFill>
  );
};
