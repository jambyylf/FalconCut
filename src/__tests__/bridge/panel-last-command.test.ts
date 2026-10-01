/**
 * FalconCut: панельдің «Соңғы команда» бөлімі және сервердің команда файлына
 * жазатын "tool" өрісі. Бұл тек көрсетуге арналған — команданы орындау
 * тәртібі өзгермегенін де тексереміз.
 */

import { promises as fs } from 'fs';

import { PremiereProBridge } from '../../bridge/index.js';
import { runWithToolName } from '../../bridge/tool-context.js';
import { loadPanel } from '../helpers/panel.js';

jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    access: jest.fn(),
    readdir: jest.fn(),
    writeFile: jest.fn(),
    readFile: jest.fn(),
    unlink: jest.fn(),
    rename: jest.fn(),
    rm: jest.fn(),
  },
}));

type FakeElement = { hidden: boolean; textContent: string; className: string };

function fakeDocument(): { document: Record<string, unknown>; elements: Record<string, FakeElement> } {
  const elements: Record<string, FakeElement> = {};
  for (const id of ['lastCommandEmpty', 'lastCommandBody', 'lastCommandTool', 'lastCommandTime', 'lastCommandResult']) {
    elements[id] = { hidden: id === 'lastCommandBody', textContent: '', className: '' };
  }
  return {
    elements,
    document: {
      addEventListener() {},
      getElementById: (id: string) => elements[id] ?? null,
      readyState: 'complete',
    },
  };
}

describe('CEP panel: «Соңғы команда»', () => {
  it.each([
    [{ success: true, result: { success: true, sequences: [] } }, true],
    [{ success: true, result: 'cep-ok' }, true],
    [{ success: true, result: { success: false, error: 'No active sequence' } }, false],
    [{ success: false, error: 'Script validation failed' }, false],
    [{ error: 'Unexpected token' }, false],
    [null, false],
  ])('treats %j as success=%s', (response, expected) => {
    const { bridge } = loadPanel();
    expect(bridge.isSuccessfulResponse(response)).toBe(expected);
  });

  it('shows the tool name, the time and a green or red result badge', () => {
    const { document, elements } = fakeDocument();
    const { bridge } = loadPanel({ document });

    bridge.recordLastCommand({ id: 'c1', tool: 'list_sequences' }, { success: true, result: { success: true } });
    expect(elements.lastCommandEmpty?.hidden).toBe(true);
    expect(elements.lastCommandBody?.hidden).toBe(false);
    expect(elements.lastCommandTool?.textContent).toBe('list_sequences');
    expect(elements.lastCommandTime?.textContent).toMatch(/^\d\d:\d\d:\d\d$/);
    expect(elements.lastCommandResult?.className).toBe('result-badge success');

    bridge.recordLastCommand({ id: 'c2' }, { success: true, result: { success: false } });
    // Құрал аты жоқ ескі командалар «Белгісіз құрал» деп көрсетіледі (тестте аударма жүктелмейді)
    expect(elements.lastCommandTool?.textContent).toBe('panel.last.unknown_tool');
    expect(elements.lastCommandResult?.className).toBe('result-badge error');
  });

  it('records the command after the response is published, without changing the response', () => {
    const { document } = fakeDocument();
    const { bridge, fs: panelFs } = loadPanel({ document });
    const written: Array<[string, string]> = [];
    (panelFs as unknown as { readFileSync: () => string }).readFileSync = () =>
      JSON.stringify({ id: 'c3', tool: 'apply_effect', script: 'return 1;' });
    panelFs.writeFileSync.mockImplementation((file: string, data: string) => written.push([file, data]));
    bridge.addToQueue = () => {};
    bridge.updateCommandStatus = () => {};
    bridge.executeCommand = (_command: unknown, done: (result: unknown) => void) =>
      done({ success: true, result: { success: false, error: 'Effect not found' } });

    bridge.processCommandFile('/tmp/falconcut-bridge/command-c3.json');

    expect(bridge.lastCommand.tool).toBe('apply_effect');
    expect(bridge.lastCommand.ok).toBe(false);
    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0]?.[1] ?? '{}')).toEqual({ success: true, result: { success: false, error: 'Effect not found' } });
  });

  it('never lets a display error break command processing', () => {
    const { bridge, fs: panelFs } = loadPanel();
    let published = false;
    (panelFs as unknown as { readFileSync: () => string }).readFileSync = () => JSON.stringify({ id: 'c4', script: 'return 1;' });
    panelFs.writeFileSync.mockImplementation(() => { published = true; });
    bridge.addToQueue = () => {};
    bridge.updateCommandStatus = () => {};
    bridge.recordLastCommand = () => { throw new Error('display broke'); };
    bridge.executeCommand = (_command: unknown, done: (result: unknown) => void) => done({ success: true, result: 1 });

    expect(() => bridge.processCommandFile('/tmp/falconcut-bridge/command-c4.json')).not.toThrow();
    expect(published).toBe(true);
  });

  // FalconCut: «Қайта жүктеу»-ден кейін тірі қалған ескі бет бір команданы екінші рет орындамауы керек
  it('claims a command by renaming it before reading, so a second panel instance cannot run it again', () => {
    const { bridge, fs: panelFs } = loadPanel();
    const stub = panelFs as unknown as {
      renameSync: (from: string, to: string) => void;
      readFileSync: (file: string) => string;
      unlinkSync: (file: string) => void;
    };
    const renamed: string[][] = [];
    const read: string[] = [];
    const removed: string[] = [];
    stub.renameSync = (from, to) => { renamed.push([from, to]); };
    stub.readFileSync = (file) => { read.push(file); return JSON.stringify({ id: 'c5', script: 'return 1;' }); };
    stub.unlinkSync = (file) => { removed.push(file); };
    bridge.addToQueue = () => {};
    bridge.updateCommandStatus = () => {};
    let runs = 0;
    bridge.executeCommand = (_command: unknown, done: (result: unknown) => void) => { runs++; done({ success: true, result: 1 }); };

    bridge.processCommandFile('/tmp/falconcut-bridge/command-c5.json');

    expect(renamed[0]).toEqual(['/tmp/falconcut-bridge/command-c5.json', '/tmp/falconcut-bridge/claimed-c5.json']);
    expect(read).toEqual(['/tmp/falconcut-bridge/claimed-c5.json']);
    expect(removed).toContain('/tmp/falconcut-bridge/claimed-c5.json');
    expect(runs).toBe(1);

    // Екінші дана: файлды біреу алып қойған — rename сәтсіз, команда қайта орындалмайды
    stub.renameSync = () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); };
    bridge.processCommandFile('/tmp/falconcut-bridge/command-c5.json');
    expect(runs).toBe(1);
  });
});

describe('server: "tool" field in the command file', () => {
  const mockFs = fs as jest.Mocked<typeof fs>;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FALCONCUT_BRIDGE_DIR = '/tmp/falconcut-bridge-test';
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.access.mockRejectedValue(new Error('Not found'));
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.rename.mockResolvedValue(undefined);
    mockFs.unlink.mockResolvedValue(undefined);
    mockFs.readFile.mockResolvedValue(JSON.stringify({ success: true, result: { success: true } }));
  });

  afterEach(() => {
    delete process.env.FALCONCUT_BRIDGE_DIR;
  });

  function writtenCommand(): Record<string, unknown> {
    const call = mockFs.writeFile.mock.calls.find(([file]) => String(file).includes('.tmp-'));
    return JSON.parse(String(call?.[1] ?? '{}')) as Record<string, unknown>;
  }

  it('names the MCP tool that produced the command', async () => {
    const bridge = new PremiereProBridge();
    await bridge.initialize();
    await runWithToolName('list_sequences', () => bridge.executeScript('return 1;'));
    expect(writtenCommand().tool).toBe('list_sequences');
  });

  it('leaves the command unchanged outside a tool call', async () => {
    const bridge = new PremiereProBridge();
    await bridge.initialize();
    await bridge.executeScript('return 1;');
    expect(Object.keys(writtenCommand()).sort()).toEqual(['id', 'script', 'timestamp']);
  });
});
