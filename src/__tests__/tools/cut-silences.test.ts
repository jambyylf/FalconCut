/**
 * FalconCut: cut_silences — жалған Premiere-де толық жол: оқу → жоспар → көшірме →
 * кесу → барлық тректі бірге жылжыту → қайта оқып салыстыру.
 *
 * Оқу мен кесу скрипттері жалған DOM ішінде шынымен орындалады (vm). Көшірме жасау мен
 * razor (QE) скрипттерін жалған хост өзі орындайды: олардың өз тесттері бар.
 */

import vm from 'vm';
import { parse } from 'acorn';
import { PremiereProBridge } from '../../bridge/index.js';
import { cutSilences, rangeCutScript, type SilenceDetector } from '../../tools/domains/silence.js';
import type { ToolContext } from '../../tools/context.js';

const TICKS = 254016000000;

class FakeTime {
  seconds = 0;
  constructor(seconds = 0) { this.seconds = seconds; }
  get ticks(): string { return String(Math.round(this.seconds * TICKS)); }
}

let clipCounter = 0;

class FakeClip {
  nodeId: string;
  projectItem: { getMediaPath: () => string };
  constructor(
    public track: FakeTrack,
    public name: string,
    public startS: number,
    public endS: number,
    public inS: number,
    public mediaPath: string,
    /** move() does nothing, as on a locked track. */
    public stuck = false,
  ) {
    this.nodeId = `clip-${++clipCounter}`;
    this.projectItem = { getMediaPath: () => this.mediaPath };
  }
  get start(): FakeTime { return new FakeTime(this.startS); }
  get end(): FakeTime { return new FakeTime(this.endS); }
  get inPoint(): FakeTime { return new FakeTime(this.inS); }
  get outPoint(): FakeTime { return new FakeTime(this.inS + (this.endS - this.startS)); }
  move(shift: number): void {
    if (this.stuck) return;
    this.startS += Number(shift);
    this.endS += Number(shift);
  }
  remove(ripple: boolean): void {
    if (ripple) throw new Error('cut_silences must lift, not ripple');
    this.track.items.splice(this.track.items.indexOf(this), 1);
  }
  copyTo(track: FakeTrack): FakeClip {
    return new FakeClip(track, this.name, this.startS, this.endS, this.inS, this.mediaPath, this.stuck);
  }
}

class FakeTrack {
  items: FakeClip[] = [];
  /** Razor skips a locked track. */
  locked = false;
  get clips(): Record<string | number, unknown> {
    const collection: Record<string | number, unknown> = { numItems: this.items.length };
    [...this.items].sort((a, b) => a.startS - b.startS).forEach((clip, index) => { collection[index] = clip; });
    return collection;
  }
  add(name: string, start: number, end: number, inPoint = 0, mediaPath = '', stuck = false): FakeClip {
    const clip = new FakeClip(this, name, start, end, inPoint, mediaPath, stuck);
    this.items.push(clip);
    return clip;
  }
}

class FakeSequence {
  video = [new FakeTrack(), new FakeTrack()];
  audio = [new FakeTrack(), new FakeTrack()];
  timebase = String(TICKS / 25);
  constructor(public sequenceID: string, public name: string) {}
  get videoTracks() { return this.collection(this.video); }
  get audioTracks() { return this.collection(this.audio); }
  private collection(tracks: FakeTrack[]): Record<string | number, unknown> {
    const result: Record<string | number, unknown> = { numTracks: tracks.length };
    tracks.forEach((track, index) => { result[index] = track; });
    return result;
  }
  layout(): string[] {
    const describe = (label: string, track: FakeTrack) => [...track.items]
      .sort((a, b) => a.startS - b.startS)
      .map((clip) => `${label} ${clip.name} ${clip.startS.toFixed(2)}-${clip.endS.toFixed(2)} in ${clip.inS.toFixed(2)}`);
    return [
      ...this.video.flatMap((track, index) => describe(`V${index + 1}`, track)),
      ...this.audio.flatMap((track, index) => describe(`A${index + 1}`, track)),
    ];
  }
}

class FakeHost {
  sequences: FakeSequence[] = [];
  razorTimes: number[] = [];
  scripts: string[] = [];

  /** Сөз (V1/A1), үзілісі жоқ титр (V2) және музыка (A2). */
  static talk(): { host: FakeHost; original: FakeSequence } {
    const host = new FakeHost();
    const original = new FakeSequence('seq-talk', 'Talk');
    original.video[0]!.add('talk', 0, 20, 100, 'E:/talk.MP4');
    original.video[1]!.add('title', 12, 18);
    original.audio[0]!.add('talk', 0, 20, 100, 'E:/talk.MP4');
    original.audio[1]!.add('music', 0, 20, 0, 'E:/music.wav');
    host.sequences.push(original);
    return { host, original };
  }

  find(id: string): FakeSequence {
    const sequence = this.sequences.find((seq) => seq.sequenceID === id);
    if (!sequence) throw new Error(`no sequence ${id}`);
    return sequence;
  }

  private duplicate(id: string, name: string): FakeSequence {
    const source = this.find(id);
    const copy = new FakeSequence(`${id}-copy-${this.sequences.length}`, name);
    source.video.forEach((track, index) => { copy.video[index]!.items = track.items.map((clip) => clip.copyTo(copy.video[index]!)); copy.video[index]!.locked = track.locked; });
    source.audio.forEach((track, index) => { copy.audio[index]!.items = track.items.map((clip) => clip.copyTo(copy.audio[index]!)); copy.audio[index]!.locked = track.locked; });
    this.sequences.push(copy);
    return copy;
  }

  private razor(sequence: FakeSequence, time: number): void {
    this.razorTimes.push(time);
    for (const track of [...sequence.video, ...sequence.audio]) {
      if (track.locked) continue;
      const clip = track.items.find((item) => item.startS < time - 1e-6 && item.endS > time + 1e-6);
      if (!clip) continue;
      const right = new FakeClip(track, clip.name, time, clip.endS, clip.inS + (time - clip.startS), clip.mediaPath, clip.stuck);
      clip.endS = time;
      track.items.push(right);
    }
  }

  context(): ToolContext {
    const wrapper = new PremiereProBridge() as unknown as { buildExecutableScript(script: string): string };
    const executeScript = async (script: string) => {
      this.scripts.push(script);
      const sequenceId = /__findSequence\(("(?:[^"\\]|\\.)*")\)/.exec(script)?.[1];
      if (script.includes('originalSeq.clone()')) {
        const name = JSON.parse(/newSeqObj\.name = ("(?:[^"\\]|\\.)*")/.exec(script)![1]!);
        const copy = this.duplicate(JSON.parse(sequenceId!), name);
        return { success: true, originalSequenceId: JSON.parse(sequenceId!), newSequenceId: copy.sequenceID, newName: name };
      }
      if (script.includes('Unable to activate requested sequence for razor cut')) {
        const time = Number(/Math\.round\(([-0-9.e]+) \* fps\)/.exec(script)![1]);
        this.razor(this.find(JSON.parse(sequenceId!)), time);
        return { success: true };
      }
      const sequences: Record<string | number, unknown> = { numSequences: this.sequences.length };
      this.sequences.forEach((seq, index) => { sequences[index] = seq; });
      const app = { project: { activeSequence: this.sequences[0], sequences }, enableQE: () => {} };
      const vmContext = vm.createContext({ app, Time: FakeTime });
      return JSON.parse(String(vm.runInContext(wrapper.buildExecutableScript(script), vmContext)));
    };
    return { bridge: { executeScript } } as unknown as ToolContext;
  }
}

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
