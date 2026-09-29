/**
 * FalconCut: екі дыбыстың ұқсас жерін табу (sync_by_audio үшін).
 *
 * Әдіс — GCC-PHAT: екі сигналдың кросс-корреляциясы, бірақ жиілік бойынша амплитудасы
 * теңестірілген (тек фаза қалады). Сондықтан екі түрлі микрофон мен түрлі дыбыс
 * деңгейі нәтижеге аз әсер етеді, ал шың өте айқын шығады.
 *
 * FFT осы файлда жазылған (radix-2, Cooley–Tukey) — сыртқы кітапхана керек емес.
 */

/** n-нен кіші емес ең жақын 2-нің дәрежесі. */
export function nextPowerOfTwo(n: number): number {
  let size = 1;
  while (size < n) size <<= 1;
  return size;
}

/**
 * Орнында (in-place) жылдам Фурье түрлендіруі. Ұзындық 2-нің дәрежесі болуы керек.
 * inverse=true — кері түрлендіру (1/N-ге бөлінеді).
 */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  if (n !== im.length || n === 0 || (n & (n - 1)) !== 0) {
    throw new Error(`fft length must be a power of two, got ${n}`);
  }

  // Биттерді кері ретке қою
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!; re[i] = re[j]!; re[j] = tr;
      const ti = im[i]!; im[i] = im[j]!; im[j] = ti;
    }
  }

  // Бұрылу коэффициенттері бір рет есептеледі: қайталанатын көбейту үлкен N-де қате жинайды
  const half = n >> 1;
  const cosTable = new Float64Array(half);
  const sinTable = new Float64Array(half);
  const sign = inverse ? 1 : -1;
  for (let k = 0; k < half; k++) {
    const angle = (2 * Math.PI * k) / n;
    cosTable[k] = Math.cos(angle);
    sinTable[k] = sign * Math.sin(angle);
  }

  for (let size = 2; size <= n; size <<= 1) {
    const halfSize = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < halfSize; k++) {
        const wr = cosTable[k * step]!;
        const wi = sinTable[k * step]!;
        const a = start + k;
        const b = a + halfSize;
        const br = re[b]! * wr - im[b]! * wi;
        const bi = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - br;
        im[b] = im[a]! - bi;
        re[a] = re[a]! + br;
        im[a] = im[a]! + bi;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] = re[i]! / n;
      im[i] = im[i]! / n;
    }
  }
}

export interface CorrelationPeak {
  /** target[t + lag] ≈ reference[t] болатын lag, секундпен. */
  lagSeconds: number;
  /** Ең биік шың мен одан 50 мс-тан алыс келесі шыңның қатынасы. Шу ≈ 1, анық сәйкестік ≥ 3. */
  confidence: number;
}

/**
 * reference сигналы target ішінде қай жерде (lag) тұрғанын табады.
 * Іздеу аралығы [minLagSeconds, maxLagSeconds] — target басынан бастап.
 */
export function findAudioOffset(
  reference: Float32Array,
  target: Float32Array,
  sampleRate: number,
  minLagSeconds: number,
  maxLagSeconds: number,
): CorrelationPeak {
  if (reference.length === 0 || target.length === 0) {
    return { lagSeconds: 0, confidence: 0 };
  }
  const n = nextPowerOfTwo(reference.length + target.length);
  const refRe = new Float64Array(n);
  const refIm = new Float64Array(n);
  const tgtRe = new Float64Array(n);
  const tgtIm = new Float64Array(n);
  refRe.set(withoutMean(reference));
  tgtRe.set(withoutMean(target));
  fft(refRe, refIm);
  fft(tgtRe, tgtIm);

  // TARGET · conj(REFERENCE), амплитудасы 1-ге теңестірілген (PHAT)
  for (let i = 0; i < n; i++) {
    const re = tgtRe[i]! * refRe[i]! + tgtIm[i]! * refIm[i]!;
    const im = tgtIm[i]! * refRe[i]! - tgtRe[i]! * refIm[i]!;
    const magnitude = Math.hypot(re, im) + 1e-12;
    tgtRe[i] = re / magnitude;
    tgtIm[i] = im / magnitude;
  }
  fft(tgtRe, tgtIm, true);

  const minLag = Math.ceil(minLagSeconds * sampleRate);
  const maxLag = Math.floor(maxLagSeconds * sampleRate);
  const at = (lag: number) => Math.abs(tgtRe[((lag % n) + n) % n]!);

  let bestLag = minLag;
  let bestValue = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const value = at(lag);
    if (value > bestValue) {
      bestValue = value;
      bestLag = lag;
    }
  }

  // Парабола арқылы бір үлгіден кіші дәлдік
  let refined = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const y0 = at(bestLag - 1);
    const y1 = bestValue;
    const y2 = at(bestLag + 1);
    const denominator = y0 - 2 * y1 + y2;
    if (denominator !== 0) refined = bestLag + (0.5 * (y0 - y2)) / denominator;
  }

  const guard = Math.max(1, Math.round(0.05 * sampleRate));
  let second = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (Math.abs(lag - bestLag) <= guard) continue;
    const value = at(lag);
    if (value > second) second = value;
  }

  return {
    lagSeconds: refined / sampleRate,
    confidence: second > 0 ? bestValue / second : bestValue > 0 ? Number.POSITIVE_INFINITY : 0,
  };
}

function withoutMean(samples: Float32Array): Float64Array {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]!;
  const mean = samples.length ? sum / samples.length : 0;
  const out = new Float64Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i]! - mean;
  return out;
}

export interface OffsetPoint {
  timelineSeconds: number;
  offsetSeconds: number;
  confidence: number;
}

export interface OffsetSummary {
  meanOffsetSeconds: number;
  medianOffsetSeconds: number;
  /** Нүктелер арасындағы ең үлкен айырма (max − min), секунд. */
  driftSeconds: number;
  /** Уақыт өте ығысудың өзгеру жылдамдығы (сызықтық регрессия), секунд/сағат. */
  driftPerHourSeconds: number;
  minConfidence: number;
  confidenceLevel: 'high' | 'medium' | 'low';
  reliable: boolean;
  reasons: string[];
}

/** Бірнеше нүктедегі өлшемнен орташа мәнді, дрейфті және сенімділікті есептейді. */
export function summarizeOffsets(
  points: OffsetPoint[],
  thresholds: { minConfidence: number; maxDriftSeconds: number },
): OffsetSummary {
  if (points.length === 0) {
    return {
      meanOffsetSeconds: 0,
      medianOffsetSeconds: 0,
      driftSeconds: 0,
      driftPerHourSeconds: 0,
      minConfidence: 0,
      confidenceLevel: 'low',
      reliable: false,
      reasons: ['no measurements'],
    };
  }
  const offsets = points.map((point) => point.offsetSeconds);
  const sorted = [...offsets].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  const mean = offsets.reduce((sum, value) => sum + value, 0) / offsets.length;
  const drift = sorted[sorted.length - 1]! - sorted[0]!;
  const minConfidence = Math.min(...points.map((point) => point.confidence));

  let slope = 0;
  if (points.length > 1) {
    const meanTime = points.reduce((sum, point) => sum + point.timelineSeconds, 0) / points.length;
    let numerator = 0;
    let denominator = 0;
    for (const point of points) {
      numerator += (point.timelineSeconds - meanTime) * (point.offsetSeconds - mean);
      denominator += (point.timelineSeconds - meanTime) ** 2;
    }
    slope = denominator > 0 ? numerator / denominator : 0;
  }

  const reasons: string[] = [];
  if (minConfidence < thresholds.minConfidence) {
    reasons.push(
      `lowest confidence ${round(minConfidence, 2)} is below ${thresholds.minConfidence}: the two recordings may not share the same sound at every measured point`,
    );
  }
  if (drift > thresholds.maxDriftSeconds) {
    reasons.push(
      `the offset changes by ${round(drift, 4)}s between measurements (limit ${round(thresholds.maxDriftSeconds, 4)}s): one constant shift cannot keep the whole clip in sync`,
    );
  }

  return {
    meanOffsetSeconds: mean,
    medianOffsetSeconds: median,
    driftSeconds: drift,
    driftPerHourSeconds: slope * 3600,
    minConfidence,
    confidenceLevel: minConfidence >= 4 ? 'high' : minConfidence >= thresholds.minConfidence ? 'medium' : 'low',
    reliable: reasons.length === 0,
    reasons,
  };
}

export function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
