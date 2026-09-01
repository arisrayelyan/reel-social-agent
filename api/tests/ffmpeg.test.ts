import { describe, expect, it } from 'vitest';
import {
  buildConcatArgs,
  buildMuxArgs,
  buildNormalizeClipArgs,
  buildPadAudioArgs,
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
