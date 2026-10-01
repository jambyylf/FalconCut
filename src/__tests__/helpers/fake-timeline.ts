/**
 * FalconCut: тесттерге арналған жалған Premiere таймлайны (cut_silences, cut_range).
 *
 * Секвенциялар, тректер, клиптер: start/end/inPoint/outPoint, move(), remove() (lift).
 * Оқу мен кесу скрипттері осы DOM ішінде шынымен орындалады (vm). Көшірме жасау мен
 * razor (QE) скрипттерін хост өзі орындайды: олардың өз тесттері бар.
 */

import vm from 'vm';
import { PremiereProBridge } from '../../bridge/index.js';
import type { ToolContext } from '../../tools/context.js';

export const TICKS = 254016000000;

export class FakeTime {
  seconds = 0;
  constructor(seconds = 0) { this.seconds = seconds; }
  get ticks(): string { return String(Math.round(this.seconds * TICKS)); }
}

let clipCounter = 0;

export class FakeClip {
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

export class FakeTrack {
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

export class FakeSequence {
  video = [new FakeTrack(), new FakeTrack()];
  audio = [new FakeTrack(), new FakeTrack()];
  timebase = String(TICKS / 25);
  /** Бастапқы таймкод (ticks), мысалы 01:00:00:00. */
  zeroPoint = '0';
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

export class FakeHost {
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
