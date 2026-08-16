import type { Database } from 'sql.js';

import { normalizeTagName } from '@core/domain/index.js';

interface TagNormalizationTables {
  tags: string;
  fileTags: string;
  tagAliases: string;
}

const tagIdForName = (client: Database, table: string, name: string): number | null => {
  const result = client.exec(`SELECT tag_id FROM ${table} WHERE name = ?`, [name]);
  const value = result[0]?.values[0]?.[0];
  return typeof value === 'number' ? value : null;
};

export const normalizeStoredTagNames = (client: Database, tables: TagNormalizationTables): void => {
  const result = client.exec(`SELECT tag_id, name FROM ${tables.tags} ORDER BY tag_id`);
  for (const row of result[0]?.values ?? []) {
    const tagId = row[0];
    const name = row[1];
    if (typeof tagId !== 'number' || typeof name !== 'string') throw new Error(`Invalid tag row in ${tables.tags}`);
    const normalized = normalizeTagName(name);
    if (normalized === name) continue;
    if (normalized.length === 0) {
      client.run(`DELETE FROM ${tables.tagAliases} WHERE tag_id = ?`, [tagId]);
      client.run(`DELETE FROM ${tables.fileTags} WHERE tag_id = ?`, [tagId]);
      client.run(`DELETE FROM ${tables.tags} WHERE tag_id = ?`, [tagId]);
      continue;
    }
    const existingTagId = tagIdForName(client, tables.tags, normalized);
    if (existingTagId === null || existingTagId === tagId) {
      client.run(`UPDATE ${tables.tags} SET name = ? WHERE tag_id = ?`, [normalized, tagId]);
      continue;
    }
    client.run(
      `INSERT OR IGNORE INTO ${tables.fileTags} (fingerprint, config_id, tag_id)
       SELECT fingerprint, config_id, ? FROM ${tables.fileTags} WHERE tag_id = ?`,
      [existingTagId, tagId],
    );
    client.run(`UPDATE ${tables.tagAliases} SET tag_id = ? WHERE tag_id = ?`, [existingTagId, tagId]);
    client.run(`DELETE FROM ${tables.fileTags} WHERE tag_id = ?`, [tagId]);
    client.run(`DELETE FROM ${tables.tags} WHERE tag_id = ?`, [tagId]);
  }
};
