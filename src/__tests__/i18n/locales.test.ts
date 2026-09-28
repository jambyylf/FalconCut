/**
 * FalconCut: аударма файлдарын (locales/*.json) және оларды қолданатын кодты тексеру.
 *
 * Мақсаты — қолданушы ешқашан «panel.status.title» сияқты шикі кілтті немесе
 * латын әріптерімен бұзылған қазақ сөзін көрмеуі.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

import { createTranslator, formatMessage, loadMessages, resolveLocale } from '../../i18n.js';

const ROOT = path.join(__dirname, '..', '..', '..');
const LOCALES_DIR = path.join(ROOT, 'locales');

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(readFileSync(path.join(LOCALES_DIR, `${locale}.json`), 'utf8')) as Record<string, string>;
}

const en = readLocale('en');
const kk = readLocale('kk');

function placeholders(text: string): string {
  return (text.match(/\{\d+\}/g) ?? []).sort().join(',');
}

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), 'utf8');
}

function collect(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => match[1] as string);
}

describe('locales/*.json', () => {
  it('has the same keys and placeholders in kk and en', () => {
    expect(Object.keys(kk).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en)) {
      expect({ key, placeholders: placeholders(kk[key] ?? '') }).toEqual({ key, placeholders: placeholders(en[key] ?? '') });
    }
  });

  it('never mixes Latin and Cyrillic letters inside one Kazakh word', () => {
    // Жиі кездесетін қате: «і» орнына латын «i», «һ» орнына «h», «о» орнына латын «o».
    const mixed: string[] = [];
    for (const [key, value] of Object.entries(kk)) {
      for (const word of value.split(/[^\p{L}]+/u)) {
        if (/\p{Script=Cyrillic}/u.test(word) && /\p{Script=Latin}/u.test(word)) mixed.push(`${key}: ${word}`);
      }
    }
    expect(mixed).toEqual([]);
  });

  it('uses the Kazakh-specific letters, so the file really is Kazakh', () => {
    const text = Object.values(kk).join(' ');
    for (const letter of ['ә', 'ғ', 'қ', 'ң', 'ө', 'ұ', 'ү', 'і']) {
      expect(text).toContain(letter);
    }
  });
});

describe('every translation key used in code exists', () => {
  const used = new Set<string>([
    ...collect(read('src/cli.ts'), /\bt\('([a-z0-9_.]+)'/g),
    // t('…') ғана емес, кез келген 'panel.…' / 'meta.…' жолы: t(ok ? 'panel.last.success' : …) да ілігеді
    ...collect(read('cep-plugin/bridge-cep.js'), /'((?:panel|meta)\.[a-z0-9_.]*[a-z0-9_])'/g),
    ...collect(read('cep-plugin/index.html'), /data-i18n(?:-placeholder)?="([^"]+)"/g),
    // Кезектегі команда күйі кілті динамикалық құрылады: 'panel.queue.' + status
    'panel.queue.pending',
    'panel.queue.executing',
    'panel.queue.completed',
  ]);
  for (const file of readdirSync(path.join(ROOT, 'scripts'))) {
    if (file.endsWith('.sh')) {
      for (const key of collect(read(`scripts/${file}`), /\$\(t ([a-z]+\.[a-z0-9_.]+)/g)) used.add(key);
    }
    if (file.endsWith('.ps1')) {
      for (const key of collect(read(`scripts/${file}`), /\(T '([a-z0-9_.]+)'/g)) used.add(key);
    }
  }

  it('finds keys in every consumer', () => {
    expect(used.size).toBeGreaterThan(100);
  });

  it.each([...used].sort())('%s', (key) => {
    expect(en[key]).toEqual(expect.any(String));
    expect(kk[key]).toEqual(expect.any(String));
  });
});

describe('CEP panel HTML', () => {
  it('ships the Kazakh text as the default, identical to kk.json', () => {
    const html = read('cep-plugin/index.html');
    const pairs = [...html.matchAll(/<[^>]*\sdata-i18n="([^"]+)"[^>]*>([^<]*)</g)];
    // data-i18n белгісі бар әр элемент тексерілуі керек — біреуі де құр қалмасын
    const translatedElements = (html.match(/\sdata-i18n="/g) ?? []).length;
    expect(translatedElements).toBeGreaterThan(0);
    expect(pairs.length).toBe(translatedElements);
    for (const [, key, text] of pairs) {
      expect({ key, text: (text ?? '').trim() }).toEqual({ key, text: kk[key as string] });
    }
  });
});

describe('CLI translator (src/i18n.ts)', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), 'falconcut-i18n-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('defaults to Kazakh', () => {
    expect(resolveLocale({}, home)).toBe('kk');
  });

  it('reads the language the panel saved in ~/.falconcut/config.json', () => {
    mkdirSync(path.join(home, '.falconcut'));
    writeFileSync(path.join(home, '.falconcut', 'config.json'), JSON.stringify({ language: 'en' }));
    expect(resolveLocale({}, home)).toBe('en');
  });

  it('lets FALCONCUT_LANG override the saved language and ignores unknown values', () => {
    mkdirSync(path.join(home, '.falconcut'));
    writeFileSync(path.join(home, '.falconcut', 'config.json'), JSON.stringify({ language: 'en' }));
    expect(resolveLocale({ FALCONCUT_LANG: 'KK' }, home)).toBe('kk');
    expect(resolveLocale({ FALCONCUT_LANG: 'ru' }, home)).toBe('en');
  });

  it('formats placeholders and falls back to English, then to the key', () => {
    const t = createTranslator({ ...loadMessages(LOCALES_DIR, 'kk'), 'only.en': 'x' });
    expect(t('cli.unknown_command', '--foo')).toBe('Белгісіз команда: --foo');
    expect(t('missing.key')).toBe('missing.key');
    expect(formatMessage('{1} / {0} / {2}', ['a', 'b'])).toBe('b / a / {2}');
  });
});

describe('CEP panel translator (cep-plugin/bridge-cep.js)', () => {
  function loadRealPanel(): Record<string, any> {
    const sandbox: Record<string, unknown> = {
      window: {},
      document: { addEventListener() {}, getElementById: () => null },
      navigator: {},
      setTimeout,
      clearTimeout,
      setInterval: () => 0,
      console: { log() {}, warn() {}, error() {} },
      process: { env: {} },
      __dirname: path.join(ROOT, 'cep-plugin'),
      require: (name: string) => {
        if (name === 'fs') return jest.requireActual('fs');
        if (name === 'path') return path;
        if (name === 'os') return { platform: () => 'darwin', homedir: () => path.join(tmpdir(), 'falconcut-no-home'), tmpdir: () => '/tmp' };
        return {};
      },
      CSInterface: function () { return {}; },
    };
    vm.createContext(sandbox);
    vm.runInContext(read('cep-plugin/bridge-cep.js'), sandbox);
    const Bridge = (sandbox.window as { MCPPremiereBridge: { prototype: object } }).MCPPremiereBridge;
    return Object.create(Bridge.prototype) as Record<string, any>;
  }

  it('switches between Kazakh and English', () => {
    const bridge = loadRealPanel();
    expect(bridge.setLocale('kk')).toBe('kk');
    expect(bridge.t('panel.log.processing', 'cmd-1')).toBe('Команда өңделуде: cmd-1');
    expect(bridge.setLocale('en')).toBe('en');
    expect(bridge.t('panel.log.processing', 'cmd-1')).toBe('Processing command: cmd-1');
    expect(bridge.setLocale('xx')).toBe('kk');
  });
});

describe('scripts/i18n.cjs (used by the macOS installer and doctor)', () => {
  function run(args: string[], env: NodeJS.ProcessEnv): string {
    const home = mkdtempSync(path.join(tmpdir(), 'falconcut-i18n-home-'));
    try {
      return execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'i18n.cjs'), ...args], {
        env: { ...process.env, FALCONCUT_LANG: '', HOME: home, USERPROFILE: home, ...env },
        encoding: 'utf8',
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }

  it('prints Kazakh by default and English on request', () => {
    expect(run(['doctor.failed', '2'], {}).trim()).toBe('Тексеріс 2 ақау тапты.');
    expect(run(['doctor.failed', '2'], { FALCONCUT_LANG: 'en' }).trim()).toBe('The check found 2 problem(s).');
  });

  it('exports shell-safe variables for bash', () => {
    const exported = run(['--export-sh'], {});
    expect(exported).toContain("FCL_doctor__passed='Барлық міндетті тексерістер сәтті өтті.'");
    // Бір тырнақша (Claude Code's) bash үшін '\'' түрінде экрандалуы керек
    const english = run(['--export-sh'], { FALCONCUT_LANG: 'en' });
    expect(english).toContain(
      "FCL_doctor__cli_missing='falconcut-mcp is not on PATH. Claude Code'\\''s .mcp.json needs it: run npm link in the FalconCut folder'",
    );
  });
});
