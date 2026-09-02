import React from 'react';
import { Composition } from 'remotion';
import { CaptionedReel, type CaptionedReelProps } from './CaptionedReel';

const FPS = 30;

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="CaptionedReel"
      component={CaptionedReel as React.FC<Record<string, unknown> & CaptionedReelProps>}
      width={1080}
      height={1920}
      fps={FPS}
      durationInFrames={30 * FPS}
      // never `undefined` here — Remotion rejects it in defaultProps
      defaultProps={{
        videoSrc: '',
        cues: [],
        durationSeconds: 30,
        overlay: { hook: '', stamps: [], exhibits: [] },
      }}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.ceil((props.durationSeconds as number) * FPS),
      })}
    />
  );
};
