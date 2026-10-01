/**
 * CEP evalScript is single-flight. A JS timeout that starts a second native
 * call while the first callback is still outstanding wedges Premiere until
 * restart (GitHub issue 86).
 */

import { loadPanel } from '../helpers/panel.js';

describe('CEP evalScript single-flight', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not start a second evalScript until the first native callback runs, even after the waiter times out', () => {
    jest.useFakeTimers();
    const { bridge } = loadPanel();
    const evalCalls: Array<(result: string) => void> = [];

    bridge.csInterface = {
      getHostEnvironment: () => ({ appName: 'PPRO', appVersion: '26.0.0' }),
      evalScript: (_script: string, callback: (result: string) => void) => {
        evalCalls.push(callback);
      }
    };
    bridge.normalizeHostEnvironment = (value: unknown) => value;
    bridge.log = () => {};

    const waiterResults: string[] = [];
    bridge.executeExtendScript('return 1;', (err: Error | null) => {
      waiterResults.push(err ? err.message : 'ok');
    });

    expect(evalCalls).toHaveLength(1);

    bridge.executeExtendScript('return 2;', () => {});
    expect(evalCalls).toHaveLength(1);

    jest.advanceTimersByTime(45000);
    expect(waiterResults[0]).toMatch(/timed out after 45000ms/);
    expect(evalCalls).toHaveLength(1);

    evalCalls[0](JSON.stringify({ ok: true }));
    jest.advanceTimersByTime(0);

    expect(evalCalls).toHaveLength(2);
  });

  it('still prepends the prelude on the script handed to evalScript', () => {
    jest.useFakeTimers();
    const { bridge, handedToEvalScript } = loadPanel();
    bridge.log = () => {};
    bridge.executeExtendScript('return 1;', () => {});
    expect(handedToEvalScript()).toContain('function __mcpStringify');
    expect(handedToEvalScript().endsWith('return 1;')).toBe(true);
  });
});

describe('CEP panel auto-start', () => {
  it('starts the bridge when the panel initializes and a temp directory exists', () => {
    const { bridge } = loadPanel();
    const started: string[] = [];
    bridge.loadConfig = () => {};
    bridge.updateUI = () => {};
    bridge.startCommandPolling = () => {};
    bridge.checkForPackageUpdate = () => {};
    bridge.getTempDirectory = () => '/tmp/falconcut-bridge';
    bridge.startBridge = function () { started.push('started'); };
    bridge.csInterface = { getHostEnvironment: () => ({ appName: 'PPRO', appVersion: '26.0.0' }) };
    bridge.log = () => {};
    bridge.init();
    expect(started).toEqual(['started']);
  });
});

describe('CEP panel heartbeat', () => {
  it('writes bridge-heartbeat.json so the server can fail fast when Premiere is not listening', () => {
    const { bridge, fs } = loadPanel();
    bridge.getTempDirectory = () => '/tmp/falconcut-bridge';
    bridge.isConnected = true;

    bridge.writeHeartbeat();

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      '/tmp/falconcut-bridge/bridge-heartbeat.json',
      expect.stringMatching(/"started":true/),
    );
  });

  // FalconCut: Premiere ұзақ скриптті орындағанда панельдің сигналы тоқтайды
  it('marks itself busy until the script timeout before handing a script to Premiere', () => {
    jest.useFakeTimers();
    const { bridge, fs } = loadPanel();
    bridge.getTempDirectory = () => '/tmp/falconcut-bridge';
    bridge.isConnected = true;
    bridge.log = () => {};
    const order: string[] = [];
    fs.writeFileSync.mockImplementation((file: string, content: string) => {
      if (String(file).endsWith('bridge-heartbeat.json')) order.push(content);
    });
    bridge.csInterface = {
      getHostEnvironment: () => ({ appName: 'PPRO', appVersion: '26.0.0' }),
      evalScript: () => { order.push('evalScript'); },
    };
    bridge.normalizeHostEnvironment = (value: unknown) => value;

    const before = Date.now();
    bridge.executeExtendScript('return 1;', () => {}, 300000);

    expect(order).toHaveLength(2);
    expect(order[1]).toBe('evalScript');
    const beat = JSON.parse(order[0]!);
    expect(beat.started).toBe(true);
    expect(beat.busyUntil).toBeGreaterThanOrEqual(before + 305000);

    // Таймер арасында жазылған сигнал да белгіні сақтайды, скрипт біткенде ол алынады
    bridge.writeHeartbeat();
    expect(JSON.parse(order[2]!).busyUntil).toBe(beat.busyUntil);
    bridge.releaseEvalScript();
    bridge.writeHeartbeat();
    expect(JSON.parse(order[3]!).busyUntil).toBeUndefined();
    jest.useRealTimers();
  });
});
