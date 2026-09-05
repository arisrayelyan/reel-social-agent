import { describe, expect, it } from 'vitest';
import { CAMERA_MOVES, VIDEO, cameraMoveFor } from '@reel-agent/shared';
import {
  buildConcatArgs,
  buildMuxArgs,
  buildNormalizeClipArgs,
  buildPadAudioArgs,
  buildShotArgs,
} from '../src/utils/ffmpeg.js';

describe('buildNormalizeClipArgs', () => {
  const args = buildNormalizeClipArgs({ input: 'in.mp4', output: 'out.mp4', targetSeconds: 7.4567 });

  it('normalizes to 1080x1920 @ 30fps and trims to the exact target', () => {
    const vf = args[args.indexOf('-vf') + 1]!;
    expect(vf).toContain('scale=1080:1920');
    expect(vf).toContain('fps=30');
    expect(vf).toContain('tpad=stop_mode=clone:stop_duration=7.457');
    expect(args[args.indexOf('-t') + 1]).toBe('7.457');
  });

  it('strips the source audio track', () => {
    expect(args).toContain('-an');
  });
});

describe('buildPadAudioArgs', () => {
  it('pads with trailing silence to the same target as the clip', () => {
    const args = buildPadAudioArgs({ input: 'a.wav', output: 'b.wav', targetSeconds: 7.4567 });
    expect(args[args.indexOf('-af') + 1]).toBe('apad=whole_dur=7.457');
    expect(args[args.indexOf('-t') + 1]).toBe('7.457');
  });
});

describe('buildConcatArgs', () => {
  it('uses the concat demuxer with stream copy for video', () => {
    const args = buildConcatArgs({ listFile: 'list.txt', output: 'out.mp4', copyCodec: true });
    expect(args).toEqual(['-y', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'out.mp4']);
  });
});

describe('buildMuxArgs', () => {
  it('maps video from input 0 and audio from input 1 with loudness normalization', () => {
    const args = buildMuxArgs({ videoInput: 'v.mp4', audioInput: 'a.wav', output: 'final.mp4' });
    expect(args.join(' ')).toContain('-map 0:v:0 -map 1:a:0');
    expect(args.join(' ')).toContain('loudnorm');
    expect(args).toContain('-shortest');
  });
});

describe('buildShotArgs', () => {
  const pushIn = CAMERA_MOVES.find((m) => m.id === 'push_in')!;
  const panRight = CAMERA_MOVES.find((m) => m.id === 'pan_right')!;

  describe('a still with a camera move', () => {
    const args = buildShotArgs({
      input: 'frame.png',
      output: 'shot.mp4',
      targetSeconds: 2.66,
      camera: pushIn,
      sourceKind: 'still',
    });
    const vf = args[args.indexOf('-vf') + 1]!;

    it('holds the single input frame for the whole shot', () => {
      // 2.66s at 30fps = 80 frames; without d=<frames> a PNG yields one frame
      expect(vf).toContain('d=80:');
      expect(args[args.indexOf('-t') + 1]).toBe('2.660');
    });

    it('ramps the zoom across the shot rather than jumping', () => {
      expect(vf).toContain('zoompan=z=1.0000+(0.1800)*on/79');
    });

    it('crops from a 2x canvas so the move does not stutter', () => {
      expect(vf).toContain(`scale=${VIDEO.width * 2}:${VIDEO.height * 2}`);
      expect(vf).toContain(`s=${VIDEO.width}x${VIDEO.height}`);
    });

    it('centres a pure zoom on the frame', () => {
      expect(vf).toContain('x=(iw-iw/zoom)*(0.5000)');
      expect(vf).toContain('y=(ih-ih/zoom)*(0.5000)');
    });

    it('never emits a comma inside a filter option value', () => {
      // a comma there needs escaping, and getting it wrong fails silently
      const zoompan = vf.split(',').find((f) => f.startsWith('zoompan='))!;
      expect(zoompan).toBeDefined();
      expect(zoompan).toContain('fps=30');
    });

    it('does not seek — a still has nowhere to seek to', () => {
      expect(args).not.toContain('-ss');
    });
  });

  describe('a window of an existing clip', () => {
    const args = buildShotArgs({
      input: 'clip.mp4',
      output: 'shot.mp4',
      targetSeconds: 2.66,
      camera: panRight,
      sourceKind: 'clip',
      startSeconds: 3.2,
    });
    const vf = args[args.indexOf('-vf') + 1]!;

    it('seeks after the input, so the window is frame accurate', () => {
      // a pre-input -ss snaps to the nearest keyframe and would slide the
      // window by up to a GOP
      expect(args.indexOf('-ss')).toBeGreaterThan(args.indexOf('clip.mp4'));
      expect(args[args.indexOf('-ss') + 1]).toBe('3.200');
    });

    it('maps one input frame to one output frame', () => {
      expect(vf).toContain('d=1:');
      expect(vf.indexOf('fps=30')).toBeLessThan(vf.indexOf('zoompan='));
    });

    it('travels the window instead of zooming', () => {
      expect(vf).toContain('zoompan=z=1.1400:');
      expect(vf).toContain('x=(iw-iw/zoom)*(0.3800+(0.2400)*on/79)');
    });

    it('holds the last frame if the window overruns the source', () => {
      expect(vf).toContain('tpad=stop_mode=clone:stop_duration=2.660');
    });
  });

  it('encodes identically to buildNormalizeClipArgs — concat uses -c copy', () => {
    const shot = buildShotArgs({
      input: 'a.png', output: 'a.mp4', targetSeconds: 3,
      camera: cameraMoveFor(0, 0), sourceKind: 'still',
    });
    const norm = buildNormalizeClipArgs({ input: 'b.mp4', output: 'b.mp4', targetSeconds: 3 });
    const encodeOf = (args: string[]) => args.slice(args.indexOf('-an'), args.length - 1);
    expect(encodeOf(shot)).toEqual(encodeOf(norm));
  });
});
