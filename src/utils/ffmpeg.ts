/**
 * FalconCut: ffmpeg арқылы медиа файлдан дыбыс үзіндісін оқу.
 *
 * Дыбыс моно, төмен жиілікте (мысалы 8 кГц), 16-биттік PCM түрінде stdout-тан
 * алынады. Видеоға тиіспейді, файлды өзгертпейді.
 */

import { spawn } from 'node:child_process';
import { parseSilencedetect } from './silence.js';

/** ffmpeg табылмағанда шығатын қате. */
export class FfmpegNotFoundError extends Error {
  readonly code = 'FFMPEG_NOT_FOUND';
  constructor(readonly command: string) {
    super(`ffmpeg was not found (${command})`);
    this.name = 'FfmpegNotFoundError';
  }
}

/** FALCONCUT_FFMPEG берілсе соны, әйтпесе PATH ішіндегі ffmpeg-ті қолданамыз. */
export function ffmpegCommand(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.FALCONCUT_FFMPEG?.trim();
  return configured ? configured : 'ffmpeg';
}

/** Орнату нұсқауы: Windows-та winget, macOS-та Homebrew. */
export function ffmpegInstallHint(platform: string = process.platform): string {
  if (platform === 'win32') return 'winget install Gyan.FFmpeg';
  if (platform === 'darwin') return 'brew install ffmpeg';
  return 'https://ffmpeg.org/download.html';
}

/** Файлдың [startSeconds, startSeconds + durationSeconds] бөлігінің дыбысы, −1…1 аралығында. */
export function decodeAudioWindow(
  mediaPath: string,
  startSeconds: number,
  durationSeconds: number,
  sampleRate: number,
  command: string = ffmpegCommand(),
): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-nostdin',
      '-ss', Math.max(0, startSeconds).toFixed(3),
      '-t', Math.max(0, durationSeconds).toFixed(3),
      '-i', mediaPath,
      '-vn',
      '-ac', '1',
      '-ar', String(sampleRate),
      '-f', 's16le',
      '-',
    ];
    let child;
    try {
      child = spawn(command, args, { windowsHide: true });
    } catch (error) {
      reject((error as NodeJS.ErrnoException).code === 'ENOENT' ? new FfmpegNotFoundError(command) : error);
      return;
    }
    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', (error: NodeJS.ErrnoException) => {
      reject(error.code === 'ENOENT' ? new FfmpegNotFoundError(command) : error);
    });
    child.on('close', (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim().slice(-500)}`));
        return;
      }
      const buffer = Buffer.concat(chunks);
      const samples = new Float32Array(buffer.length >> 1);
      for (let i = 0; i < samples.length; i++) samples[i] = buffer.readInt16LE(i * 2) / 32768;
      resolve(samples);
    });
  });
}

/**
 * Файлдың [startSeconds, startSeconds + durationSeconds] бөлігіндегі үнсіздіктер
 * (ffmpeg silencedetect). Аралықтар үзіндінің басынан бастап, секундпен.
 */
export function detectSilenceWindows(
  mediaPath: string,
  startSeconds: number,
  durationSeconds: number,
  thresholdDb: number,
  minSilenceSeconds: number,
  command: string = ffmpegCommand(),
): Promise<Array<[number, number]>> {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-nostdin',
      '-ss', Math.max(0, startSeconds).toFixed(3),
      '-t', Math.max(0, durationSeconds).toFixed(3),
      '-i', mediaPath,
      '-vn',
      '-af', `silencedetect=noise=${thresholdDb}dB:d=${minSilenceSeconds}`,
      '-f', 'null',
      '-',
    ];
    let child;
    try {
      child = spawn(command, args, { windowsHide: true });
    } catch (error) {
      reject((error as NodeJS.ErrnoException).code === 'ENOENT' ? new FfmpegNotFoundError(command) : error);
      return;
    }
    let stderr = '';
    child.stdout.on('data', () => {});
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', (error: NodeJS.ErrnoException) => {
      reject(error.code === 'ENOENT' ? new FfmpegNotFoundError(command) : error);
    });
    child.on('close', (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim().slice(-500)}`));
        return;
      }
      resolve(parseSilencedetect(stderr, durationSeconds));
    });
  });
}
