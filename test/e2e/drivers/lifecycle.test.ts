import { describe, expect, it } from 'vitest';

import { CliDriver } from './cli-driver.js';
import { GuiDriver } from './gui-driver.js';

describe('pipeline driver lifecycle', () => {
  it('reports the cli driver as closed only after close()', async () => {
    const driver = new CliDriver();
    expect(driver.isClosed()).toBe(false);
    await driver.close();
    expect(driver.isClosed()).toBe(true);
  });

  it('reports the gui driver as closed only after close()', async () => {
    const driver = new GuiDriver();
    expect(driver.isClosed()).toBe(false);
    await driver.close();
    expect(driver.isClosed()).toBe(true);
  });
});
