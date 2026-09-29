/**
 * FalconCut: withLinked — байланған дыбыс/суретті бірге жылжыту, өшіру, қию.
 *
 * Скрипттер жалған Premiere DOM ішінде шынымен орындалады (vm): тректер, клиптер,
 * getLinkedItems(), move(), remove() және Time. Сондықтан тест скрипт мәтінін емес,
 * оның нәтижесін тексереді: екі бөлік те жылжыды ма, біреуі қалып қойса не болады.
 */

import vm from 'vm';
import { parse } from 'acorn';
import { PremiereProBridge } from '../../bridge/index.js';
import { PremiereProTools } from '../../tools/index.js';

const TICKS = 254016000000;

class FakeTime {
  seconds = 0;
  constructor(seconds = 0) { this.seconds = seconds; }
  get ticks(): string { return String(Math.round(this.seconds * TICKS)); }
  set ticks(value: string) { this.seconds = Number(value) / TICKS; }
}

interface ClipOptions {
  id: string;
  name?: string;
  start: number;
  end: number;
  inPoint?: number;
  source?: string;
  /** move() does nothing, as on a locked track. */
  stuck?: boolean;
  /** remove() does nothing. */
  undeletable?: boolean;
}

class FakeTrack {
  items: FakeClip[] = [];
  host!: FakeHost;
  constructor(public type: 'video' | 'audio') {}

  /**
   * Premiere lays the whole source down; on a video track it also drops the
   * source's audio onto an audio track (the stray copy the park sweep must remove).
   */
  overwriteClip(projectItem: { nodeId: string }, time: number): void {
    const host = this.host;
    const id = `placed-${++host.placedCount}`;
    const clip = new FakeClip(this, { id, start: Number(time), end: Number(time) + host.sourceSeconds, source: projectItem.nodeId }, host);
    this.items.push(clip);
    if (this.type === 'video' && host.autoPlaceAudio) {
      const stray = new FakeClip(host.audio[2]!, { id: `${id}-audio`, start: Number(time), end: Number(time) + host.sourceSeconds, source: projectItem.nodeId }, host);
      host.audio[2]!.items.push(stray);
    }
  }
  get clips(): Record<string | number, unknown> {
    const collection: Record<string | number, unknown> = { numItems: this.items.length };
    this.items.forEach((clip, index) => { collection[index] = clip; });
    return collection;
  }
}

class FakeClip {
  nodeId: string;
  name: string;
  projectItem: { nodeId: string };
  linkGroup: FakeClip[] = [this];
  private startS: number;
  private endS: number;
  private inS: number;
  private outS: number;

  constructor(public track: FakeTrack, private options: ClipOptions, private host: FakeHost) {
    this.nodeId = options.id;
    this.name = options.name ?? `${options.source ?? 'MEDIA'}.MP4`;
    this.projectItem = { nodeId: options.source ?? 'item-1' };
    this.startS = options.start;
    this.endS = options.end;
    this.inS = options.inPoint ?? 0;
    this.outS = this.inS + (options.end - options.start);
  }

  get start(): FakeTime { return new FakeTime(this.startS); }
  get end(): FakeTime { return new FakeTime(this.endS); }
  set end(value: FakeTime) { this.endS = value.seconds; this.outS = this.inS + (this.endS - this.startS); }
  get duration(): FakeTime { return new FakeTime(this.endS - this.startS); }
  get inPoint(): FakeTime { return new FakeTime(this.inS); }
  set inPoint(value: FakeTime) { this.inS = value.seconds; this.endS = this.startS + (this.outS - this.inS); }
  get outPoint(): FakeTime { return new FakeTime(this.outS); }
  set outPoint(value: FakeTime) { this.outS = value.seconds; this.endS = this.startS + (this.outS - this.inS); }

  move(shift: number): void {
    if (this.options.stuck) return;
    const amount = Number(shift);
    const group = this.host.hostDragsLinked ? this.linkGroup : [this];
    for (const clip of group) { clip.startS += amount; clip.endS += amount; }
  }

  remove(ripple: boolean): void {
    if (this.options.undeletable) return;
    const index = this.track.items.indexOf(this);
    if (index === -1) return;
    this.track.items.splice(index, 1);
    if (ripple) {
      const gap = this.endS - this.startS;
      for (const other of this.track.items) {
        if (other.startS >= this.endS) { other.startS -= gap; other.endS -= gap; }
      }
    }
  }

  getLinkedItems(): Record<string | number, unknown> {
    if (!this.host.hasGetLinkedItems) throw new TypeError('getLinkedItems is not a function');
    const collection: Record<string | number, unknown> = { numItems: this.linkGroup.length };
    this.linkGroup.forEach((clip, index) => { collection[index] = clip; });
    return collection;
  }

  setSelected(): void {}
}

class FakeHost {
  hostDragsLinked = false;
  hasGetLinkedItems = true;
  autoPlaceAudio = false;
  placedCount = 0;
  sourceSeconds = 100;
  video = [new FakeTrack('video'), new FakeTrack('video'), new FakeTrack('video')];
  audio = [new FakeTrack('audio'), new FakeTrack('audio'), new FakeTrack('audio')];

  constructor() {
    for (const track of [...this.video, ...this.audio]) track.host = this;
  }
  sequence = {
    sequenceID: 'seq-1',
    name: 'S0678',
    timebase: String(TICKS / 25),
    videoTracks: this.trackCollection(this.video),
    audioTracks: this.trackCollection(this.audio),
  };

  private trackCollection(tracks: FakeTrack[]): Record<string | number, unknown> {
    const collection: Record<string | number, unknown> = { numTracks: tracks.length };
    tracks.forEach((track, index) => { collection[index] = track; });
    return collection;
  }

  add(type: 'video' | 'audio', trackIndex: number, options: ClipOptions): FakeClip {
    const track = (type === 'video' ? this.video : this.audio)[trackIndex]!;
    const clip = new FakeClip(track, options, this);
    track.items.push(clip);
    return clip;
  }

  link(...clips: FakeClip[]): void {
    for (const clip of clips) clip.linkGroup = clips;
  }

  find(id: string): FakeClip | undefined {
    return [...this.video, ...this.audio].flatMap((track) => track.items).find((clip) => clip.nodeId === id);
  }

  /** A bridge whose executeScript runs the real prelude + script against this fake host. */
  bridge(scripts: string[] = []): { executeScript: (script: string) => Promise<any> } {
    const wrapper = new PremiereProBridge() as unknown as { buildExecutableScript(script: string): string };
    return {
      executeScript: async (script: string) => {
        scripts.push(script);
        const app = {
          project: { activeSequence: this.sequence, sequences: { numSequences: 1, 0: this.sequence } },
          enableQE: () => {},
        };
        const context = vm.createContext({ app, Time: FakeTime });
        const output = vm.runInContext(wrapper.buildExecutableScript(script), context);
        return JSON.parse(String(output));
      },
    };
  }
}

/** D камерасы: V2 видео мен A2 дыбысы, 15,6 с-та, өзара байланған. */
function twoCameraHost(): { host: FakeHost; video: FakeClip; audio: FakeClip } {
  const host = new FakeHost();
  host.add('video', 0, { id: 'v1', start: 0, end: 60, source: 'S0678' });
  host.add('audio', 0, { id: 'a1', start: 0, end: 60, source: 'S0678' });
  const video = host.add('video', 1, { id: 'v2', start: 15.6, end: 75.6, source: 'D0678' });
  const audio = host.add('audio', 1, { id: 'a2', start: 15.6, end: 75.6, source: 'D0678' });
  host.link(video, audio);
  return { host, video, audio };
}

describe('withLinked: generated ExtendScript', () => {
  it('parses as ES3 for every linked-aware tool, with withLinked true and false', async () => {
    const scripts: string[] = [];
    const { host } = twoCameraHost();
    const tools = new PremiereProTools(host.bridge(scripts) as never);
    for (const withLinked of [true, false]) {
      await tools.executeTool('move_clip', { clipId: 'v2', newTime: 20, withLinked });
      await tools.executeTool('trim_clip', { clipId: 'v1', inPoint: 1, withLinked });
      await tools.executeTool('remove_from_timeline', { clipId: 'v1', deleteMode: 'lift', withLinked });
      await tools.executeTool('ripple_delete', { clipId: 'v2', withLinked });
    }
    await tools.executeTool('move_clip_to_track', { clipId: 'a1', trackIndex: 2 });
    expect(scripts.length).toBeGreaterThan(8);
    for (const script of scripts) {
      expect(() => parse(script, { ecmaVersion: 3, allowReturnOutsideFunction: true })).not.toThrow();
    }
  });
});

describe('move_clip withLinked', () => {
  it('moves the linked audio with the video by default and reads both back', async () => {
    const { host, video, audio } = twoCameraHost();
    const tools = new PremiereProTools(host.bridge() as never);

    const result: any = await tools.executeTool('move_clip', { clipId: 'v2', newTime: 5.12 });

    expect(result.success).toBe(true);
    expect(result.linkedCount).toBe(1);
    expect(video.start.seconds).toBeCloseTo(5.12);
    expect(audio.start.seconds).toBeCloseTo(5.12);
    expect(result.clips.map((clip: any) => [clip.track, clip.after.start, clip.after.end, clip.ok])).toEqual([
      ['V2', expect.closeTo(5.12, 6), expect.closeTo(65.12, 6), true],
      ['A2', expect.closeTo(5.12, 6), expect.closeTo(65.12, 6), true],
    ]);
  });

  it('does not move the audio twice when the host already drags linked items', async () => {
    const { host, audio } = twoCameraHost();
    host.hostDragsLinked = true;
    const result: any = await new PremiereProTools(host.bridge() as never).executeTool('move_clip', { clipId: 'v2', newTime: 5.12 });
    expect(result.success).toBe(true);
    expect(audio.start.seconds).toBeCloseTo(5.12);
  });

  it('moves only the video with withLinked:false and says the audio was left behind', async () => {
    const { host, video, audio } = twoCameraHost();
    const result: any = await new PremiereProTools(host.bridge() as never).executeTool('move_clip', { clipId: 'v2', newTime: 5.12, withLinked: false });
    expect(result.success).toBe(true);
    expect(video.start.seconds).toBeCloseTo(5.12);
    expect(audio.start.seconds).toBeCloseTo(15.6);
    expect(result.warning).toContain('left in place on purpose');
  });

  it('reports failure, not success, when a linked part stays behind', async () => {
    const host = new FakeHost();
    const video = host.add('video', 1, { id: 'v2', start: 15.6, end: 75.6, source: 'D0678' });
    const audio = host.add('audio', 1, { id: 'a2', start: 15.6, end: 75.6, source: 'D0678', stuck: true });
    host.link(video, audio);

    const result: any = await new PremiereProTools(host.bridge() as never).executeTool('move_clip', { clipId: 'v2', newTime: 5.12 });

    expect(result.success).toBe(false);
    expect(result.status).toBe('linked_partial');
    expect(result.warning).toContain('A2 D0678.MP4 is at 15.6s (expected 5.12');
    expect(result.clips.find((clip: any) => clip.track === 'A2').ok).toBe(false);
  });

  it('moves an unlinked clip alone and still verifies it', async () => {
    const host = new FakeHost();
    const lone = host.add('video', 0, { id: 'solo', start: 10, end: 20 });
    const result: any = await new PremiereProTools(host.bridge() as never).executeTool('move_clip', { clipId: 'solo', newTime: 2 });
    expect(result.success).toBe(true);
    expect(result.linkedCount).toBe(0);
    expect(result.clips).toHaveLength(1);
    expect(lone.start.seconds).toBeCloseTo(2);
  });

  it('finds the partner by source and span on hosts without getLinkedItems', async () => {
    const { host, audio } = twoCameraHost();
    host.hasGetLinkedItems = false;
    const result: any = await new PremiereProTools(host.bridge() as never).executeTool('move_clip', { clipId: 'v2', newTime: 5.12 });
    expect(result.success).toBe(true);
    expect(result.linkedMethod).toBe('sameSourceAndSpan');
    expect(audio.start.seconds).toBeCloseTo(5.12);
  });
});

describe('remove_from_timeline and ripple_delete withLinked', () => {
  it('removes the linked audio too and confirms nothing is left', async () => {
    const { host } = twoCameraHost();
    const result: any = await new PremiereProTools(host.bridge() as never).executeTool('remove_from_timeline', { clipId: 'v2', deleteMode: 'lift' });
    expect(result.success).toBe(true);
    expect(result.linkedCount).toBe(1);
    expect(host.find('v2')).toBeUndefined();
    expect(host.find('a2')).toBeUndefined();
  });

  it('keeps the audio with withLinked:false and warns about it', async () => {
    const { host } = twoCameraHost();
    const result: any = await new PremiereProTools(host.bridge() as never).executeTool('remove_from_timeline', { clipId: 'v2', deleteMode: 'lift', withLinked: false });
    expect(result.success).toBe(true);
    expect(host.find('a2')).toBeDefined();
    expect(result.warning).toContain('left on the timeline on purpose');
  });

  it('reports a part that could not be removed', async () => {
    const host = new FakeHost();
    const video = host.add('video', 1, { id: 'v2', start: 0, end: 10 });
    const audio = host.add('audio', 1, { id: 'a2', start: 0, end: 10, undeletable: true });
    host.link(video, audio);
    const result: any = await new PremiereProTools(host.bridge() as never).executeTool('remove_from_timeline', { clipId: 'v2', deleteMode: 'lift' });
    expect(result.success).toBe(false);
    expect(result.status).toBe('linked_partial');
    expect(result.leftovers).toEqual(['A2 MEDIA.MP4']);
  });

  it('ripple_delete closes the gap on both linked tracks', async () => {
    const { host } = twoCameraHost();
    const laterVideo = host.add('video', 1, { id: 'v2b', start: 80, end: 90, source: 'D0678' });
    const laterAudio = host.add('audio', 1, { id: 'a2b', start: 80, end: 90, source: 'D0678' });
    host.link(laterVideo, laterAudio);

    const result: any = await new PremiereProTools(host.bridge() as never).executeTool('ripple_delete', { clipId: 'v2' });

    expect(result.success).toBe(true);
    expect(result.data.linkedCount).toBe(1);
    expect(host.find('a2')).toBeUndefined();
    expect(laterVideo.start.seconds).toBeCloseTo(20);
    expect(laterAudio.start.seconds).toBeCloseTo(20);
  });
});

describe('trim_clip withLinked', () => {
  it('trims the linked audio by the same amount', async () => {
    const { host, video, audio } = twoCameraHost();
    const result: any = await new PremiereProTools(host.bridge() as never).executeTool('trim_clip', { clipId: 'v2', inPoint: 2 });
    expect(result.success).toBe(true);
    expect(result.linkedCount).toBe(1);
    expect(video.inPoint.seconds).toBeCloseTo(2);
    expect(audio.inPoint.seconds).toBeCloseTo(2);
    expect(audio.end.seconds).toBeCloseTo(video.end.seconds);
  });

  it('applies the delta, not the absolute value, to separately recorded audio', async () => {
    const host = new FakeHost();
    const video = host.add('video', 0, { id: 'v', start: 0, end: 30, inPoint: 0, source: 'cam' });
    const audio = host.add('audio', 0, { id: 'a', start: 0, end: 30, inPoint: 7.5, source: 'cam' });
    host.link(video, audio);
    const result: any = await new PremiereProTools(host.bridge() as never).executeTool('trim_clip', { clipId: 'v', inPoint: 1 });
    expect(result.success).toBe(true);
    expect(audio.inPoint.seconds).toBeCloseTo(8.5);
  });

  it('leaves the audio alone with withLinked:false', async () => {
    const { host, audio } = twoCameraHost();
    await new PremiereProTools(host.bridge() as never).executeTool('trim_clip', { clipId: 'v2', inPoint: 2, withLinked: false });
    expect(audio.inPoint.seconds).toBeCloseTo(0);
  });
});

describe('move_clip_to_track withLinked', () => {
  it('moves video and linked audio to the matching tracks, re-links them and sweeps stray copies', async () => {
    const host = new FakeHost();
    host.autoPlaceAudio = true;
    const video = host.add('video', 0, { id: 'v1', start: 10, end: 20, inPoint: 5, source: 'cam' });
    const audio = host.add('audio', 0, { id: 'a1', start: 10, end: 20, inPoint: 5, source: 'cam' });
    host.link(video, audio);

    const result: any = await new PremiereProTools(host.bridge() as never).executeTool('move_clip_to_track', { clipId: 'v1', trackIndex: 1 });

    expect(result.success).toBe(true);
    expect(result.data.linkedCount).toBe(1);
    expect(result.data.clips.map((clip: any) => [clip.track, clip.start, clip.end, clip.ok])).toEqual([
      ['V2', 10, 20, true],
      ['A2', 10, 20, true],
    ]);
    // Originals are gone from V1/A1 and nothing was left in the park zone on any track.
    expect(host.video[0]!.items).toHaveLength(0);
    expect(host.audio[0]!.items).toHaveLength(0);
    expect(host.audio[2]!.items).toHaveLength(0);
    expect(host.video[1]!.items[0]!.inPoint.seconds).toBeCloseTo(5);
  });

  it('changes nothing when the linked audio has no track to go to', async () => {
    const host = new FakeHost();
    const video = host.add('video', 1, { id: 'v2', start: 0, end: 10 });
    const audio = host.add('audio', 2, { id: 'a3', start: 0, end: 10 });
    host.link(video, audio);

    const result: any = await new PremiereProTools(host.bridge() as never).executeTool('move_clip_to_track', { clipId: 'v2', trackIndex: 2 });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('LINKED_TARGET_UNAVAILABLE');
    expect(result.error).toContain('A4, which does not exist');
    expect(video.track.type).toBe('video');
    expect(host.video[1]!.items).toContain(video);
    expect(host.audio[2]!.items).toContain(audio);
  });

  it('changes nothing when the linked audio destination is occupied', async () => {
    const host = new FakeHost();
    const video = host.add('video', 0, { id: 'v1', start: 0, end: 10 });
    const audio = host.add('audio', 0, { id: 'a1', start: 0, end: 10 });
    host.add('audio', 1, { id: 'music', name: 'music.wav', start: 5, end: 15 });
    host.link(video, audio);

    const result: any = await new PremiereProTools(host.bridge() as never).executeTool('move_clip_to_track', { clipId: 'v1', trackIndex: 1 });

    expect(result.success).toBe(false);
    expect(result.error).toContain('A2 is occupied by music.wav');
    expect(host.video[0]!.items).toContain(video);
  });
});
