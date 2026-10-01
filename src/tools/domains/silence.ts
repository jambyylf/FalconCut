/**
 * FalconCut: үнсіз жерлерді кесу (cut_silences).
 *
 * Реті:
 *   1) секвенциядағы барлық клип оқылады (ештеңе өзгермейді);
 *   2) таңдалған дыбыс трегіндегі әр клиптің дыбысы ffmpeg silencedetect арқылы талданады;
 *   3) үзілістерден кесінділер құрылады (екі жағынан тыныштық қалады, кадрға тураланады);
 *   4) apply=false болса — тек жоспар қайтарылады;
 *   5) apply=true болса — әдепкіде секвенцияның КӨШІРМЕСІ жасалады да, кесінділер барлық
 *      тректен бірге алынады (../range-cut.ts), нәтиже қайта оқылып тексеріледі.
 */

import { z } from 'zod';
import type { ToolContext, ToolModule } from '../context.js';
import { buildCuts, type Interval } from '../../utils/silence.js';
import { detectSilenceWindows, FfmpegNotFoundError, ffmpegInstallHint } from '../../utils/ffmpeg.js';
import { round } from '../../utils/audio-correlation.js';
import { serverTranslate } from '../../i18n.js';
import { duplicateSequence } from './sequence.js';
import { applyRangeCuts, readTimeline, type TimelineSnapshot } from '../range-cut.js';

/** Үнсіздік табатын функция (тесттерде ауыстырылады). */
export type SilenceDetector = (mediaPath: string, startSeconds: number, durationSeconds: number, thresholdDb: number, minSilenceSeconds: number) => Promise<Interval[]>;

const cutSchema = z.object({
  sequenceId: z.string().optional().describe('Sequence to cut. Defaults to the active sequence.'),
  audioTrackIndex: z.number().int().min(0).optional().describe('Audio track (0-based) whose clips are analysed for silence (default 0 = A1). Cuts are applied to every track.'),
  thresholdDb: z.number().min(-100).max(0).optional().describe('Audio quieter than this counts as silence, in dB (default -35).'),
  minSilenceSeconds: z.number().min(0.05).optional().describe('Shortest pause that is cut, in seconds (default 0.5).'),
  paddingSeconds: z.number().min(0).optional().describe('Silence kept on each side of speech so words are not clipped, in seconds (default 0.15).'),
  minCutSeconds: z.number().min(0).optional().describe('Cuts shorter than this after padding are skipped, in seconds (default 0.2).'),
  inPlace: z.boolean().optional().describe('false (default): cut a duplicate of the sequence and leave the original untouched. true: cut the sequence itself.'),
  newSequenceName: z.string().optional().describe('Name for the duplicate when inPlace is false.'),
  apply: z.boolean().optional().describe('false (default): only report which ranges would be cut. true: cut them, then read the timeline back and compare it with the expected layout.'),
});

export const silenceTools: ToolModule[] = [
  {
    name: 'cut_silences',
    description: 'Finds pauses in the speech of a sequence (ffmpeg silencedetect on one audio track) and removes them from every track at once, closing the gaps so all tracks stay in sync. By default it works on a duplicate of the sequence and only reports the plan; apply=true performs the cut and verifies every remaining piece against the expected layout.',
    inputSchema: cutSchema,
    run: (ctx, args) => cutSilences(ctx, args),
  },
];

export async function cutSilences(ctx: ToolContext, args: z.infer<typeof cutSchema>, detect: SilenceDetector = detectSilenceWindows): Promise<any> {
  const audioTrackIndex = args.audioTrackIndex ?? 0;
  const thresholdDb = args.thresholdDb ?? -35;
  const minSilenceSeconds = args.minSilenceSeconds ?? 0.5;
  const paddingSeconds = args.paddingSeconds ?? 0.15;
  const minCutSeconds = args.minCutSeconds ?? 0.2;
  const apply = args.apply === true;
  const inPlace = args.inPlace === true;

  const snapshot = await readTimeline(ctx, args.sequenceId ?? null, audioTrackIndex);
  if (!snapshot.success) return { success: false, error: snapshot.error };
  const frameSeconds = Number(snapshot.frameSeconds) > 0 ? Number(snapshot.frameSeconds) : 1 / 30;
  const analysed = snapshot.clips.filter((clip) => clip.trackType === 'audio' && clip.trackIndex === audioTrackIndex);
  if (analysed.length === 0) {
    return { success: false, error: `There are no clips on audio track A${audioTrackIndex + 1} of ${snapshot.sequenceName} to analyse.` };
  }
  const offline = analysed.find((clip) => !clip.mediaPath);
  if (offline) {
    return { success: false, error: `No media file for ${offline.name} on A${audioTrackIndex + 1} (offline or nested); cut_silences reads the audio from the file on disk.` };
  }

  // 1) Әр клиптің қолданылған бөлігіндегі үзілістер → таймлайн уақыты
  const silences: Interval[] = [];
  try {
    for (const clip of analysed) {
      const found = await detect(String(clip.mediaPath), clip.inPoint, clip.end - clip.start, thresholdDb, minSilenceSeconds);
      for (const [start, end] of found) silences.push([clip.start + start, clip.start + end]);
    }
  } catch (error) {
    if (error instanceof FfmpegNotFoundError) {
      const hint = ffmpegInstallHint();
      return {
        success: false,
        errorCode: 'FFMPEG_NOT_FOUND',
        error: serverTranslate(
          'silence.ffmpeg_missing',
          'ffmpeg was not found, so the audio cannot be analysed. Install ffmpeg ({0}) or set FALCONCUT_FFMPEG to its full path, then run the tool again.',
          hint,
        ),
        installHint: hint,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, errorCode: 'FFMPEG_FAILED', error: serverTranslate('sync.ffmpeg_failed', 'ffmpeg could not read the audio: {0}', message) };
  }

  const cuts = buildCuts(silences, { paddingSeconds, minCutSeconds, frameSeconds, sequenceEnd: snapshot.sequenceEnd });
  const removedSeconds = cuts.reduce((sum, [start, end]) => sum + (end - start), 0);
  const plan = {
    sequenceId: snapshot.sequenceId,
    sequenceName: snapshot.sequenceName,
    analysedTrack: `A${audioTrackIndex + 1}`,
    settings: { thresholdDb, minSilenceSeconds, paddingSeconds, minCutSeconds, frameSeconds: round(frameSeconds, 6) },
    pausesFound: silences.length,
    cuts: cuts.map(([start, end]) => ({ start: round(start, 3), end: round(end, 3), duration: round(end - start, 3) })),
    cutCount: cuts.length,
    removedSeconds: round(removedSeconds, 3),
    originalDuration: round(snapshot.sequenceEnd, 3),
    newDuration: round(snapshot.sequenceEnd - removedSeconds, 3),
  };

  if (!apply) {
    return {
      success: true,
      applied: false,
      status: 'planned',
      ...plan,
      nextStep: cuts.length
        ? `Nothing was changed. Run cut_silences again with apply:true to remove ${cuts.length} pause(s) (${plan.removedSeconds}s)${inPlace ? ' from this sequence' : ' in a duplicate sequence'}.`
        : 'No pauses long enough to cut were found.',
    };
  }
  if (cuts.length === 0) {
    return { success: true, applied: false, status: 'nothing_to_cut', ...plan };
  }

  // 2) Қай секвенция кесіледі: әдепкіде көшірме
  let target: TimelineSnapshot = snapshot;
  let newSequenceName: string | undefined;
  if (!inPlace) {
    newSequenceName = args.newSequenceName ?? `${snapshot.sequenceName} — ${serverTranslate('silence.sequence_suffix', 'no silences')}`;
    const duplicate: any = await duplicateSequence(ctx, snapshot.sequenceId, newSequenceName, false);
    if (!duplicate || duplicate.success !== true || !duplicate.newSequenceId) {
      return { success: false, applied: false, status: 'duplicate_failed', ...plan, error: duplicate?.error ?? 'Could not duplicate the sequence; nothing was cut.' };
    }
    target = await readTimeline(ctx, String(duplicate.newSequenceId), audioTrackIndex);
    if (!target.success || target.clips.length !== snapshot.clips.length) {
      return { success: false, applied: false, status: 'duplicate_failed', ...plan, error: 'The duplicate does not match the original sequence; nothing was cut.' };
    }
  }

  const failure = (status: string, warning: string, extra: Record<string, unknown> = {}) => ({
    success: false,
    applied: false,
    status,
    ...plan,
    targetSequenceId: target.sequenceId,
    ...(newSequenceName ? { newSequenceName } : {}),
    warning: inPlace
      ? `${warning} The sequence may be partly cut; undo in Premiere (Ctrl+Z / Cmd+Z).`
      : `${warning} Only the duplicate was touched; the original sequence is unchanged. Delete the duplicate and try again.`,
    error: warning,
    ...extra,
  });

  // 3) Барлық тректен бірге кесу және Premiere-ден қайта оқып тексеру
  const outcome = await applyRangeCuts(ctx, target, cuts);
  if (!outcome.ok) {
    const { status, error, ...extra } = outcome;
    return failure(status, error, extra);
  }
  return {
    success: true,
    applied: true,
    status: 'cut',
    ...plan,
    targetSequenceId: target.sequenceId,
    ...(newSequenceName ? { newSequenceName, originalSequenceId: snapshot.sequenceId } : {}),
    newDuration: round(outcome.after.sequenceEnd, 3),
    verification: outcome.verification,
  };
}
