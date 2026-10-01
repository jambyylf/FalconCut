/**
 * FalconCut: уақытты секундпен немесе Premiere таймкодымен оқу.
 */

import { formatTimecode, parseTimeInput } from '../../utils/timecode.js';

const FPS25 = 0.04;
const NTSC = 1001 / 30000; // 29.97

describe('parseTimeInput', () => {
  it('takes seconds as a number or a numeric string', () => {
    expect(parseTimeInput(22.12, FPS25)).toBe(22.12);
    expect(parseTimeInput(' 22.12 ', FPS25)).toBe(22.12);
  });

  it('reads a timecode with the sequence frame rate', () => {
    expect(parseTimeInput('00:00:22:03', FPS25)).toBeCloseTo(22.12, 9);
    // 29.97 non-drop: 1800 кадр = 60,06 с
    expect(parseTimeInput('00:01:00:00', NTSC)).toBeCloseTo(60.06, 9);
  });

  it('counts a timecode from the sequence start timecode', () => {
    expect(parseTimeInput('01:00:22:03', FPS25, 3600)).toBeCloseTo(22.12, 9);
    // Сандық секунд — таймлайн уақыты, бастапқы таймкод оған әсер етпейді
    expect(parseTimeInput(22.12, FPS25, 3600)).toBe(22.12);
  });

  it('rejects impossible, drop-frame and malformed input', () => {
    expect(() => parseTimeInput('00:00:01:25', FPS25)).toThrow('Invalid timecode "00:00:01:25" for 25 fps.');
    expect(() => parseTimeInput('00:00:01;02', NTSC)).toThrow(/Drop-frame/);
    expect(() => parseTimeInput('22 секунд', FPS25)).toThrow(/use seconds \(22.12\) or a timecode/);
    expect(() => parseTimeInput(Number.NaN, FPS25)).toThrow(/Invalid time/);
  });
});

describe('formatTimecode', () => {
  it('formats seconds as HH:MM:SS:FF, optionally from a start timecode', () => {
    expect(formatTimecode(22.12, FPS25)).toBe('00:00:22:03');
    expect(formatTimecode(22.12, FPS25, 3600)).toBe('01:00:22:03');
    expect(formatTimecode(3725.48, FPS25)).toBe('01:02:05:12');
  });

  it('round-trips with parseTimeInput', () => {
    for (const timecode of ['00:00:00:00', '00:00:22:03', '00:49:08:24', '02:13:59:29']) {
      const frame = timecode.endsWith(':29') ? NTSC : FPS25;
      expect(formatTimecode(parseTimeInput(timecode, frame), frame)).toBe(timecode);
    }
  });
});
