import type { FileSystemPort, PhotosStore } from '../ports.js';

export const photoArtifactsRoot = (fs: FileSystemPort, photos: PhotosStore): string =>
  fs.join(fs.dirname(photos.databasePath()), 'photo-artifacts');

export const photoProxyPath = (fs: FileSystemPort, root: string, fingerprint: string): string =>
  fs.join(root, 'proxies', `${fingerprint}.jpg`);

export const photoThumbPath = (fs: FileSystemPort, root: string, fingerprint: string): string =>
  fs.join(root, 'thumbs', `${fingerprint}.jpg`);
