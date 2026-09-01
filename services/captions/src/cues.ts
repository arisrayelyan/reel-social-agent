export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export interface CaptionCue {
  text: string;
  start: number;
  end: number;
  words: WordTiming[];
}

export interface CaptionGroup {
  words: WordTiming[];
  start: number;
  end: number;
}

const MAX_WORDS_PER_GROUP = 4;
const MAX_GROUP_SECONDS = 1.6;

/**
 * Splits each beat's word timings into kinetic caption groups of 2–4 words
 * (pipeline-decisions §5: word-group cues with active-word highlight).
 * A group breaks on word count, elapsed time, or a timing gap (pause).
 */
export function groupWords(cues: CaptionCue[]): CaptionGroup[] {
  const groups: CaptionGroup[] = [];

  for (const cue of cues) {
    let current: WordTiming[] = [];
    for (const word of cue.words) {
      const groupStart = current[0]?.start ?? word.start;
      const gap = current.length > 0 ? word.start - current[current.length - 1]!.end : 0;
      const wouldExceed =
        current.length >= MAX_WORDS_PER_GROUP ||
        word.end - groupStart > MAX_GROUP_SECONDS ||
        gap > 0.6;
      if (wouldExceed && current.length > 0) {
        groups.push(toGroup(current));
        current = [];
      }
      current.push(word);
    }
    if (current.length > 0) groups.push(toGroup(current));
  }
  return groups;
}

function toGroup(words: WordTiming[]): CaptionGroup {
  return { words: [...words], start: words[0]!.start, end: words[words.length - 1]!.end };
}
