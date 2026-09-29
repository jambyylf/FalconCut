/**
 * FalconCut: үнсіз жерлерді кесу (cut_silences).
 *
 * Реті:
 *   1) секвенциядағы барлық клип оқылады (ештеңе өзгермейді);
 *   2) таңдалған дыбыс трегіндегі әр клиптің дыбысы ffmpeg silencedetect арқылы талданады;
 *   3) үзілістерден кесінділер құрылады (екі жағынан тыныштық қалады, кадрға тураланады);
 *   4) apply=false болса — тек жоспар қайтарылады;
 *   5) apply=true болса — әдепкіде секвенцияның КӨШІРМЕСІ жасалады, барлық тректер кесінді
 *      шекараларында кесіледі, кесілген аралық барлық тректен алынып, артындағының бәрі
 *      бірдей шамаға солға жылжиды. Әр тректі өз бөлігімен ripple етсе, сол жерде клипі жоқ
 *      трек (титр, музыка) жылжымай қалып, синхрон бұзылар еді.
 *   6) нәтиже Premiere-ден қайта оқылып, алдын ала есептелген орналасумен салыстырылады.
 */

import { z } from 'zod';
import type { ToolContext, ToolModule } from '../context.js';
import { buildCuts, compareLayouts, simulateCuts, type Interval, type TimelineClip } from '../../utils/silence.js';
import { detectSilenceWindows, FfmpegNotFoundError, ffmpegInstallHint } from '../../utils/ffmpeg.js';
import { round } from '../../utils/audio-correlation.js';
import { serverTranslate } from '../../i18n.js';
import { duplicateSequence } from './sequence.js';
import { razorTimelineAtTime } from './timeline.js';

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

interface Snapshot {
  success: boolean;
  error?: string;
  sequenceId: string;
  sequenceName: string;
  frameSeconds: number;
  sequenceEnd: number;
  clips: Array<TimelineClip & { mediaPath?: string }>;
}

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
  let target: Snapshot = snapshot;
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

  // 3) Барлық тректі кесінді шекараларында кесу (басы мен соңы керек емес)
  const boundaries = [...new Set(cuts.flat())].filter((time) => time > frameSeconds / 2 && time < target.sequenceEnd - frameSeconds / 2).sort((a, b) => b - a);
  for (const time of boundaries) {
    const razor: any = await razorTimelineAtTime(ctx, target.sequenceId, time);
    if (!razor || razor.success !== true) return failure('razor_failed', `Could not cut the tracks at ${time}s: ${razor?.error ?? 'unknown error'}.`);
  }

  // 4) Кесінділерді соңынан басына қарай алу — алдыңғылардың уақыты өзгермейді
  const expected = simulateCuts(target.clips, cuts);
  for (const [start, end] of [...cuts].reverse()) {
    const removed: any = await ctx.bridge.executeScript(rangeCutScript(target.sequenceId, start, end));
    if (!removed || removed.success !== true) {
      return failure('cut_failed', `Could not remove ${round(start, 3)}-${round(end, 3)}s: ${removed?.error ?? 'unknown error'}.`, { details: removed });
    }
  }

  // 5) Қайта оқу және салыстыру
  const after = await readTimeline(ctx, target.sequenceId, audioTrackIndex);
  const verification = after.success
    ? compareLayouts(expected, after.clips, frameSeconds / 2 + 0.001)
    : { ok: false, expectedPieces: expected.length, actualPieces: 0, mismatches: [after.error ?? 'could not read the timeline back'] };
  if (!verification.ok) {
    return failure('verification_failed', `The timeline after cutting does not match the expected layout (${verification.mismatches[0] ?? 'unknown difference'}).`, { verification });
  }
  return {
    success: true,
    applied: true,
    status: 'cut',
    ...plan,
    targetSequenceId: target.sequenceId,
    ...(newSequenceName ? { newSequenceName, originalSequenceId: snapshot.sequenceId } : {}),
    newDuration: round(after.sequenceEnd, 3),
    verification,
  };
}

async function readTimeline(ctx: ToolContext, sequenceId: string | null, audioTrackIndex: number): Promise<Snapshot> {
  const result: any = await ctx.bridge.executeScript(`
      try {
        var seq = ${sequenceId ? `__findSequence(${JSON.stringify(sequenceId)})` : 'app.project.activeSequence'};
        if (!seq) return JSON.stringify({ success: false, error: "Sequence not found" });
        var clips = [];
        var sequenceEnd = 0;
        var groups = [["video", seq.videoTracks], ["audio", seq.audioTracks]];
        for (var g = 0; g < groups.length; g++) {
          var tracks = groups[g][1];
          for (var t = 0; t < tracks.numTracks; t++) {
            var track = tracks[t];
            for (var c = 0; c < track.clips.numItems; c++) {
              var clip = track.clips[c];
              var snap = __clipSnapshot({ clip: clip, track: track, trackIndex: t, clipIndex: c, trackType: groups[g][0], sequence: seq });
              if (groups[g][0] === "audio" && t === ${audioTrackIndex}) {
                var mediaPath = "";
                try { mediaPath = clip.projectItem ? String(clip.projectItem.getMediaPath()) : ""; } catch (ePath) {}
                snap.mediaPath = mediaPath;
              }
              if (snap.end > sequenceEnd) sequenceEnd = snap.end;
              clips.push(snap);
            }
          }
        }
        return JSON.stringify({ success: true, sequenceId: String(seq.sequenceID), sequenceName: String(seq.name), frameSeconds: __frameSecondsOf(seq), sequenceEnd: sequenceEnd, clips: clips });
      } catch (e) {
        return JSON.stringify({ success: false, error: e.toString() });
      }
    `);
  if (!result || result.success !== true || !Array.isArray(result.clips)) {
    return { success: false, error: result?.error ?? 'Could not read the sequence', sequenceId: '', sequenceName: '', frameSeconds: 0, sequenceEnd: 0, clips: [] };
  }
  return result as Snapshot;
}

/**
 * [start, end] аралығын барлық тректен алып, артындағының бәрін (end − start)-ке солға жылжытады.
 * Шекарада кесілмей қалған клип болса (мысалы, құлыпталған трек), ештеңеге тимей тоқтайды.
 */
export function rangeCutScript(sequenceId: string, start: number, end: number): string {
  return `
      try {
        var seq = __findSequence(${JSON.stringify(sequenceId)});
        if (!seq) return JSON.stringify({ success: false, error: "Sequence not found" });
        var cutStart = ${start};
        var cutEnd = ${end};
        var removedLength = cutEnd - cutStart;
        var eps = __frameSecondsOf(seq) / 4;
        var groups = [seq.videoTracks, seq.audioTracks];
        var straddling = [];
        for (var g = 0; g < groups.length; g++) {
          for (var t = 0; t < groups[g].numTracks; t++) {
            var track = groups[g][t];
            for (var c = 0; c < track.clips.numItems; c++) {
              var clip = track.clips[c];
              var s = __timeSeconds(clip.start);
              var e = __timeSeconds(clip.end);
              var crossesStart = s < cutStart - eps && e > cutStart + eps;
              var crossesEnd = s < cutEnd - eps && e > cutEnd + eps;
              if (crossesStart || crossesEnd) straddling.push((g === 0 ? "V" : "A") + (t + 1) + " " + clip.name);
            }
          }
        }
        if (straddling.length) {
          return JSON.stringify({ success: false, error: "These clips were not cut at the range boundary (locked track?): " + straddling.join("; "), straddling: straddling });
        }
        var lifted = 0;
        for (var g2 = 0; g2 < groups.length; g2++) {
          for (var t2 = 0; t2 < groups[g2].numTracks; t2++) {
            var liftTrack = groups[g2][t2];
            for (var c2 = liftTrack.clips.numItems - 1; c2 >= 0; c2--) {
              var inside = liftTrack.clips[c2];
              if (__timeSeconds(inside.start) >= cutStart - eps && __timeSeconds(inside.end) <= cutEnd + eps) {
                inside.remove(false, true);
                lifted++;
              }
            }
          }
        }
        var later = [];
        for (var g3 = 0; g3 < groups.length; g3++) {
          for (var t3 = 0; t3 < groups[g3].numTracks; t3++) {
            var laterTrack = groups[g3][t3];
            for (var c3 = 0; c3 < laterTrack.clips.numItems; c3++) {
              var after = laterTrack.clips[c3];
              var afterStart = __timeSeconds(after.start);
              if (afterStart >= cutEnd - eps) later.push({ clip: after, target: afterStart - removedLength });
            }
          }
        }
        // Earliest first, so every clip moves into space the previous one has already left.
        later.sort(function (x, y) { return x.target - y.target; });
        var moved = 0;
        for (var i = 0; i < later.length; i++) {
          var delta = later[i].target - __timeSeconds(later[i].clip.start);
          if (Math.abs(delta) > eps) { later[i].clip.move(delta); moved++; }
        }
        return JSON.stringify({ success: true, lifted: lifted, moved: moved });
      } catch (e) {
        return JSON.stringify({ success: false, error: e.toString() });
      }
    `;
}
