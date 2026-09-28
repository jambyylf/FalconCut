/**
 * FalconCut: қолданушыға көрсетілетін мәтіндерді locales/<тіл>.json файлдарынан алу.
 *
 * Әдепкі тіл — қазақша (kk). Тілді таңдау реті:
 *   1) FALCONCUT_LANG орта айнымалысы (kk | en)
 *   2) ~/.falconcut/config.json ішіндегі "language" (панельдегі «Тіл» тізімі осында жазады)
 *   3) kk
 *
 * MCP құралдарының аттары мен сипаттамалары әдейі ағылшынша қалады — оларды AI оқиды,
 * сондықтан бұл модуль тек CLI сияқты адам оқитын мәтіндерге қолданылады.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CONFIG_DIR_NAME, LANG_ENV } from './brand.js';

export const SUPPORTED_LOCALES = ['kk', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'kk';

export type Messages = Record<string, string>;
export type Translate = (key: string, ...args: Array<string | number>) => string;

function normalizeLocale(value: unknown): Locale | undefined {
  const locale = String(value ?? '').trim().toLowerCase();
  return (SUPPORTED_LOCALES as readonly string[]).includes(locale) ? (locale as Locale) : undefined;
}

function readJsonObject(path: string): Record<string, unknown> {
  try {
    // Windows-та сақталған файлдың басында BOM болуы мүмкін
    const parsed = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, '')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function resolveLocale(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): Locale {
  return (
    normalizeLocale(env[LANG_ENV]) ??
    normalizeLocale(readJsonObject(join(home, CONFIG_DIR_NAME, 'config.json')).language) ??
    DEFAULT_LOCALE
  );
}

/** Таңдалған тілдің мәтіндері; аудармасы жоқ кілт ағылшынша мәтінге түседі. */
export function loadMessages(localesDir: string, locale: Locale): Messages {
  const messages: Messages = {};
  const sources = [readJsonObject(join(localesDir, 'en.json')), readJsonObject(join(localesDir, `${locale}.json`))];
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (typeof value === 'string') messages[key] = value;
    }
  }
  return messages;
}

/** {0}, {1} ... орындарын аргументтермен толтырады. */
export function formatMessage(template: string, args: ReadonlyArray<string | number>): string {
  return template.replace(/\{(\d+)\}/g, (match, index: string) => {
    const value = args[Number(index)];
    return value === undefined ? match : String(value);
  });
}

export function createTranslator(messages: Messages): Translate {
  return (key, ...args) => formatMessage(messages[key] ?? key, args);
}
