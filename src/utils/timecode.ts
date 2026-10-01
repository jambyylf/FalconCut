/**
 * FalconCut: уақытты оқу — секундпен (22.12) немесе Premiere көрсететін таймкодпен
 * ("00:00:22:03"). Таймкодтағы кадр секвенцияның кадр жиілігімен есептеледі.
 */

export type TimeInput = number | string;

/**
 * Секундқа айналдырады. Таймкод (HH:MM:SS:FF) секвенцияның бастапқы таймкодынан
 * (zeroPoint) бастап санағанда таймлайн уақытына айналады. Drop-frame (;) қабылданбайды.
 */
export function parseTimeInput(value: TimeInput, frameSeconds: number, zeroPoint = 0): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Invalid time: ${value}`);
    return value;
  }
  const text = value.trim();
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (text.includes(';')) {
    throw new Error(`Drop-frame timecode "${text}" is not supported; give the time in seconds instead.`);
  }
  const match = /^(\d+):(\d{1,2}):(\d{1,2}):(\d+)$/.exec(text);
  if (!match) throw new Error(`Invalid time "${text}": use seconds (22.12) or a timecode (00:00:22:03).`);
  const [hours, minutes, seconds, frames] = match.slice(1).map(Number) as [number, number, number, number];
  const fps = Math.round(1 / frameSeconds);
  if (minutes > 59 || seconds > 59 || frames >= fps) {
    throw new Error(`Invalid timecode "${text}" for ${fps} fps.`);
  }
  const totalFrames = ((hours * 60 + minutes) * 60 + seconds) * fps + frames;
  return Math.max(0, totalFrames * frameSeconds - zeroPoint);
}

/** Секундты таймкодқа (HH:MM:SS:FF) айналдырады — жауапта адамға көрсету үшін. */
export function formatTimecode(seconds: number, frameSeconds: number, zeroPoint = 0): string {
  const fps = Math.round(1 / frameSeconds);
  const totalFrames = Math.round((seconds + zeroPoint) / frameSeconds);
  const frames = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor(totalSeconds / 60) % 60)}:${pad(totalSeconds % 60)}:${pad(frames)}`;
}
