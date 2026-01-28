/**
 * File hashing utilities
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/**
 * Generate a SHA-256 hash of a file
 * Uses streaming to handle large files efficiently
 */
export async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);

    stream.on('data', (chunk) => {
      hash.update(chunk);
    });

    stream.on('end', () => {
      resolve(hash.digest('hex'));
    });

    stream.on('error', (error) => {
      reject(error);
    });
  });
}
