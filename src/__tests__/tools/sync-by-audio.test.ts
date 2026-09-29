/**
 * FalconCut: sync_by_audio — синтетикалық екі камерада, белгілі ығысумен.
 *
 * «Әлем» дыбысы бір: S камерасының файлындағы t уақыты әлемнің t-сына, ал D
 * камерасының файлындағы t уақыты әлемнің t + 5,13-іне сәйкес (кешегі нақты жобадағыдай).
 * Premiere жалған bridge, дыбыс жалған декодер арқылы беріледі.
 */

import { syncByAudio, type AudioDecoder } from '../../tools/domains/sync.js';
import { PremiereProTools } from '../../tools/index.js';

const TRUE_OFFSET = 5.13;

/** Қайталанбайтын жалған кездейсоқ мән (бүтін индекс бойынша). */
function hashNoise(index: number): number {
  const x = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/**
 * Кез келген жиілікте бірдей оқылатын «әлем» дыбысы: 1 кГц-тегі шу нүктелерінің арасы
 * сызықтық толтырылады, қаттылығы сөйлеудегідей баяу өзгереді. Қайталанбайды —
 * сондықтан корреляцияда жалғыз айқын шың болады (синустар қосындысында олай емес).
 */
function worldSample(time: number): number {
  const position = time * 1000;
  const index = Math.floor(position);
  const fraction = position - index;
  const value = hashNoise(index) * (1 - fraction) + hashNoise(index + 1) * fraction;
  return value * (0.3 + 0.7 * Math.abs(Math.sin(time * 1.3)));
}

/**
 * Файлдағы уақыт → әлем уақыты. D камерасының сағаты clockError-ге жылдамырақ жүруі мүмкін (дрейф).
 * unrelated=true болса, D мүлде басқа дыбыс жазған.
 */
function decoder(options: { clockError?: number; unrelated?: boolean } = {}): AudioDecoder & { calls: number } {
  const decode = (async (mediaPath: string, start: number, duration: number, rate: number) => {
    decode.calls += 1;
    const out = new Float32Array(Math.round(duration * rate));
    const isTarget = mediaPath.includes('D0678');
    for (let i = 0; i < out.length; i++) {
      const fileTime = start + i / rate;
      if (!isTarget) out[i] = worldSample(fileTime);
      else if (options.unrelated) out[i] = worldSample(fileTime * 1.7 + 1000);
      else out[i] = 0.5 * worldSample(fileTime * (1 + (options.clockError ?? 0)) + TRUE_OFFSET);
    }
    return out;
  }) as AudioDecoder & { calls: number };
  decode.calls = 0;
  return decode;
}

/** Premiere орнына: клиптерді сипаттайды, move_clip-ті жазып алады. */
function fakeContext(moveResult: any = { success: true, clips: [] }) {
  const scripts: string[] = [];
  const bridge = {
    executeScript: jest.fn(async (script: string) => {
      scripts.push(script);
      if (script.includes('describeForSync')) {
        return {
          success: true,
          sequenceId: 'seq-1',
          sequenceName: 'S0678',
          frameSeconds: 0.04,
          reference: { clipId: 'a1', name: 'S0678.MP4', trackType: 'audio', trackIndex: 0, start: 0, end: 600, inPoint: 0, outPoint: 600, mediaPath: 'D:/S0678.MP4' },
          target: { clipId: 'a2', name: 'D0678.MP4', trackType: 'audio', trackIndex: 1, start: 15.6, end: 615.6, inPoint: 0, outPoint: 600, mediaPath: 'D:/D0678.MP4' },
        };
      }
      return moveResult;
    }),
  };
  const ctx = { bridge, logger: console, listTools: () => [], listAdvertisedTools: () => [] } as any;
  return { ctx, scripts };
}

const base = { referenceClipId: 'a1', targetClipId: 'a2', windowSeconds: 10, analysisPoints: 3, maxShiftSeconds: 15 };

describe('sync_by_audio', () => {
  it('measures the offset at every point and changes nothing with apply=false', async () => {
    const { ctx, scripts } = fakeContext();
    const result: any = await syncByAudio(ctx, { ...base }, decoder());

    expect(result.success).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.points).toHaveLength(3);
    for (const point of result.points) expect(Math.abs(point.offsetSeconds - TRUE_OFFSET)).toBeLessThan(0.002);
    expect(Math.abs(result.meanOffsetSeconds - TRUE_OFFSET)).toBeLessThan(0.002);
    expect(result.driftSeconds).toBeLessThan(0.002);
    expect(result.reliable).toBe(true);
    expect(result.suggestedTargetStart).toBeCloseTo(5.12, 6);
    expect(result.shiftFrames).toBe(-262);
    // Тек клиптерді оқитын бір скрипт — жылжыту жоқ
    expect(scripts).toHaveLength(1);
  });

  it('moves the target with its linked parts when apply=true, then reports the read-back', async () => {
    const { ctx, scripts } = fakeContext({ success: true, clips: [{ track: 'V2', ok: true }, { track: 'A2', ok: true }] });
    const result: any = await syncByAudio(ctx, { ...base, apply: true }, decoder());

    expect(result.success).toBe(true);
    expect(result.applied).toBe(true);
    expect(result.status).toBe('synced');
    expect(scripts).toHaveLength(2);
    const moveScript = scripts[1]!;
    expect(moveScript).toContain('__findClip("a2")');
    expect(moveScript).toContain('var shiftAmount = 5.12 - oldTime;');
    expect(moveScript).toContain('var withLinked = true;');
    expect(result.move.clips).toHaveLength(2);
  });

  it('refuses to move when the offset drifts between points', async () => {
    const { ctx, scripts } = fakeContext();
    // D камерасының сағаты 0,02 %-ға жылдам: 10 минутта ~0,1 с дрейф
    const result: any = await syncByAudio(ctx, { ...base, apply: true, maxShiftSeconds: 15 }, decoder({ clockError: 0.0002 }));

    expect(result.success).toBe(false);
    expect(result.applied).toBe(false);
    expect(result.status).toBe('not_applied');
    expect(result.driftSeconds).toBeGreaterThan(0.04);
    expect(result.warning).toContain('the offset changes by');
    expect(scripts).toHaveLength(1);
  });

  it('refuses to move when the two recordings do not match', async () => {
    const { ctx, scripts } = fakeContext();
    const result: any = await syncByAudio(ctx, { ...base, apply: true }, decoder({ unrelated: true }));

    expect(result.success).toBe(false);
    expect(result.status).toBe('not_applied');
    expect(result.confidenceLevel).toBe('low');
    expect(scripts).toHaveLength(1);
  });

  it('returns a clear Kazakh error when ffmpeg is missing', async () => {
    const previous = { ffmpeg: process.env.FALCONCUT_FFMPEG, lang: process.env.FALCONCUT_LANG };
    process.env.FALCONCUT_FFMPEG = 'falconcut-no-such-ffmpeg-binary';
    process.env.FALCONCUT_LANG = 'kk';
    try {
      const { ctx } = fakeContext();
      const result: any = await syncByAudio(ctx, { ...base });
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('FFMPEG_NOT_FOUND');
      expect(result.error).toContain('ffmpeg табылмады');
      expect(result.error).toContain(result.installHint);
    } finally {
      if (previous.ffmpeg === undefined) delete process.env.FALCONCUT_FFMPEG; else process.env.FALCONCUT_FFMPEG = previous.ffmpeg;
      if (previous.lang === undefined) delete process.env.FALCONCUT_LANG; else process.env.FALCONCUT_LANG = previous.lang;
    }
  });

  it('is in the catalog, found by search, and needs a reference and a target', async () => {
    const tools = new PremiereProTools({ executeScript: jest.fn() } as any);
    const search: any = await tools.executeTool('search_tools', { query: 'synchronize two cameras by audio' });
    expect(search.matches[0].name).toBe('sync_by_audio');
    const invalid: any = await tools.executeTool('sync_by_audio', { referenceClipId: 'a1' });
    expect(invalid.success).toBe(false);
  });
});
