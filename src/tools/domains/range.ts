/**
 * FalconCut: аралықты барлық тректен кесу (cut_range).
 *
 * «00:00:22:03-ке дейінгісін кесіп таста» сияқты тапсырма бір командамен орындалады:
 * аралық барлық тректен алынады, артындағының бәрі бірдей шамаға солға жылжиды —
 * камералар, дыбыс, титр, музыка бір-бірінен ажырамайды. Кесуден кейін таймлайн
 * Premiere-ден қайта оқылып тексеріледі.
 */

import { z } from 'zod';
import type { ToolContext, ToolModule } from '../context.js';
import { round } from '../../utils/audio-correlation.js';
import { formatTimecode, parseTimeInput } from '../../utils/timecode.js';
import { duplicateSequence } from './sequence.js';
import { applyRangeCuts, readTimeline, type TimelineSnapshot } from '../range-cut.js';

const timeInput = z.union([z.number().min(0), z.string().min(1)]);

const cutRangeSchema = z.object({
  sequenceId: z.string().optional().describe('Sequence to cut. Defaults to the active sequence.'),
  start: timeInput.describe('Start of the range to remove: seconds on the timeline (22.12) or a timecode as Premiere shows it ("00:00:22:03"). Use 0 to cut the head.'),
  end: timeInput.optional().describe('End of the range to remove, in the same form. Omit it to cut everything from start to the end of the sequence (the tail).'),
  newSequenceName: z.string().optional().describe('Cut a duplicate with this name and leave the original untouched. Omit it to cut the sequence itself.'),
});

export const rangeTools: ToolModule[] = [
  {
    name: 'cut_range',
    description: 'Removes a time range from every track of a sequence at once and closes the gap, so cameras, audio, titles and music stay in sync (for example: cut everything before 00:00:22:03, or cut the tail). Accepts seconds or a timecode, snaps to frames, refuses if a clip on a locked track cannot be cut, and reads the timeline back to verify every remaining piece.',
    inputSchema: cutRangeSchema,
    run: (ctx, args) => cutRange(ctx, args),
  },
];

export async function cutRange(ctx: ToolContext, args: z.infer<typeof cutRangeSchema>): Promise<any> {
  const snapshot = await readTimeline(ctx, args.sequenceId ?? null);
  if (!snapshot.success) return { success: false, error: snapshot.error };
  const frameSeconds = Number(snapshot.frameSeconds) > 0 ? Number(snapshot.frameSeconds) : 1 / 30;
  const zeroPoint = Number(snapshot.zeroPoint) || 0;
  const snap = (time: number) => round(Math.round(time / frameSeconds) * frameSeconds, 6);

  let start: number;
  let end: number;
  try {
    start = snap(parseTimeInput(args.start, frameSeconds, zeroPoint));
    end = args.end === undefined ? round(snapshot.sequenceEnd, 6) : snap(parseTimeInput(args.end, frameSeconds, zeroPoint));
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
  // Секвенцияның соңынан асып кетсе — соңына дейін
  if (end > snapshot.sequenceEnd) end = round(snapshot.sequenceEnd, 6);
  if (start >= snapshot.sequenceEnd) {
    return { success: false, error: `The range starts at ${start}s, after the end of ${snapshot.sequenceName} (${round(snapshot.sequenceEnd, 3)}s). Nothing was cut.` };
  }
  if (end - start < frameSeconds / 2) {
    return { success: false, error: `The range ${start}-${end}s is empty or reversed. Nothing was cut.` };
  }

  const tc = (time: number) => formatTimecode(time, frameSeconds, zeroPoint);
  const range = {
    start,
    end,
    startTimecode: tc(start),
    endTimecode: tc(end),
    removedSeconds: round(end - start, 3),
  };

  let target: TimelineSnapshot = snapshot;
  if (args.newSequenceName) {
    const duplicate: any = await duplicateSequence(ctx, snapshot.sequenceId, args.newSequenceName, false);
    if (!duplicate || duplicate.success !== true || !duplicate.newSequenceId) {
      return { success: false, status: 'duplicate_failed', range, error: duplicate?.error ?? 'Could not duplicate the sequence; nothing was cut.' };
    }
    target = await readTimeline(ctx, String(duplicate.newSequenceId));
    if (!target.success || target.clips.length !== snapshot.clips.length) {
      return { success: false, status: 'duplicate_failed', range, error: 'The duplicate does not match the original sequence; nothing was cut.' };
    }
  }

  const outcome = await applyRangeCuts(ctx, target, [[start, end]]);
  if (!outcome.ok) {
    const { status, error, ...extra } = outcome;
    return {
      success: false,
      status,
      range,
      sequenceId: target.sequenceId,
      error,
      warning: args.newSequenceName
        ? `${error} Only the duplicate was touched; the original sequence is unchanged.`
        : `${error} The sequence may be partly cut; undo in Premiere (Ctrl+Z / Cmd+Z).`,
      ...extra,
    };
  }
  return {
    success: true,
    status: 'cut',
    sequenceId: target.sequenceId,
    sequenceName: args.newSequenceName ?? snapshot.sequenceName,
    ...(args.newSequenceName ? { originalSequenceId: snapshot.sequenceId } : {}),
    range,
    originalDuration: round(snapshot.sequenceEnd, 3),
    newDuration: round(outcome.after.sequenceEnd, 3),
    verification: outcome.verification,
  };
}
