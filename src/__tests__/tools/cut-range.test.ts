/**
 * FalconCut: cut_range — аралықты барлық тректен бірге кесу (басын, соңын, ортасын).
 * Жалған Premiere-де: сөз (V1/A1), титр (V2) және музыка (A2), 25 fps, 20 с.
 */

import { parse } from 'acorn';
import { cutRange } from '../../tools/domains/range.js';
import { PremiereProTools } from '../../tools/index.js';
import { FakeHost, TICKS } from '../helpers/fake-timeline.js';

describe('cut_range', () => {
  it('cuts the head on every track by timecode, keeping picture, sound, title and music together', async () => {
    const { host, original } = FakeHost.talk();

    const result = await cutRange(host.context(), { start: 0, end: '00:00:04:04' });

    expect(result).toMatchObject({
      success: true,
      status: 'cut',
      sequenceId: 'seq-talk',
      range: { start: 0, end: 4.16, startTimecode: '00:00:00:00', endTimecode: '00:00:04:04', removedSeconds: 4.16 },
      originalDuration: 20,
      newDuration: 15.84,
      verification: { ok: true, mismatches: [] },
    });
    expect(host.razorTimes).toEqual([4.16]);
    expect(original.layout()).toEqual([
      'V1 talk 0.00-15.84 in 104.16',
      'V2 title 7.84-13.84 in 0.00',
      'A1 talk 0.00-15.84 in 104.16',
      'A2 music 0.00-15.84 in 4.16',
    ]);
  });

  it('cuts the tail when end is omitted', async () => {
    const { host, original } = FakeHost.talk();

    const result = await cutRange(host.context(), { start: 15 });

    expect(result).toMatchObject({ success: true, range: { start: 15, end: 20 }, newDuration: 15 });
    expect(original.layout()).toEqual([
      'V1 talk 0.00-15.00 in 100.00',
      'V2 title 12.00-15.00 in 0.00',
      'A1 talk 0.00-15.00 in 100.00',
      'A2 music 0.00-15.00 in 0.00',
    ]);
  });

  it('cuts the middle of a duplicate, snapping to whole frames, and leaves the original untouched', async () => {
    const { host, original } = FakeHost.talk();
    const before = original.layout();

    // 4,17 → 4,16 және 5,85 → 5,84 (ең жақын кадр)
    const result = await cutRange(host.context(), { start: 4.17, end: '5.85', newSequenceName: 'Talk cut' });

    expect(result).toMatchObject({ success: true, sequenceName: 'Talk cut', originalSequenceId: 'seq-talk', range: { start: 4.16, end: 5.84 }, newDuration: 18.32 });
    expect(original.layout()).toEqual(before);
    expect(host.find(result.sequenceId).layout()).toEqual([
      'V1 talk 0.00-4.16 in 100.00',
      'V1 talk 4.16-18.32 in 105.84',
      'V2 title 10.32-16.32 in 0.00',
      'A1 talk 0.00-4.16 in 100.00',
      'A1 talk 4.16-18.32 in 105.84',
      'A2 music 0.00-4.16 in 0.00',
      'A2 music 4.16-18.32 in 5.84',
    ]);
  });

  it('reads a timecode from the sequence start timecode (01:00:00:00)', async () => {
    const { host, original } = FakeHost.talk();
    original.zeroPoint = String(3600 * TICKS);

    const result = await cutRange(host.context(), { start: '01:00:00:00', end: '01:00:04:04' });

    expect(result).toMatchObject({ success: true, range: { start: 0, end: 4.16, startTimecode: '01:00:00:00', endTimecode: '01:00:04:04' } });
  });

  it('refuses ranges that are empty, reversed, past the end or malformed, without touching anything', async () => {
    for (const [args, message] of [
      [{ start: 30 }, /after the end of Talk/],
      [{ start: 5, end: 4 }, /empty or reversed/],
      [{ start: 5, end: 5.01 }, /empty or reversed/],
      [{ start: '00:00:01:30' }, /Invalid timecode/],
    ] as const) {
      const { host, original } = FakeHost.talk();
      const before = original.layout();
      const result = await cutRange(host.context(), args);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(message);
      expect(host.razorTimes).toEqual([]);
      expect(original.layout()).toEqual(before);
    }
  });

  it('stops when a locked track could not be cut at the boundary', async () => {
    const { host, original } = FakeHost.talk();
    original.audio[1]!.locked = true;

    const result = await cutRange(host.context(), { start: 0, end: 4.16 });

    expect(result).toMatchObject({ success: false, status: 'cut_failed' });
    expect(result.error).toContain('A2 music');
    expect(result.warning).toContain('undo in Premiere');
    // Ештеңе алынған жоқ: V1 тек razor-мен екіге бөлінді
    expect(original.layout().filter((line) => line.startsWith('V1'))).toEqual(['V1 talk 0.00-4.16 in 100.00', 'V1 talk 4.16-20.00 in 104.16']);
  });

  it('is registered in the catalog and accepts a timecode string through the schema', async () => {
    const { host, original } = FakeHost.talk();
    const tools = new PremiereProTools(host.context().bridge as never);

    const result: any = await tools.executeTool('cut_range', { start: 0, end: '00:00:04:04' });

    expect(result.success).toBe(true);
    expect(original.layout()[0]).toBe('V1 talk 0.00-15.84 in 104.16');
    for (const script of host.scripts) {
      expect(() => parse(script, { ecmaVersion: 3, allowReturnOutsideFunction: true })).not.toThrow();
    }
  });
});
