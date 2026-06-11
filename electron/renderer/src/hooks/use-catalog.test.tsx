import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCliCommand } from '@/hooks/use-cli-command';
import {
  useCatalog,
  keyOf,
  type FolderScanResult,
  type ScannedVideo,
  type RefreshOptions,
  type UseCatalogResult,
} from '@/hooks/use-catalog';
import { mediaUrl } from '@/lib/media-url';
import { installElectronApiMock, type ElectronApiMock } from '@/test/electron-api-mock';
import type { VideoArtifacts } from '@/components/video-list';

const FOLDER = '/videos';

// Flush pending microtasks/macrotasks so the hook can learn its own spawnId
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const makeArtifacts = (overrides: Partial<VideoArtifacts> = {}): VideoArtifacts => ({
  framePaths: null,
  transcriptContent: null,
  transcriptPath: null,
  summary: null,
  summaryPath: null,
  thumbnailPath: null,
  thumbnailMtime: null,
  newFilename: null,
  ...overrides,
});

const makeVideo = (overrides: Partial<ScannedVideo> & { path: string }): ScannedVideo => ({
  filename: overrides.path.split('/').pop() ?? '',
  size: 1000,
  sizeFormatted: '1.0 KB',
  duration: 60,
  durationFormatted: '1:00',
  status: 'pending',
  errorMessage: null,
  contentHash: null,
  artifacts: makeArtifacts(),
  ...overrides,
});

const makeScan = (videos: ScannedVideo[]): FolderScanResult => ({
  folder: FOLDER,
  databasePath: `${FOLDER}/.ai-video-cataloger/catalog.db`,
  videos,
  summary: {
    total: videos.length,
    tracked: 0,
    pending: 0,
    inProgress: 0,
    completed: 0,
    error: 0,
    notTracked: 0,
  },
});

const renderCatalog = () =>
  renderHook(() => {
    const runCli = useCliCommand();
    return useCatalog(FOLDER, runCli);
  });

/** Drive a refresh() through the mocked CLI: spawn -> scan json -> exit 0. */
async function refreshWith(
  mock: ElectronApiMock,
  result: { current: UseCatalogResult },
  scan: FolderScanResult,
  opts?: RefreshOptions
): Promise<void> {
  await act(async () => {
    const promise = result.current.refresh(opts);
    const spawn = await mock.waitForSpawn();
    await flush();
    mock.emitJson(spawn.spawnId, {
      type: 'completed',
      timestamp: '2026-01-01T00:00:00.000Z',
      data: scan as unknown as Record<string, unknown>,
    });
    mock.emitExit(spawn.spawnId, 0, null);
    await promise;
  });
}

describe('useCatalog', () => {
  let mock: ElectronApiMock;

  beforeEach(() => {
    mock = installElectronApiMock();
  });

  it('T1: selection survives a rename (same contentHash, new path/filename)', async () => {
    const { result } = renderCatalog();

    const original = makeVideo({ path: '/videos/raw-clip.mp4', contentHash: 'hash-a', status: 'completed' });
    const other = makeVideo({ path: '/videos/other.mp4', contentHash: 'hash-b' });

    await refreshWith(mock, result, makeScan([original, other]));
    act(() => {
      result.current.selectKey(keyOf(original));
    });
    expect(result.current.selectedVideo?.path).toBe('/videos/raw-clip.mp4');

    // refresh() returns the same contentHash under a new path/filename
    const renamed = makeVideo({
      path: '/videos/2026-01-01-cooking-tutorial.mp4',
      contentHash: 'hash-a',
      status: 'completed',
    });
    await refreshWith(mock, result, makeScan([renamed, other]));

    expect(result.current.selectedVideo).not.toBeNull();
    expect(result.current.selectedVideo?.path).toBe('/videos/2026-01-01-cooking-tutorial.mp4');
    expect(result.current.selectedVideo?.filename).toBe('2026-01-01-cooking-tutorial.mp4');
    expect(result.current.selectedVideo?.contentHash).toBe('hash-a');
  });

  it('T2: after a batch + refresh() the list equals exactly the new scan result (no ghosts)', async () => {
    const { result } = renderCatalog();

    const a = makeVideo({ path: '/videos/a.mp4', contentHash: 'hash-a' });
    const b = makeVideo({ path: '/videos/b.mp4', contentHash: 'hash-b' });
    const ghost = makeVideo({ path: '/videos/ghost.mp4', contentHash: 'hash-ghost' });

    await refreshWith(mock, result, makeScan([a, b, ghost]));
    expect(result.current.videos).toHaveLength(3);

    // Simulated batch completion: a and b were renamed, ghost is gone
    const aRenamed = makeVideo({ path: '/videos/a-renamed.mp4', contentHash: 'hash-a', status: 'completed' });
    const bRenamed = makeVideo({ path: '/videos/b-renamed.mp4', contentHash: 'hash-b', status: 'completed' });
    await refreshWith(mock, result, makeScan([aRenamed, bRenamed]));

    expect(result.current.videos.map((video) => video.path)).toEqual([
      '/videos/a-renamed.mp4',
      '/videos/b-renamed.mp4',
    ]);
    expect(result.current.videos.map((video) => video.status)).toEqual(['completed', 'completed']);
  });

  it('T3: a changed thumbnailMtime yields a different img URL without re-selecting', async () => {
    const { result } = renderCatalog();
    const thumbPath = '/videos/.ai-video-cataloger/thumbnails/a.jpg';

    const before = makeVideo({
      path: '/videos/a.mp4',
      contentHash: 'hash-a',
      artifacts: makeArtifacts({ thumbnailPath: thumbPath, thumbnailMtime: 1000 }),
    });
    await refreshWith(mock, result, makeScan([before]));
    act(() => {
      result.current.selectKey('hash-a');
    });

    const selectedBefore = result.current.selectedVideo;
    expect(selectedBefore).not.toBeNull();
    expect(selectedBefore?.artifacts.thumbnailPath).toBe(thumbPath);
    const urlBefore = mediaUrl(
      selectedBefore!.artifacts.thumbnailPath!,
      selectedBefore!.artifacts.thumbnailMtime ?? undefined
    );

    // Thumbnail regenerated on disk: same path, new mtime
    const after = makeVideo({
      path: '/videos/a.mp4',
      contentHash: 'hash-a',
      artifacts: makeArtifacts({ thumbnailPath: thumbPath, thumbnailMtime: 2000 }),
    });
    await refreshWith(mock, result, makeScan([after]));

    const selectedAfter = result.current.selectedVideo;
    expect(selectedAfter).not.toBeNull();
    const urlAfter = mediaUrl(
      selectedAfter!.artifacts.thumbnailPath!,
      selectedAfter!.artifacts.thumbnailMtime ?? undefined
    );

    expect(urlAfter).not.toBe(urlBefore);
    expect(urlAfter).toContain('?v=2000');
  });

  it('clears selection when the selected key vanishes from the new scan', async () => {
    const { result } = renderCatalog();

    const a = makeVideo({ path: '/videos/a.mp4', contentHash: 'hash-a' });
    const b = makeVideo({ path: '/videos/b.mp4', contentHash: 'hash-b' });

    await refreshWith(mock, result, makeScan([a, b]));
    act(() => {
      result.current.selectKey('hash-a');
    });
    expect(result.current.selectedVideo?.path).toBe('/videos/a.mp4');

    await refreshWith(mock, result, makeScan([b]));
    expect(result.current.selectedVideo).toBeNull();
  });
});
