/**
 * FalconCut: үнсіз жерлерді кесу (cut_silences) үшін таза есептеулер.
 *
 * Premiere-ге тиіспейді — тек сандармен жұмыс істейді, сондықтан толық тестіленеді:
 *   - ffmpeg silencedetect шығысын оқу;
 *   - үзілістерден кесінділер құру (екі жағынан тыныштық қалдыру, кадрға туралау);
 *   - кесуден кейін әр тректе не қалатынын алдын ала есептеу (кейін Premiere-ден
 *     қайта оқылған нәтижемен салыстыру үшін).
 */

export type Interval = [number, number];

/** silencedetect-тің stderr шығысынан [басы, соңы] аралықтары (үзінді басынан бастап). */
export function parseSilencedetect(stderr: string, windowSeconds: number): Interval[] {
  const intervals: Interval[] = [];
  let open: number | null = null;
  const pattern = /silence_(start|end):\s*(-?[0-9.]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(stderr))) {
    const value = Math.max(0, Number(match[2]));
    if (match[1] === 'start') open = value;
    else if (open !== null) {
      intervals.push([open, Math.min(value, windowSeconds)]);
      open = null;
    }
  }
  // Файлдың соңына дейін созылған үнсіздіктің соңы жазылмауы мүмкін
  if (open !== null && open < windowSeconds) intervals.push([open, windowSeconds]);
  return intervals;
}

/** Бір-біріне тиіп тұрған (joinGap-тан жақын) аралықтарды біріктіреді. */
export function mergeIntervals(intervals: Interval[], joinGap = 0.1): Interval[] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged: Interval[] = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last && start - last[1] < joinGap) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

export interface CutOptions {
  /** Сөз жұтылып кетпеуі үшін әр жағынан қалдырылатын тыныштық, секунд. */
  paddingSeconds: number;
  /** Бұдан қысқа кесінді жасалмайды. */
  minCutSeconds: number;
  frameSeconds: number;
  sequenceEnd: number;
}

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

/** Таймлайндағы үзілістерден кесінділер: padding, кадрға туралау, басы/соңы. */
export function buildCuts(silences: Interval[], options: CutOptions): Interval[] {
  const { paddingSeconds, minCutSeconds, frameSeconds, sequenceEnd } = options;
  const cuts: Interval[] = [];
  for (const [silenceStart, silenceEnd] of mergeIntervals(silences)) {
    // Секвенцияның басындағы/соңындағы үнсіздік толық алынады — сөзге жабыспайды
    const start = silenceStart <= frameSeconds / 2
      ? 0
      : Math.ceil((silenceStart + paddingSeconds) / frameSeconds - 1e-6) * frameSeconds;
    const end = silenceEnd >= sequenceEnd - frameSeconds / 2
      ? sequenceEnd
      : Math.floor((silenceEnd - paddingSeconds) / frameSeconds + 1e-6) * frameSeconds;
    if (end - start >= minCutSeconds - 1e-9) cuts.push([round6(start), round6(end)]);
  }
  return cuts;
}

export interface TimelineClip {
  clipId?: string;
  name?: string;
  trackType: 'video' | 'audio';
  trackIndex: number;
  start: number;
  end: number;
  inPoint: number;
  outPoint: number;
}

/**
 * Кесінділерден кейін әр тректе қалатын бөліктер: кесілген аралықтағы бөлік жойылады,
 * одан кейінгі барлығы (барлық трек бірдей) алдындағы кесінділердің жалпы ұзындығына
 * солға жылжиды. Клиптің өз «таймлайн → файл» қатынасы сақталады (жылдамдығы 100%-дан
 * басқа клип, графика): бөлінбеген клиптің inPoint/outPoint-ы мүлде өзгермейді.
 */
export function simulateCuts(clips: TimelineClip[], cuts: Interval[]): TimelineClip[] {
  const ordered = [...cuts].sort((a, b) => a[0] - b[0]);
  const removedBefore = (time: number) =>
    ordered.reduce((sum, [start, end]) => (end <= time + 1e-9 ? sum + (end - start) : sum), 0);
  const result: TimelineClip[] = [];
  for (const clip of clips) {
    const span = clip.end - clip.start;
    const sourceSpan = clip.outPoint - clip.inPoint;
    const rate = span > 1e-9 && Number.isFinite(sourceSpan) && sourceSpan > 0 ? sourceSpan / span : 1;
    const boundaries = [clip.start, clip.end];
    for (const [start, end] of ordered) {
      if (start > clip.start && start < clip.end) boundaries.push(start);
      if (end > clip.start && end < clip.end) boundaries.push(end);
    }
    const points = [...new Set(boundaries.map(round6))].sort((a, b) => a - b);
    for (let i = 0; i < points.length - 1; i++) {
      const pieceStart = points[i]!;
      const pieceEnd = points[i + 1]!;
      if (pieceEnd - pieceStart < 1e-6) continue;
      const inside = ordered.some(([start, end]) => pieceStart >= start - 1e-9 && pieceEnd <= end + 1e-9);
      if (inside) continue;
      const shift = removedBefore(pieceStart);
      const inPoint = clip.inPoint + (pieceStart - clip.start) * rate;
      result.push({
        ...(clip.name !== undefined ? { name: clip.name } : {}),
        trackType: clip.trackType,
        trackIndex: clip.trackIndex,
        start: round6(pieceStart - shift),
        end: round6(pieceEnd - shift),
        inPoint: round6(inPoint),
        outPoint: round6(inPoint + (pieceEnd - pieceStart) * rate),
      });
    }
  }
  return sortClips(result);
}

function sortClips(clips: TimelineClip[]): TimelineClip[] {
  return [...clips].sort((a, b) =>
    a.trackType === b.trackType ? (a.trackIndex === b.trackIndex ? a.start - b.start : a.trackIndex - b.trackIndex) : a.trackType === 'video' ? -1 : 1,
  );
}

export interface LayoutComparison {
  ok: boolean;
  expectedPieces: number;
  actualPieces: number;
  mismatches: string[];
}

/** Күтілген және Premiere-ден қайта оқылған орналасуды салыстырады. */
export function compareLayouts(expected: TimelineClip[], actual: TimelineClip[], tolerance: number): LayoutComparison {
  const label = (clip: TimelineClip) => `${clip.trackType === 'video' ? 'V' : 'A'}${clip.trackIndex + 1}`;
  const want = sortClips(expected);
  const got = sortClips(actual);
  const mismatches: string[] = [];
  const tracks = new Set([...want, ...got].map(label));
  for (const track of tracks) {
    const wantOnTrack = want.filter((clip) => label(clip) === track);
    const gotOnTrack = got.filter((clip) => label(clip) === track);
    if (wantOnTrack.length !== gotOnTrack.length) {
      mismatches.push(`${track}: expected ${wantOnTrack.length} piece(s), found ${gotOnTrack.length}`);
      continue;
    }
    wantOnTrack.forEach((clip, index) => {
      const other = gotOnTrack[index]!;
      const fields: Array<keyof TimelineClip> = ['start', 'end', 'inPoint', 'outPoint'];
      const wrong = fields.filter((field) => Math.abs(Number(clip[field]) - Number(other[field])) > tolerance);
      if (wrong.length) {
        mismatches.push(`${track} piece ${index + 1}: ${wrong.map((field) => `${field} ${other[field]} (expected ${clip[field]})`).join(', ')}`);
      }
    });
  }
  return { ok: mismatches.length === 0, expectedPieces: want.length, actualPieces: got.length, mismatches: mismatches.slice(0, 20) };
}
