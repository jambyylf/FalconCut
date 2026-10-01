/**
 * FalconCut: аралықтарды барлық тректен бірге кесетін ортақ қозғалтқыш
 * (cut_silences пен cut_range қолданады).
 *
 * Реті:
 *   1) секвенциядағы барлық клип оқылады;
 *   2) барлық трек кесінді шекараларында кесіледі (razor);
 *   3) кесінділер соңынан басына қарай алынады: аралықтағы бөліктер барлық тректен
 *      көтеріледі (lift), артындағының бәрі бірдей шамаға солға жылжиды. Әр тректі өз
 *      бөлігімен ripple етсе, сол жерде клипі жоқ трек (титр, музыка) жылжымай қалып,
 *      синхрон бұзылар еді;
 *   4) нәтиже Premiere-ден қайта оқылып, алдын ала есептелген орналасумен салыстырылады.
 */

import type { ToolContext } from './context.js';
import { compareLayouts, simulateCuts, type Interval, type LayoutComparison, type TimelineClip } from '../utils/silence.js';
import { round } from '../utils/audio-correlation.js';
import { razorTimelineAtTime } from './domains/timeline.js';

// Үлкен таймлайнда (мыңдаған клип) бір скрипт 45 секундтан ұзаққа созылуы мүмкін
const READ_TIMEOUT_MS = 120000;
const CUT_TIMEOUT_MS = 300000;

export interface TimelineSnapshot {
  success: boolean;
  error?: string;
  sequenceId: string;
  sequenceName: string;
  frameSeconds: number;
  /** Premiere көрсететін бастапқы таймкод (секунд), көбіне 0. */
  zeroPoint: number;
  sequenceEnd: number;
  clips: Array<TimelineClip & { mediaPath?: string }>;
}

/** Секвенцияның барлық клипі. mediaTrack берілсе, сол дыбыс трегіндегі клиптердің файл жолы да оқылады. */
export async function readTimeline(ctx: ToolContext, sequenceId: string | null, mediaTrack = -1): Promise<TimelineSnapshot> {
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
              if (groups[g][0] === "audio" && t === ${mediaTrack}) {
                var mediaPath = "";
                try { mediaPath = clip.projectItem ? String(clip.projectItem.getMediaPath()) : ""; } catch (ePath) {}
                snap.mediaPath = mediaPath;
              }
              if (snap.end > sequenceEnd) sequenceEnd = snap.end;
              clips.push(snap);
            }
          }
        }
        var zeroPoint = 0;
        try { zeroPoint = Number(seq.zeroPoint) / 254016000000; if (!(zeroPoint > 0)) zeroPoint = 0; } catch (eZero) {}
        return JSON.stringify({ success: true, sequenceId: String(seq.sequenceID), sequenceName: String(seq.name), frameSeconds: __frameSecondsOf(seq), zeroPoint: zeroPoint, sequenceEnd: sequenceEnd, clips: clips });
      } catch (e) {
        return JSON.stringify({ success: false, error: e.toString() });
      }
    `, READ_TIMEOUT_MS);
  if (!result || result.success !== true || !Array.isArray(result.clips)) {
    return { success: false, error: result?.error ?? 'Could not read the sequence', sequenceId: '', sequenceName: '', frameSeconds: 0, zeroPoint: 0, sequenceEnd: 0, clips: [] };
  }
  return { zeroPoint: 0, ...result } as TimelineSnapshot;
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

export type RangeCutOutcome =
  | { ok: true; after: TimelineSnapshot; verification: LayoutComparison }
  | { ok: false; status: 'razor_failed' | 'cut_failed' | 'verification_failed'; error: string; details?: unknown; verification?: LayoutComparison };

/** Кесінділерді target секвенциясында орындайды және нәтижені тексереді. */
export async function applyRangeCuts(ctx: ToolContext, target: TimelineSnapshot, cuts: Interval[]): Promise<RangeCutOutcome> {
  const frameSeconds = Number(target.frameSeconds) > 0 ? Number(target.frameSeconds) : 1 / 30;

  // Барлық тректі кесінді шекараларында кесу (секвенцияның басы мен соңы керек емес)
  const boundaries = [...new Set(cuts.flat())]
    .filter((time) => time > frameSeconds / 2 && time < target.sequenceEnd - frameSeconds / 2)
    .sort((a, b) => b - a);
  for (const time of boundaries) {
    const razor: any = await razorTimelineAtTime(ctx, target.sequenceId, time);
    if (!razor || razor.success !== true) {
      return { ok: false, status: 'razor_failed', error: `Could not cut the tracks at ${time}s: ${razor?.error ?? 'unknown error'}.` };
    }
  }

  // Соңынан басына қарай — алдыңғы кесінділердің уақыты өзгермейді
  const expected = simulateCuts(target.clips, cuts);
  for (const [start, end] of [...cuts].sort((a, b) => b[0] - a[0])) {
    const removed: any = await ctx.bridge.executeScript(rangeCutScript(target.sequenceId, start, end), CUT_TIMEOUT_MS);
    if (!removed || removed.success !== true) {
      return { ok: false, status: 'cut_failed', error: `Could not remove ${round(start, 3)}-${round(end, 3)}s: ${removed?.error ?? 'unknown error'}.`, details: removed };
    }
  }

  const after = await readTimeline(ctx, target.sequenceId);
  const verification = after.success
    ? compareLayouts(expected, after.clips, frameSeconds / 2 + 0.001)
    : { ok: false, expectedPieces: expected.length, actualPieces: 0, mismatches: [after.error ?? 'could not read the timeline back'] };
  if (!verification.ok) {
    return {
      ok: false,
      status: 'verification_failed',
      error: `The timeline after cutting does not match the expected layout (${verification.mismatches[0] ?? 'unknown difference'}).`,
      verification,
    };
  }
  return { ok: true, after, verification };
}
