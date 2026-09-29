/**
 * FalconCut: екі камераны дыбыс бойынша синхрондау (sync_by_audio).
 *
 * Premiere-дің скрипт API-і «Synchronize by audio» әрекетін ашпайды, сондықтан:
 *   1) екі клиптің медиа файлы мен таймлайндағы орны ExtendScript арқылы оқылады;
 *   2) дыбыс ffmpeg арқылы моно, төмен жиілікте шығарылады (видео мен файлға тиіспейді);
 *   3) ығысу Node-тың өзінде GCC-PHAT кросс-корреляциясымен есептеледі — алдымен кең
 *      аралықта жуық (2 кГц), содан кейін әр нүктеде нақты (8 кГц);
 *   4) apply=true болса ғана екінші клип байланған бөліктерімен бірге жылжиды
 *      (move_clip, withLinked) және нәтиже қайта оқылып тексеріледі.
 * Дрейф шектен асса немесе сенімділік төмен болса, ештеңе жылжымайды.
 */

import { z } from 'zod';
import type { ToolContext, ToolModule } from '../context.js';
import { findAudioOffset, round, summarizeOffsets, type OffsetPoint } from '../../utils/audio-correlation.js';
import { decodeAudioWindow, FfmpegNotFoundError, ffmpegInstallHint } from '../../utils/ffmpeg.js';
import { serverTranslate } from '../../i18n.js';
import { moveClip } from './timeline.js';

/** Дыбыс үзіндісін беретін функция (тесттерде синтетикалық дыбыспен ауыстырылады). */
export type AudioDecoder = (mediaPath: string, startSeconds: number, durationSeconds: number, sampleRate: number) => Promise<Float32Array>;

const COARSE_RATE = 2000;
const FINE_RATE = 8000;
const FINE_SEARCH_SECONDS = 1;

const syncSchema = z.object({
  sequenceId: z.string().optional().describe('Sequence to work in. Defaults to the active sequence.'),
  referenceClipId: z.string().optional().describe('Clip that stays in place; its audio is the reference.'),
  targetClipId: z.string().optional().describe('Clip to align to the reference. With apply=true it is moved together with its linked audio/video.'),
  referenceTrackIndex: z.number().int().min(0).optional().describe('Alternative to referenceClipId: audio track index (0-based); its longest clip is used.'),
  targetTrackIndex: z.number().int().min(0).optional().describe('Alternative to targetClipId: audio track index (0-based); its longest clip is used.'),
  analysisPoints: z.number().int().min(1).max(12).optional().describe('How many places to measure the offset at, spread over the overlap (default 4).'),
  windowSeconds: z.number().min(5).max(600).optional().describe('Length of each measured audio window in seconds (default 60).'),
  maxShiftSeconds: z.number().min(0.5).max(1800).optional().describe('How far from the current placement to search for the match, in seconds (default 30).'),
  minConfidence: z.number().min(1).optional().describe('Lowest peak-to-next-peak ratio a measurement may have (default 2.5). Noise is about 1.'),
  maxDriftSeconds: z.number().min(0).optional().describe('Largest allowed spread between the measured offsets (default: one frame of the sequence).'),
  apply: z.boolean().optional().describe('false (default): measure and report only; the project is not touched. true: move the target clip with its linked parts to the measured position and read it back.'),
}).refine((value) => value.referenceClipId !== undefined || value.referenceTrackIndex !== undefined, {
  message: 'Provide referenceClipId or referenceTrackIndex',
}).refine((value) => value.targetClipId !== undefined || value.targetTrackIndex !== undefined, {
  message: 'Provide targetClipId or targetTrackIndex',
});

export const syncTools: ToolModule[] = [
  {
    name: 'sync_by_audio',
    description: 'Measures the audio offset between two clips recorded by different cameras (ffmpeg + cross-correlation at several points) and reports each point\'s offset, the mean, the drift between points and a confidence level. With apply=true it moves the target clip together with its linked audio/video into sync and reads the result back; it refuses to move when the drift or confidence is out of bounds.',
    inputSchema: syncSchema,
    run: (ctx, args) => syncByAudio(ctx, args),
  },
];

interface ClipDescription {
  clipId: string;
  name: string;
  trackType: 'video' | 'audio';
  trackIndex: number;
  start: number;
  end: number;
  inPoint: number;
  outPoint: number;
  mediaPath: string;
}

export async function syncByAudio(ctx: ToolContext, args: z.infer<typeof syncSchema>, decode: AudioDecoder = decodeAudioWindow): Promise<any> {
  const analysisPoints = args.analysisPoints ?? 4;
  const windowSeconds = args.windowSeconds ?? 60;
  const maxShiftSeconds = args.maxShiftSeconds ?? 30;
  const minConfidence = args.minConfidence ?? 2.5;
  const apply = args.apply === true;

  const info: any = await ctx.bridge.executeScript(resolveClipsScript(args));
  if (!info || info.success !== true) return info ?? { success: false, error: 'Could not read the clips' };
  const reference: ClipDescription = info.reference;
  const target: ClipDescription = info.target;
  const frameSeconds = Number(info.frameSeconds) > 0 ? Number(info.frameSeconds) : 1 / 30;
  const maxDriftSeconds = args.maxDriftSeconds ?? frameSeconds;

  if (reference.clipId === target.clipId) {
    return { success: false, error: 'Reference and target are the same clip; pick two different cameras.' };
  }
  for (const clip of [reference, target]) {
    if (!clip.mediaPath) {
      return { success: false, error: `No media file for ${clip.name} (offline media?); sync_by_audio reads the audio from the file on disk.` };
    }
  }

  // Таймлайн уақыты T → әр файлдағы уақыт (қазіргі орналасу бойынша)
  const referenceMedia = (time: number) => reference.inPoint + (time - reference.start);
  const targetMedia = (time: number) => target.inPoint + (time - target.start);
  const from = Math.max(reference.start, target.start);
  const to = Math.min(reference.end, target.end) - windowSeconds;
  if (to < from) {
    return {
      success: false,
      error: `The clips overlap on the timeline for less than windowSeconds (${windowSeconds}s). Lower windowSeconds, or place the target roughly next to the reference first.`,
      reference: describeClip(reference),
      target: describeClip(target),
    };
  }
  const times = Array.from({ length: analysisPoints }, (_, index) => from + ((to - from) * (index + 0.5)) / analysisPoints);

  let coarse: { offsetSeconds: number; confidence: number };
  const points: Array<OffsetPoint & { referenceMediaSeconds: number }> = [];
  try {
    // 1) Жуық өлшем: ортадағы нүктеде, қазіргі орыннан ±maxShiftSeconds аралығында
    const middle = (from + to) / 2;
    coarse = await measure(decode, reference, target, referenceMedia(middle), targetMedia(middle), windowSeconds, maxShiftSeconds, COARSE_RATE);
    // 2) Нақты өлшем: әр нүктеде, жуық нәтиженің ±1 с маңында
    for (const time of times) {
      const referenceSeconds = referenceMedia(time);
      const fine = await measure(decode, reference, target, referenceSeconds, referenceSeconds - coarse.offsetSeconds, windowSeconds, FINE_SEARCH_SECONDS, FINE_RATE);
      points.push({ timelineSeconds: time, referenceMediaSeconds: referenceSeconds, offsetSeconds: fine.offsetSeconds, confidence: fine.confidence });
    }
  } catch (error) {
    if (error instanceof FfmpegNotFoundError) {
      const hint = ffmpegInstallHint();
      return {
        success: false,
        errorCode: 'FFMPEG_NOT_FOUND',
        error: serverTranslate(
          'sync.ffmpeg_missing',
          'ffmpeg was not found, so the audio cannot be analysed. Install ffmpeg ({0}) or set FALCONCUT_FFMPEG to its full path, then run sync_by_audio again.',
          hint,
        ),
        installHint: hint,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      errorCode: 'FFMPEG_FAILED',
      error: serverTranslate('sync.ffmpeg_failed', 'ffmpeg could not read the audio: {0}', message),
    };
  }

  const summary = summarizeOffsets(points, { minConfidence, maxDriftSeconds });
  const warnings = [...summary.reasons];
  // Кең іздеудің (±maxShiftSeconds, 2 кГц) шың қатынасы табиғи түрде төмен: кандидат көп.
  // Нақты S0678/D0678-де ол 2,13 болды, ал ығысуды дұрыс тапты (5,133 с). Сондықтан шешімді
  // әр нүктедегі дәл өлшемдер шығарады — жуық нәтиже қате болса, олар ±1 с ішінде тек шу көреді.
  if (!summary.reliable && coarse.confidence < minConfidence) {
    warnings.push(`the wide search around the current placement found no clear match either (confidence ${round(coarse.confidence, 2)}); raise maxShiftSeconds if the cameras started far apart`);
  }
  const reliable = summary.reliable;

  // offset = бір дыбыстың reference файлындағы уақыты − target файлындағы уақыты
  const suggestedStart = target.inPoint - reference.inPoint + reference.start + summary.meanOffsetSeconds;
  const suggestedStartFrames = Math.round(suggestedStart / frameSeconds);
  const roundedStart = suggestedStartFrames * frameSeconds;
  const shiftFrames = Math.round((roundedStart - target.start) / frameSeconds);

  const report: any = {
    reference: describeClip(reference),
    target: describeClip(target),
    sequenceId: info.sequenceId,
    offsetMeaning: 'offsetSeconds = time of a sound in the reference file minus time of the same sound in the target file',
    points: points.map((point) => ({
      timelineSeconds: round(point.timelineSeconds, 3),
      referenceMediaSeconds: round(point.referenceMediaSeconds, 3),
      offsetSeconds: round(point.offsetSeconds, 4),
      confidence: round(point.confidence, 2),
    })),
    coarse: { offsetSeconds: round(coarse.offsetSeconds, 4), confidence: round(coarse.confidence, 2), searchSeconds: maxShiftSeconds },
    meanOffsetSeconds: round(summary.meanOffsetSeconds, 4),
    medianOffsetSeconds: round(summary.medianOffsetSeconds, 4),
    driftSeconds: round(summary.driftSeconds, 4),
    driftPerHourSeconds: round(summary.driftPerHourSeconds, 4),
    minConfidence: round(summary.minConfidence, 2),
    confidenceLevel: summary.confidenceLevel,
    reliable,
    frameSeconds: round(frameSeconds, 6),
    currentTargetStart: round(target.start, 4),
    suggestedTargetStart: round(roundedStart, 4),
    shiftSeconds: round(roundedStart - target.start, 4),
    shiftFrames,
    alreadyInSync: shiftFrames === 0,
    thresholds: { minConfidence, maxDriftSeconds: round(maxDriftSeconds, 4) },
    warnings,
  };

  if (!apply) {
    return {
      success: true,
      applied: false,
      status: 'measured',
      ...report,
      nextStep: shiftFrames === 0
        ? 'The target is already in sync with the reference.'
        : `Nothing was changed. Run sync_by_audio again with apply:true to move ${target.name} by ${shiftFrames} frame(s).`,
    };
  }

  if (!reliable) {
    return {
      success: false,
      applied: false,
      status: 'not_applied',
      ...report,
      warning: `Not moved: ${warnings.join('; ')}.`,
      error: `Not moved: ${warnings.join('; ')}.`,
    };
  }
  if (roundedStart < 0) {
    const warning = `Not moved: the target would have to start at ${round(roundedStart, 3)}s, before the start of the sequence. Move the reference later first.`;
    return { success: false, applied: false, status: 'not_applied', ...report, warning, error: warning };
  }
  if (shiftFrames === 0) {
    return { success: true, applied: false, status: 'already_in_sync', ...report };
  }

  const move: any = await moveClip(ctx, target.clipId, roundedStart, true);
  if (!move || move.success !== true) {
    const warning = move?.warning ?? move?.error ?? 'move_clip did not confirm the move';
    return { success: false, applied: false, status: 'move_failed', ...report, move, warning, error: warning };
  }
  return { success: true, applied: true, status: 'synced', ...report, move };
}

/** Бір нүктедегі ығысу: reference үзіндісі target үзіндісінің қай жерінде тұр. */
async function measure(
  decode: AudioDecoder,
  reference: ClipDescription,
  target: ClipDescription,
  referenceSeconds: number,
  expectedTargetSeconds: number,
  windowSeconds: number,
  searchSeconds: number,
  sampleRate: number,
): Promise<{ offsetSeconds: number; confidence: number }> {
  const referenceAudio = await decode(reference.mediaPath, referenceSeconds, windowSeconds, sampleRate);
  const targetStart = Math.max(0, expectedTargetSeconds - searchSeconds);
  const targetDuration = windowSeconds + (expectedTargetSeconds - targetStart) + searchSeconds;
  const targetAudio = await decode(target.mediaPath, targetStart, targetDuration, sampleRate);
  if (referenceAudio.length === 0 || targetAudio.length === 0) {
    throw new Error(`no audio samples at ${round(referenceSeconds, 2)}s in ${reference.name} or ${round(targetStart, 2)}s in ${target.name}`);
  }
  const maxLag = Math.max(0, targetAudio.length - referenceAudio.length) / sampleRate;
  const peak = findAudioOffset(referenceAudio, targetAudio, sampleRate, 0, maxLag);
  return { offsetSeconds: referenceSeconds - (targetStart + peak.lagSeconds), confidence: peak.confidence };
}

function describeClip(clip: ClipDescription): Record<string, unknown> {
  return {
    clipId: clip.clipId,
    name: clip.name,
    track: `${clip.trackType === 'video' ? 'V' : 'A'}${clip.trackIndex + 1}`,
    start: round(clip.start, 4),
    end: round(clip.end, 4),
    inPoint: round(clip.inPoint, 4),
    mediaPath: clip.mediaPath,
  };
}

function resolveClipsScript(args: z.infer<typeof syncSchema>): string {
  const literal = (value: unknown) => (value === undefined ? 'null' : JSON.stringify(value));
  return `
      try {
        var seq = ${args.sequenceId ? `__findSequence(${JSON.stringify(args.sequenceId)})` : 'app.project.activeSequence'};
        if (!seq) return JSON.stringify({ success: false, error: "Sequence not found" });
        function pickClip(clipId, trackIndex) {
          if (clipId !== null) return __findClipInSequence(seq, clipId);
          if (trackIndex === null || trackIndex >= seq.audioTracks.numTracks) return null;
          var track = seq.audioTracks[trackIndex];
          var best = null;
          var bestLength = -1;
          for (var c = 0; c < track.clips.numItems; c++) {
            var candidate = track.clips[c];
            var length = __timeSeconds(candidate.end) - __timeSeconds(candidate.start);
            if (length > bestLength) {
              bestLength = length;
              best = { clip: candidate, track: track, trackIndex: trackIndex, clipIndex: c, trackType: "audio", sequence: seq, sequenceId: seq.sequenceID, sequenceName: seq.name };
            }
          }
          return best;
        }
        function describeForSync(found) {
          var snap = __clipSnapshot(found);
          var mediaPath = "";
          try { mediaPath = found.clip.projectItem ? String(found.clip.projectItem.getMediaPath()) : ""; } catch (ePath) {}
          snap.mediaPath = mediaPath;
          return snap;
        }
        var referenceClip = pickClip(${literal(args.referenceClipId)}, ${literal(args.referenceTrackIndex)});
        if (!referenceClip) return JSON.stringify({ success: false, error: "Reference clip not found" });
        var targetClip = pickClip(${literal(args.targetClipId)}, ${literal(args.targetTrackIndex)});
        if (!targetClip) return JSON.stringify({ success: false, error: "Target clip not found" });
        return JSON.stringify({
          success: true,
          sequenceId: String(seq.sequenceID),
          sequenceName: String(seq.name),
          frameSeconds: __frameSecondsOf(seq),
          reference: describeForSync(referenceClip),
          target: describeForSync(targetClip)
        });
      } catch (e) {
        return JSON.stringify({ success: false, error: e.toString() });
      }
    `;
}
