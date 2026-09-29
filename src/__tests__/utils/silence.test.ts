/**
 * FalconCut: cut_silences-тің таза есептеулері — silencedetect шығысы, кесінділер,
 * кесуден кейінгі орналасу және оны Premiere-ден оқылғанмен салыстыру.
 */

import { buildCuts, compareLayouts, mergeIntervals, parseSilencedetect, simulateCuts, type TimelineClip } from '../../utils/silence.js';

const FRAME = 0.04; // 25 fps

describe('parseSilencedetect', () => {
  it('reads start/end pairs and closes a pause that runs to the end of the window', () => {
    const stderr = [
      '[silencedetect @ 000001] silence_start: 1.2',
      '[silencedetect @ 000001] silence_end: 2.7 | silence_duration: 1.5',
      'size=N/A time=00:00:10.00 bitrate=N/A',
      '[silencedetect @ 000001] silence_start: 8.4',
    ].join('\n');
    expect(parseSilencedetect(stderr, 10)).toEqual([[1.2, 2.7], [8.4, 10]]);
  });

  it('clamps a negative start (ffmpeg reports -0.01 at the very beginning) and ignores an orphan end', () => {
    const stderr = 'silence_end: 0.5 | silence_duration: 0.5\nsilence_start: -0.01\nsilence_end: 0.9';
    expect(parseSilencedetect(stderr, 5)).toEqual([[0, 0.9]]);
  });

  it('returns nothing when there is no pause', () => {
    expect(parseSilencedetect('size=N/A time=00:00:10.00', 10)).toEqual([]);
  });
});

describe('mergeIntervals', () => {
  it('joins pauses that touch or nearly touch, keeps separate ones apart', () => {
    expect(mergeIntervals([[5, 6], [1, 2], [2.05, 3], [6.5, 7]])).toEqual([[1, 3], [5, 6], [6.5, 7]]);
  });
});

describe('buildCuts', () => {
  const options = { paddingSeconds: 0.15, minCutSeconds: 0.2, frameSeconds: FRAME, sequenceEnd: 20 };

  it('keeps padding on both sides and snaps inwards to whole frames', () => {
    // 4.15 → 4.16 (up), 5.85 → 5.84 (down)
    expect(buildCuts([[4, 6]], options)).toEqual([[4.16, 5.84]]);
  });

  it('removes a pause at the start or end of the sequence completely', () => {
    expect(buildCuts([[0, 1.5], [19.4, 20]], options)).toEqual([[0, 1.32], [19.56, 20]]);
  });

  it('skips cuts that are too short once padding is taken off', () => {
    // 0.5 s pause − 2 × 0.15 padding = 0.2 s, snapped to 0.16 → below the minimum
    expect(buildCuts([[8, 8.5]], options)).toEqual([]);
  });
});

describe('simulateCuts', () => {
  const clips: TimelineClip[] = [
    { name: 'talk', trackType: 'video', trackIndex: 0, start: 0, end: 20, inPoint: 100, outPoint: 120 },
    { name: 'title', trackType: 'video', trackIndex: 1, start: 12, end: 18, inPoint: 0, outPoint: 6 },
    { name: 'talk', trackType: 'audio', trackIndex: 0, start: 0, end: 20, inPoint: 100, outPoint: 120 },
  ];
  const cuts: Array<[number, number]> = [[4.16, 5.84], [10.68, 11.32], [19.56, 20]];

  it('splits every track at the cuts and shifts later pieces by the time removed before them', () => {
    const result = simulateCuts(clips, cuts);
    const video = result.filter((clip) => clip.trackType === 'video' && clip.trackIndex === 0);
    expect(video.map((clip) => [clip.start, clip.end, clip.inPoint, clip.outPoint])).toEqual([
      [0, 4.16, 100, 104.16],
      [4.16, 9, 105.84, 110.68],
      [9, 17.24, 111.32, 119.56],
    ]);
    // Титрдің астында үзіліс болмаса да, ол сөзбен бірге 2,32 с солға жылжиды
    const title = result.find((clip) => clip.name === 'title')!;
    expect([title.start, title.end, title.inPoint]).toEqual([9.68, 15.68, 0]);
    const audio = result.filter((clip) => clip.trackType === 'audio');
    expect(audio.map((clip) => [clip.start, clip.end])).toEqual(video.map((clip) => [clip.start, clip.end]));
  });

  it('drops a clip that lies entirely inside a cut', () => {
    const inside: TimelineClip = { trackType: 'video', trackIndex: 2, start: 4.5, end: 5.5, inPoint: 0, outPoint: 1 };
    expect(simulateCuts([inside], cuts)).toEqual([]);
  });
});

describe('compareLayouts', () => {
  const expected: TimelineClip[] = [
    { trackType: 'video', trackIndex: 0, start: 0, end: 4.16, inPoint: 100, outPoint: 104.16 },
    { trackType: 'video', trackIndex: 0, start: 4.16, end: 9, inPoint: 105.84, outPoint: 110.68 },
  ];

  it('accepts a layout that matches within the tolerance', () => {
    const actual = expected.map((clip) => ({ ...clip, start: clip.start + 0.001 }));
    expect(compareLayouts(expected, actual, 0.021)).toEqual({ ok: true, expectedPieces: 2, actualPieces: 2, mismatches: [] });
  });

  it('reports a piece that did not move and a missing piece', () => {
    const moved = [expected[0]!, { ...expected[1]!, start: 5.84, end: 10.68 }];
    const comparison = compareLayouts(expected, moved, 0.021);
    expect(comparison.ok).toBe(false);
    expect(comparison.mismatches[0]).toMatch(/^V1 piece 2: start 5.84 \(expected 4.16\), end 10.68 \(expected 9\)$/);

    const missing = compareLayouts(expected, [expected[0]!], 0.021);
    expect(missing.mismatches).toEqual(['V1: expected 2 piece(s), found 1']);
  });
});
