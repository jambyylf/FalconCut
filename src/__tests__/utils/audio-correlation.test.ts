/**
 * FalconCut: FFT және дыбыс ығысуын табу — белгілі ығысуы бар синтетикалық дыбыста.
 */

import { fft, findAudioOffset, nextPowerOfTwo, summarizeOffsets } from '../../utils/audio-correlation.js';
import { decodeAudioWindow, FfmpegNotFoundError } from '../../utils/ffmpeg.js';

/** Қайталанатын жалған кездейсоқ сандар (тест әр жолы бірдей нәтиже берсін). */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** «Сөйлеу» сияқты шулы сигнал: ақ шу, баяу өзгеретін қаттылықпен. */
function speechLike(seconds: number, rate: number, seed: number): Float32Array {
  const random = seededRandom(seed);
  const out = new Float32Array(Math.round(seconds * rate));
  let envelope = 0.5;
  for (let i = 0; i < out.length; i++) {
    if (i % Math.round(rate / 10) === 0) envelope = 0.2 + random();
    out[i] = (random() * 2 - 1) * envelope;
  }
  return out;
}

describe('fft', () => {
  it('matches a naive DFT', () => {
    const random = seededRandom(7);
    const n = 16;
    const input = Array.from({ length: n }, () => random() * 2 - 1);
    const re = Float64Array.from(input);
    const im = new Float64Array(n);
    fft(re, im);
    for (let k = 0; k < n; k++) {
      let sumRe = 0;
      let sumIm = 0;
      for (let t = 0; t < n; t++) {
        sumRe += input[t]! * Math.cos((-2 * Math.PI * k * t) / n);
        sumIm += input[t]! * Math.sin((-2 * Math.PI * k * t) / n);
      }
      expect(re[k]).toBeCloseTo(sumRe, 9);
      expect(im[k]).toBeCloseTo(sumIm, 9);
    }
  });

  it('round-trips through the inverse transform', () => {
    const re = Float64Array.from([1, 2, 3, 4, 0, -1, -2, 5]);
    const im = new Float64Array(8);
    const original = Array.from(re);
    fft(re, im);
    fft(re, im, true);
    original.forEach((value, index) => expect(re[index]).toBeCloseTo(value, 12));
  });

  it('rejects lengths that are not a power of two', () => {
    expect(() => fft(new Float64Array(6), new Float64Array(6))).toThrow('power of two');
    expect(nextPowerOfTwo(1000)).toBe(1024);
  });
});

describe('findAudioOffset', () => {
  const rate = 8000;

  it('finds a known offset to within a millisecond, through noise and a different level', () => {
    const world = speechLike(40, rate, 42);
    const lagSeconds = 3.2375;
    const lagSamples = Math.round(lagSeconds * rate);
    const referenceLength = 20 * rate;
    const reference = world.slice(10 * rate, 10 * rate + referenceLength);
    // Екінші камера: сол дыбыс, басқа деңгей және өз шуы бар
    const noise = seededRandom(99);
    const target = new Float32Array(30 * rate);
    for (let i = 0; i < target.length; i++) {
      const source = 10 * rate - lagSamples + i;
      target[i] = (source >= 0 && source < world.length ? world[source]! * 0.4 : 0) + (noise() * 2 - 1) * 0.05;
    }

    const peak = findAudioOffset(reference, target, rate, 0, (target.length - reference.length) / rate);

    expect(Math.abs(peak.lagSeconds - lagSeconds)).toBeLessThan(0.001);
    expect(peak.confidence).toBeGreaterThan(4);
  });

  it('reports low confidence for two unrelated recordings', () => {
    const reference = speechLike(10, rate, 1);
    const target = speechLike(14, rate, 2);
    const peak = findAudioOffset(reference, target, rate, 0, 4);
    expect(peak.confidence).toBeLessThan(2);
  });
});

describe('summarizeOffsets', () => {
  it('reports mean, drift (max − min) and drift per hour', () => {
    const summary = summarizeOffsets(
      [
        { timelineSeconds: 0, offsetSeconds: 5.13, confidence: 6 },
        { timelineSeconds: 1800, offsetSeconds: 5.14, confidence: 5 },
        { timelineSeconds: 3600, offsetSeconds: 5.15, confidence: 7 },
      ],
      { minConfidence: 2.5, maxDriftSeconds: 0.04 },
    );
    expect(summary.meanOffsetSeconds).toBeCloseTo(5.14, 10);
    expect(summary.driftSeconds).toBeCloseTo(0.02, 10);
    expect(summary.driftPerHourSeconds).toBeCloseTo(0.02, 10);
    expect(summary.confidenceLevel).toBe('high');
    expect(summary.reliable).toBe(true);
  });

  it('is not reliable when drift or confidence is out of bounds', () => {
    const drifting = summarizeOffsets(
      [
        { timelineSeconds: 0, offsetSeconds: 5.1, confidence: 6 },
        { timelineSeconds: 600, offsetSeconds: 5.2, confidence: 6 },
      ],
      { minConfidence: 2.5, maxDriftSeconds: 0.04 },
    );
    expect(drifting.reliable).toBe(false);
    expect(drifting.reasons[0]).toContain('the offset changes by 0.1s');

    const unsure = summarizeOffsets([{ timelineSeconds: 0, offsetSeconds: 5.1, confidence: 1.4 }], { minConfidence: 2.5, maxDriftSeconds: 0.04 });
    expect(unsure.confidenceLevel).toBe('low');
    expect(unsure.reliable).toBe(false);
  });
});

describe('decodeAudioWindow', () => {
  it('throws FfmpegNotFoundError when the ffmpeg binary does not exist', async () => {
    await expect(decodeAudioWindow('any.mp4', 0, 1, 8000, 'falconcut-no-such-ffmpeg-binary')).rejects.toBeInstanceOf(FfmpegNotFoundError);
  });
});
