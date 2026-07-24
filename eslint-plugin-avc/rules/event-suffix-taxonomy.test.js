import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { it } from 'vitest';

import rule from './event-suffix-taxonomy.js';

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2023,
    sourceType: 'module',
    parser: tseslint.parser,
  },
});

it('event-suffix-taxonomy', () => {
  ruleTester.run('event-suffix-taxonomy', rule, {
    valid: [
      "export type ScanEvent = { type: 'folderSelected' } | { type: 'scanRequested' } | { type: 'scanCancelled' };",
      "export type ProcessingEvent = { type: 'videoAdded' };",
      "export type LockEvent = 'lockOpened' | 'lockClosed';",
      [
        "type FolderSelectedEvent = { type: 'folderSelected' };",
        "type ScanCancelledEvent = { type: 'scanCancelled' };",
        'export type CatalogEvent = FolderSelectedEvent | ScanCancelledEvent;',
      ].join('\n'),
      // Every exported union is inspected regardless of its alias name.
      "export type CatalogEvents = { type: 'folderSelected' } | { type: 'scanRequested' };",
      // Helper aliases with no statically determinable discriminant are skipped.
      "type FolderId = string; export type Folder = { id: FolderId };",
      'export type DynamicEvent = { type: string };',
    ],
    invalid: [
      {
        // Renaming the alias (`*Events`, not `*Event`) does not disable the taxonomy.
        code: "export type FooEvents = { type: 'deleteThing' } | { type: 'thingRemoved' };",
        errors: [{ messageId: 'badSuffix' }],
      },
      {
        // Exporting through an export list is still an export.
        code: [
          "type FooEvent = { type: 'deleteThing' } | { type: 'thingRemoved' };",
          'export type { FooEvent };',
        ].join('\n'),
        errors: [{ messageId: 'badSuffix' }],
      },
      {
        // A same-file union alias standing behind the exported name is resolved one level.
        code: [
          "type Inner = { type: 'deleteThing' } | { type: 'thingRemoved' };",
          'export type FooEvents = Inner;',
        ].join('\n'),
        errors: [{ messageId: 'badSuffix' }],
      },
      {
        code: "export type CatalogEvent = { type: 'deleteThing' } | { type: 'thingRemoved' };",
        errors: [{ messageId: 'badSuffix' }],
      },
      {
        code: "export type LockEvent = 'openLock' | 'lockOpened';",
        errors: [{ messageId: 'badSuffix' }],
      },
      {
        code: [
          "type DeleteThingEvent = { type: 'deleteThing' };",
          'export type CatalogEvent = DeleteThingEvent;',
        ].join('\n'),
        errors: [{ messageId: 'badSuffix' }],
      },
      {
        code: "export type CatalogEvent = { type: 'foo' } | { type: 'bar' };",
        errors: [{ messageId: 'badSuffix' }, { messageId: 'badSuffix' }],
      },
    ],
  });
});
