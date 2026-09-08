import { ChildProcess } from 'node:child_process';
import { expect, it, vi } from 'vitest';

import { GuiDriver } from './gui-driver.js';

it('keeps the application handle and fixtures live when shutdown rejects', async () => {
  const driver = new GuiDriver();
  const app = { close: vi.fn().mockRejectedValue(new Error('shutdown rejected')), process: () => new ChildProcess() };
  Reflect.set(driver, 'app', app);
  await expect(driver.close()).rejects.toThrow('shutdown rejected');
  expect(driver.isClosed()).toBe(false);
  expect(Reflect.get(driver, 'app')).toBe(app);
});

it('does not mark closed until the child process has exited', async () => {
  const driver = new GuiDriver();
  const child = new ChildProcess();
  Reflect.set(driver, 'app', { close: vi.fn().mockResolvedValue(undefined), process: () => child });
  const closing = driver.close();
  await Promise.resolve();
  expect(driver.isClosed()).toBe(false);
  Reflect.set(child, 'exitCode', 0);
  child.emit('exit', 0, null);
  await closing;
  expect(driver.isClosed()).toBe(true);
});
