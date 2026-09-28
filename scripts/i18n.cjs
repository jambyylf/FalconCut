#!/usr/bin/env node
// FalconCut: bash скрипттеріне арналған аударма көмекшісі.
// Мәтіндер locales/<тіл>.json файлдарынан алынады, әдепкі тіл — kk.
//
// Қолданылуы:
//   node scripts/i18n.cjs --export-sh      барлық мәтінді FCL_<кілт>='...' түрінде шығарады (bash eval үшін)
//   node scripts/i18n.cjs <кілт> [арг...]  бір мәтінді {0}, {1} орындарын толтырып шығарады
//
// Тілді таңдау реті: FALCONCUT_LANG орта айнымалысы → ~/.falconcut/config.json ішіндегі
// "language" → kk.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const SUPPORTED_LOCALES = ['kk', 'en'];
const DEFAULT_LOCALE = 'kk';
const LOCALES_DIR = path.join(__dirname, '..', 'locales');

function normalizeLocale(value) {
  const locale = String(value || '').trim().toLowerCase();
  return SUPPORTED_LOCALES.includes(locale) ? locale : null;
}

function readJson(filePath) {
  try {
    // Windows-та сақталған файлдың басында BOM болуы мүмкін — оны алып тастаймыз
    const raw = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

function resolveLocale() {
  const fromEnv = normalizeLocale(process.env.FALCONCUT_LANG);
  if (fromEnv) return fromEnv;
  const config = readJson(path.join(os.homedir(), '.falconcut', 'config.json'));
  return normalizeLocale(config.language) || DEFAULT_LOCALE;
}

function loadMessages(locale) {
  // Аудармасы жоқ кілт ағылшынша мәтінге түседі
  return Object.assign({}, readJson(path.join(LOCALES_DIR, 'en.json')), readJson(path.join(LOCALES_DIR, `${locale}.json`)));
}

function format(template, args) {
  return String(template).replace(/\{(\d+)\}/g, (match, index) => {
    const value = args[Number(index)];
    return value === undefined ? match : String(value);
  });
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

const messages = loadMessages(resolveLocale());
const [first, ...rest] = process.argv.slice(2);

if (first === '--export-sh') {
  const lines = Object.keys(messages)
    .filter((key) => /^[a-z0-9_.]+$/.test(key) && typeof messages[key] === 'string')
    .map((key) => `FCL_${key.replace(/\./g, '__')}=${shellQuote(messages[key])}`);
  process.stdout.write(`${lines.join('\n')}\n`);
} else if (first) {
  const template = typeof messages[first] === 'string' ? messages[first] : first;
  process.stdout.write(`${format(template, rest)}\n`);
} else {
  process.stderr.write('Usage: node scripts/i18n.cjs --export-sh | <key> [args...]\n');
  process.exitCode = 1;
}
