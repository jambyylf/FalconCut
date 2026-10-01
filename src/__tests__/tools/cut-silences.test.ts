/**
 * FalconCut: cut_silences — жалған Premiere-де толық жол: оқу → жоспар → көшірме →
 * кесу → барлық тректі бірге жылжыту → қайта оқып салыстыру.
 *
 * Оқу мен кесу скрипттері жалған DOM ішінде шынымен орындалады (vm). Көшірме жасау мен
 * razor (QE) скрипттерін жалған хост өзі орындайды: олардың өз тесттері бар.
 */

import { parse } from 'acorn';
import { cutSilences, type SilenceDetector } from '../../tools/domains/silence.js';
import { rangeCutScript } from '../../tools/range-cut.js';
import { FakeHost } from '../helpers/fake-timeline.js';

/** Бастапқы файлдағы үзілістер (файл уақытымен): таймлайнда 4–6, 10,5–11,5 және 19,4–20 с. */
function detector(pauses: Record<string, Array<[number, number]>> = { 'E:/talk.MP4': [[104, 106], [110.5, 111.5], [119.4, 125]] }) {
  const calls: Array<[string, number, number, number, number]> = [];
  const detect: SilenceDetector = async (mediaPath, start, duration, thresholdDb, minSilence) => {
    calls.push([mediaPath, start, duration, thresholdDb, minSilence]);
    return (pauses[mediaPath] ?? [])
      .map(([a, b]) => [Math.max(a, start) - start, Math.min(b, start + duration) - start] as [number, number])
      .filter(([a, b]) => b > a);
  };
  return { detect, calls };
}

const EXPECTED_CUTS = [
  { start: 4.16, end: 5.84, duration: 1.68 },
  { start: 10.68, end: 11.32, duration: 0.64 },
  { start: 19.56, end: 20, duration: 0.44 },
];

describe('cut_silences: plan only (apply=false)', () => {
  it('reports the cuts from the A1 pauses and changes nothing', async () => {
    const { host, original } = FakeHost.talk();
    const before = original.layout();
    const { detect, calls } = detector();

    const result = await cutSilences(host.context(), {}, detect);

    expect(result).toMatchObject({
      success: true,
      applied: false,
      status: 'planned',
      analysedTrack: 'A1',
      pausesFound: 3,
      cuts: EXPECTED_CUTS,
      cutCount: 3,
      removedSeconds: 2.76,
      originalDuration: 20,
      newDuration: 17.24,
    });
    // Дыбыс клиптің қолданылған бөлігінен ғана оқылады: файлдың 100-120 с аралығы
    expect(calls).toEqual([['E:/talk.MP4', 100, 20, -35, 0.5]]);
    expect(host.sequences).toHaveLength(1);
    expect(host.razorTimes).toEqual([]);
    expect(original.layout()).toEqual(before);
  });
});

describe('cut_silences: apply', () => {
  it('cuts a duplicate on every track, keeps them in sync and leaves the original untouched', async () => {
    const { host, original } = FakeHost.talk();
    const before = original.layout();

    const result = await cutSilences(host.context(), { apply: true, newSequenceName: 'Talk test' }, detector().detect);

    expect(result).toMatchObject({ success: true, applied: true, status: 'cut', newSequenceName: 'Talk test', newDuration: 17.24 });
    expect(result.verification).toMatchObject({ ok: true, mismatches: [] });
    expect(original.layout()).toEqual(before);
    // Секвенцияның соңы (20) кесілмейді — ол жай ғана алынады
    expect(host.razorTimes).toEqual([19.56, 11.32, 10.68, 5.84, 4.16]);

    const copy = host.find(result.targetSequenceId);
    expect(copy.name).toBe('Talk test');
    expect(copy.layout()).toEqual([
      'V1 talk 0.00-4.16 in 100.00',
      'V1 talk 4.16-9.00 in 105.84',
      'V1 talk 9.00-17.24 in 111.32',
      // Титрдің астында кесінді жоқ, бірақ ол сөзбен бірге жылжиды
      'V2 title 9.68-15.68 in 0.00',
      'A1 talk 0.00-4.16 in 100.00',
      'A1 talk 4.16-9.00 in 105.84',
      'A1 talk 9.00-17.24 in 111.32',
      'A2 music 0.00-4.16 in 0.00',
      'A2 music 4.16-9.00 in 5.84',
      'A2 music 9.00-17.24 in 11.32',
    ]);
  });

  it('names the duplicate in Kazakh by default', async () => {
    const previous = process.env.FALCONCUT_LANG;
    process.env.FALCONCUT_LANG = 'kk';
    try {
      const { host } = FakeHost.talk();
      const result = await cutSilences(host.context(), { apply: true }, detector().detect);
      expect(result.success).toBe(true);
      expect(result.newSequenceName).toBe('Talk — үнсіз жерлерсіз');
    } finally {
      if (previous === undefined) delete process.env.FALCONCUT_LANG; else process.env.FALCONCUT_LANG = previous;
    }
  });

  it('cuts the sequence itself with inPlace', async () => {
    const { host, original } = FakeHost.talk();
    const result = await cutSilences(host.context(), { apply: true, inPlace: true }, detector().detect);
    expect(result).toMatchObject({ success: true, status: 'cut', targetSequenceId: 'seq-talk' });
    expect(host.sequences).toHaveLength(1);
    expect(original.layout()[0]).toBe('V1 talk 0.00-4.16 in 100.00');
  });

  it('does not claim success when a clip refuses to move', async () => {
    const { host, original } = FakeHost.talk();
    original.video[1]!.items[0]!.stuck = true;

    const result = await cutSilences(host.context(), { apply: true }, detector().detect);

    expect(result.success).toBe(false);
    expect(result.status).toBe('verification_failed');
    expect(result.error).toMatch(/^The timeline after cutting does not match the expected layout \(V2 piece 1: start 12/);
    expect(result.warning).toContain('the original sequence is unchanged');
  });

  it('stops before changing anything in a range when a track was not cut at its boundary', async () => {
    const { host, original } = FakeHost.talk();
    original.audio[1]!.locked = true;

    const result = await cutSilences(host.context(), { apply: true }, detector().detect);

    expect(result).toMatchObject({ success: false, status: 'cut_failed' });
    expect(result.error).toContain('A2 music');
    const copy = host.find(result.targetSequenceId);
    // Алғашқы өңделетін кесінді (19,56–20) музыканы кесе алмады — ештеңе алынған жоқ, ештеңе жылжымады
    const v1 = copy.layout().filter((line) => line.startsWith('V1'));
    expect(v1).toHaveLength(6);
    expect(v1[5]).toBe('V1 talk 19.56-20.00 in 119.56');
  });
});

describe('cut_silences: errors', () => {
  it('explains in Kazakh when ffmpeg is missing', async () => {
    const previous = { ffmpeg: process.env.FALCONCUT_FFMPEG, lang: process.env.FALCONCUT_LANG };
    process.env.FALCONCUT_FFMPEG = 'falconcut-no-such-ffmpeg-binary';
    process.env.FALCONCUT_LANG = 'kk';
    try {
      const { host } = FakeHost.talk();
      const result = await cutSilences(host.context(), {});
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('FFMPEG_NOT_FOUND');
      expect(result.error).toContain('ffmpeg табылмады');
      expect(result.error).toContain('қайта іске қосыңыз');
    } finally {
      if (previous.ffmpeg === undefined) delete process.env.FALCONCUT_FFMPEG; else process.env.FALCONCUT_FFMPEG = previous.ffmpeg;
      if (previous.lang === undefined) delete process.env.FALCONCUT_LANG; else process.env.FALCONCUT_LANG = previous.lang;
    }
  });

  it('refuses when the analysed track is empty', async () => {
    const { host, original } = FakeHost.talk();
    original.audio[0]!.items = [];
    const result = await cutSilences(host.context(), {}, detector().detect);
    expect(result).toMatchObject({ success: false });
    expect(result.error).toContain('no clips on audio track A1');
  });

  it('generates ES3 ExtendScript', async () => {
    const { host } = FakeHost.talk();
    await cutSilences(host.context(), { apply: true }, detector().detect);
    const scripts = [...host.scripts, rangeCutScript('seq-talk', 4.16, 5.84)];
    expect(scripts.length).toBeGreaterThan(8);
    for (const script of scripts) {
      expect(() => parse(script, { ecmaVersion: 3, allowReturnOutsideFunction: true })).not.toThrow();
    }
  });
});
