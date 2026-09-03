import { describe, expect, it } from 'vitest';

import { FinderTrashPort, finderTrashArguments } from './finder-trash.js';

describe('FinderTrashPort', () => {
  it('passes the target path through osascript argv instead of interpolating it into the script', async () => {
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    const target = '/library/A file with spaces.jpg';
    const port = new FinderTrashPort((file, args) => {
      calls.push({ file, args });
      return Promise.resolve({ code: 0, stderr: '' });
    });

    const result = await port.moveToTrash(target);

    if (process.platform === 'darwin') {
      expect(result.ok).toBe(true);
      expect(calls).toEqual([{ file: 'osascript', args: finderTrashArguments(target) }]);
      expect(calls[0]?.args.at(-1)).toBe(target);
      expect(calls[0]?.args.join('\n')).not.toContain(`"${target}"`);
    } else {
      expect(result).toMatchObject({ ok: false, error: { code: 'unavailable' } });
      expect(calls).toEqual([]);
    }
  });
});
