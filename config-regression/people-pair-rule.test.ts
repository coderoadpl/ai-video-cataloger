import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('PE18 specifies either API pair member and limits the GUI override to named pairs', () => {
  const prd = readFileSync(new URL('../tasks/prd-people-pair-review.md', import.meta.url), 'utf8');
  expect(prd).toContain('The API accepts either pair member as `survivorPersonId`, regardless of names.');
  expect(prd).toContain('The GUI offers the override only for named/named pairs.');
});
