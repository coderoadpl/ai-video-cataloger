import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCliCommand } from '@/hooks/use-cli-command';
import { installElectronApiMock, type ElectronApiMock } from '@/test/electron-api-mock';

// Flush pending microtasks/macrotasks so the hook can learn its own spawnId
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const completedEvent: JsonEvent = {
  type: 'completed',
  timestamp: '2026-01-01T00:00:00.000Z',
  data: { ok: true },
};

describe('useCliCommand', () => {
  let mock: ElectronApiMock;

  beforeEach(() => {
    mock = installElectronApiMock();
  });

  it('T4: events with a foreign spawnId do not resolve or advance the command', async () => {
    const { result } = renderHook(() => useCliCommand());
    const runCli = result.current;

    let settled = false;
    const jsonEvents: JsonEvent[] = [];
    const lines: string[] = [];
    const promise = runCli(['scan', '/videos'], {
      onJson: (event) => jsonEvents.push(event),
      onLine: (line) => lines.push(line),
    }).then((res) => {
      settled = true;
      return res;
    });

    const spawn = await mock.waitForSpawn();
    await flush();

    // Events from a concurrent foreign process must not leak in or settle us
    mock.emitStdout('foreign-spawn', 'foreign line');
    mock.emitJson('foreign-spawn', completedEvent);
    mock.emitExit('foreign-spawn', 0, null);
    await flush();

    expect(settled).toBe(false);
    expect(jsonEvents).toHaveLength(0);
    expect(lines).toHaveLength(0);

    // The matching spawnId exit drives the command to completion
    mock.emitStdout(spawn.spawnId, 'own line');
    mock.emitJson(spawn.spawnId, completedEvent);
    mock.emitExit(spawn.spawnId, 0, null);

    const res = await promise;
    expect(settled).toBe(true);
    expect(res.code).toBe(0);
    expect(res.events).toEqual([completedEvent]);
    expect(jsonEvents).toEqual([completedEvent]);
    expect(lines).toEqual(['own line']);

    // All listeners are cleaned up after completion
    expect(mock.listenerCounts()).toEqual({ stdout: 0, stderr: 0, json: 0, exit: 0 });
  });

  it('T7: aborting via AbortSignal calls cli.kill with the own spawnId', async () => {
    const { result } = renderHook(() => useCliCommand());
    const runCli = result.current;

    mock.queueSpawnId('spawn-own');
    const controller = new AbortController();
    const promise = runCli(['process', '/videos/a.mp4'], {}, { signal: controller.signal });

    const spawn = await mock.waitForSpawn();
    await flush();
    expect(spawn.spawnId).toBe('spawn-own');
    expect(mock.killed).toHaveLength(0);

    controller.abort();
    expect(mock.killed).toEqual(['spawn-own']);

    // The killed process exits with SIGTERM
    mock.emitExit('spawn-own', null, 'SIGTERM');
    const res = await promise;
    expect(res.code).toBeNull();
    expect(res.signal).toBe('SIGTERM');
  });

  it('always spawns in JSON mode and forwards stderr lines', async () => {
    const { result } = renderHook(() => useCliCommand());

    const lines: Array<{ line: string; source: string }> = [];
    const promise = result.current(['doctor', '--json'], {
      onLine: (line, source) => lines.push({ line, source }),
    });

    const spawn = await mock.waitForSpawn();
    await flush();
    expect(spawn.options.json).toBe(true);

    mock.emitStderr(spawn.spawnId, 'warning: something');
    mock.emitExit(spawn.spawnId, 0, null);

    await promise;
    expect(lines).toEqual([{ line: 'warning: something', source: 'stderr' }]);
  });
});
