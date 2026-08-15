import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, CircularProgress, List, ListItemButton, Tooltip, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';

import { ApiError } from '@core/client/index.js';
import { actions } from '../../api.js';
import { ChevronRightIcon, ExpandMoreIcon, FolderIcon } from '../../components/ui/icons.js';
import { TreeRowGuides } from '../../components/ui/TreeRowGuides.js';
import { useWindowedList } from '../../components/ui/use-windowed-list.js';
import type { Dictionary } from '../../i18n/dictionary.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { formatAnalyzerError } from '../../lib/analyzer-error-message.js';
import {
  buildPhotoTreeRows,
  photoFolderKey,
  type LoadedPhotoFolder,
  type PhotoFolderRow,
  type PhotoItemRow,
  type PhotoStatusRow,
  type PhotoTreeNode,
  type PhotoTreeRow,
} from './core/index.js';
import { PhotoRow } from './PhotoRow.js';

const FOLDER_ROW_HEIGHT = 40;
const STATUS_ROW_HEIGHT = 52;
const PHOTO_ITEM_ROW_HEIGHT = 96;
const INDENT = 18;

const rowHeightOf = (row: PhotoTreeRow): number => {
  if (row.kind === 'folder') return FOLDER_ROW_HEIGHT;
  if (row.kind === 'status') return STATUS_ROW_HEIGHT;
  return PHOTO_ITEM_ROW_HEIGHT;
};

const FolderRowView = ({ row, onToggle }: { row: PhotoFolderRow; onToggle: (key: string) => void }) => {
  const dictionary = useDictionary();
  const key = photoFolderKey(row.root, row.relativePath);
  return (
    <ListItemButton
      role="treeitem"
      aria-expanded={row.expanded}
      aria-level={row.depth + 1}
      onClick={() => onToggle(key)}
      data-testid={row.isRoot ? 'photos-tree-root-row' : 'photos-tree-folder-row'}
      data-folder-name={row.name}
      title={row.path}
      sx={{ position: 'relative', gap: 0.75, py: 0.5, pl: `${row.depth * INDENT + 8}px`, height: FOLDER_ROW_HEIGHT, borderRadius: 1 }}
    >
      <TreeRowGuides row={row} />
      {row.expanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
      <FolderIcon fontSize="small" sx={{ color: 'primary.main' }} />
      <Typography variant="body2" noWrap sx={{ fontWeight: 500, minWidth: 0 }}>
        {row.name}
      </Typography>
      <Tooltip title={dictionary.photosSidebar.treeFolderCounts(row.photoCount, row.analysedCount)}>
        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto', flexShrink: 0 }}>
          {`${String(row.analysedCount)}/${String(row.photoCount)}`}
        </Typography>
      </Tooltip>
    </ListItemButton>
  );
};

const StatusRowView = ({ row }: { row: PhotoStatusRow }) => {
  const dictionary = useDictionary();
  return (
    <Box sx={{ position: 'relative', height: STATUS_ROW_HEIGHT, display: 'flex', alignItems: 'center', gap: 1, pl: `${row.depth * INDENT + 8}px` }}>
      <TreeRowGuides row={row} />
      {row.variant === 'loading' ? (
        <>
          <CircularProgress size={16} />
          <Typography variant="caption" color="text.secondary">{dictionary.catalog.scanningFolder}</Typography>
        </>
      ) : (
        <Typography variant="caption" role="alert" sx={(theme) => ({ color: theme.palette.status.error.main })}>
          {row.error instanceof ApiError
            ? formatAnalyzerError(row.error.appError.message, dictionary.errors)
            : dictionary.catalog.genericScanError}
        </Typography>
      )}
    </Box>
  );
};

const PhotoItemRowView = ({
  row,
  selected,
  isProcessing,
  onSelect,
  dictionary,
}: {
  row: PhotoItemRow;
  selected: boolean;
  isProcessing: boolean;
  onSelect: () => void;
  dictionary: Dictionary;
}) => (
  <Box sx={{ position: 'relative', pl: `${row.depth * INDENT + 8}px` }}>
    <TreeRowGuides row={row} />
    <PhotoRow item={row.item} selected={selected} isProcessing={isProcessing} onSelect={onSelect} dictionary={dictionary} />
  </Box>
);

const PhotoFolderFetcher = ({
  folderKey,
  path,
  onLoaded,
}: {
  folderKey: string;
  path: string;
  onLoaded: (key: string, value: LoadedPhotoFolder) => void;
}) => {
  const details = useQuery(actions.photosTreeFolder({ folder: path }));
  const items = details.data?.items;
  useEffect(() => {
    onLoaded(folderKey, { items: items ?? [], isLoading: details.isLoading, isError: details.isError, error: details.error });
  }, [folderKey, items, details.isLoading, details.isError, details.error, onLoaded]);
  return null;
};

interface PhotosTreeProps {
  root: PhotoTreeNode;
  selectedFingerprint: string | null;
  processingFingerprints: ReadonlySet<string>;
  onSelect: (fingerprint: string) => void;
}

export const PhotosTree = ({ root, selectedFingerprint, processingFingerprints, onSelect }: PhotosTreeProps) => {
  const dictionary = useDictionary();
  const rootKey = photoFolderKey(root.root, '');
  const roots = useMemo(() => [root], [root]);

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([rootKey]));
  const [loaded, setLoaded] = useState<ReadonlyMap<string, LoadedPhotoFolder>>(() => new Map());

  useEffect(() => {
    setExpanded(new Set([rootKey]));
  }, [rootKey]);

  const isExpanded = useCallback((key: string) => expanded.has(key), [expanded]);
  const onToggle = useCallback((key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const onLoaded = useCallback((key: string, value: LoadedPhotoFolder) => {
    setLoaded((current) => {
      const previous = current.get(key);
      if (
        previous !== undefined
        && previous.items === value.items
        && previous.isLoading === value.isLoading
        && previous.isError === value.isError
        && previous.error === value.error
      ) {
        return current;
      }
      const next = new Map(current);
      next.set(key, value);
      return next;
    });
  }, []);
  const loadedFolder = useCallback((key: string) => loaded.get(key), [loaded]);

  const fetchTargets = useMemo(() => {
    const targets: { key: string; path: string }[] = [];
    const visit = (node: PhotoTreeNode): void => {
      const key = photoFolderKey(node.root, node.relativePath);
      if (!expanded.has(key)) return;
      if (node.directPhotoCount > 0) targets.push({ key, path: node.path });
      node.children.forEach(visit);
    };
    visit(root);
    return targets;
  }, [root, expanded]);

  const rows = useMemo(() => buildPhotoTreeRows({ roots, isExpanded, loadedFolder }), [roots, isExpanded, loadedFolder]);
  const rowHeights = useMemo(() => rows.map(rowHeightOf), [rows]);
  const { range, onScroll, containerRef } = useWindowedList(rowHeights);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box sx={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }} aria-hidden>
        {fetchTargets.map((target) => (
          <PhotoFolderFetcher key={target.key} folderKey={target.key} path={target.path} onLoaded={onLoaded} />
        ))}
      </Box>
      <List
        dense
        disablePadding
        ref={containerRef}
        onScroll={onScroll}
        role="tree"
        aria-label={dictionary.batchToolbar.wholeTree}
        data-testid="photos-tree-scroll"
        sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 1 }}
      >
        <Box sx={{ height: range.totalHeight, position: 'relative' }}>
          <Box sx={{ transform: `translateY(${String(range.offsetTop)}px)` }}>
            {rows.slice(range.start, range.end).map((row) => {
              if (row.kind === 'folder') return <FolderRowView key={row.key} row={row} onToggle={onToggle} />;
              if (row.kind === 'status') return <StatusRowView key={row.key} row={row} />;
              return (
                <PhotoItemRowView
                  key={row.key}
                  row={row}
                  selected={row.item.fingerprint === selectedFingerprint}
                  isProcessing={processingFingerprints.has(row.item.fingerprint)}
                  onSelect={() => onSelect(row.item.fingerprint)}
                  dictionary={dictionary}
                />
              );
            })}
          </Box>
        </Box>
      </List>
    </Box>
  );
};
