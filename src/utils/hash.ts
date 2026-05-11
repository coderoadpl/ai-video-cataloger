/**
 * File hashing utilities
 * Uses partial content hashing for fast identification of large files.
 */

import { createHash } from 'node:crypto';
import { open, stat } from 'node:fs/promises';

const CHUNK_SIZE = 64 * 1024; // 64KB

/**
 * Generate a partial content hash for a file.
 * Reads first 64KB + last 64KB + includes file size in the hash.
 *
 * This is much faster than hashing entire files (especially for multi-GB videos)
 * while still being unique enough to identify files reliably.
 *
 * For a 2GB file:
 * - Full hash: reads 2GB, takes minutes
 * - Partial hash: reads ~128KB, takes milliseconds
 *
 * @param filePath - Path to the file
 * @returns Hex string of SHA256 hash (first 16 characters)
 */
export async function hashFile(filePath: string): Promise<string> {
  const fileStats = await stat(filePath);
  const fileSize = fileStats.size;

  const hash = createHash('sha256');

  // Include file size in hash for additional uniqueness
  hash.update(Buffer.from(fileSize.toString()));

  // Open file for reading
  const fileHandle = await open(filePath, 'r');

  try {
    // Read first chunk
    const firstChunk = Buffer.alloc(Math.min(CHUNK_SIZE, fileSize));
    await fileHandle.read(firstChunk, 0, firstChunk.length, 0);
    hash.update(firstChunk);

    // Read last chunk (if file is larger than one chunk)
    if (fileSize > CHUNK_SIZE) {
      const lastChunkSize = Math.min(CHUNK_SIZE, fileSize - CHUNK_SIZE);
      const lastChunk = Buffer.alloc(lastChunkSize);
      const lastChunkOffset = fileSize - lastChunkSize;
      await fileHandle.read(lastChunk, 0, lastChunkSize, lastChunkOffset);
      hash.update(lastChunk);
    }
  } finally {
    await fileHandle.close();
  }

  // Return first 16 characters of hex hash (64 bits - sufficient for uniqueness)
  return hash.digest('hex').substring(0, 16);
}

/**
 * Compute content hash with error handling.
 * Returns null if file cannot be read.
 *
 * @param filePath - Path to the file
 * @returns Hex string of hash or null on error
 */
export async function hashFileSafe(filePath: string): Promise<string | null> {
  try {
    return await hashFile(filePath);
  } catch {
    return null;
  }
}
