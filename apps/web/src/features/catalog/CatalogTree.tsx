import { useCallback, useState } from 'react';
import { Alert, Box, Button, Collapse, List, ListItemButton, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';

import { ChevronRightIcon, ExpandMoreIcon, FolderIcon } from '../../components/ui/icons.js';
import { actions } from '../../api.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { type CatalogVideo } from './catalog-video.js';
import { type CatalogTreeNode } from './catalog-tree-model.js';
import { VideoList } from './VideoList.js';

interface CatalogTreeProps {
  root: CatalogTreeNode;
  selectedKey: string | null;
  analyzingPath: string | null;
  skippedPaths: ReadonlySet<string>;
  onSelect: (video: CatalogVideo) => void;
}

const LARGE_TREE_VIDEO_THRESHOLD = 2_000;

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

const processDriveCommand = (root: string): string => `ai-video-cataloger process-drive ${shellQuote(root)}`;

const FolderCounts = ({
  videoCount,
  pending,
  processed,
  approximate,
}: {
  videoCount: number;
  pending: number | null;
  processed: number | null;
  approximate: boolean;
}) => {
  const dictionary = useDictionary();
  const text = pending === null || processed === null
    ? dictionary.catalog.unknownFolderCounts(videoCount)
    : approximate
      ? dictionary.catalog.approximateFolderCounts(pending, processed)
      : dictionary.catalog.folderCounts(pending, processed);

  return (
    <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto', flexShrink: 0 }}>
      {text}
    </Typography>
  );
};

interface NodeProps extends Omit<CatalogTreeProps, 'root'> {
  node: CatalogTreeNode;
  isExpanded: (relativePath: string) => boolean;
  onToggle: (relativePath: string) => void;
  renderChildren?: boolean | undefined;
}

const NodeVideos = ({
  node,
  selectedKey,
  analyzingPath,
  skippedPaths,
  onSelect,
  expanded,
}: Pick<NodeProps, 'node' | 'selectedKey' | 'analyzingPath' | 'skippedPaths' | 'onSelect'> & { expanded: boolean }) => {
  const videoCount = node.directVideoCount ?? node.videos.length;
  const details = useQuery({
    ...actions.catalogTreeFolder({ folder: node.path }),
    enabled: expanded && videoCount > 0 && node.videos.length === 0,
  });
  if (videoCount === 0) return null;
  const videos = details.data?.videos ?? node.videos;
  return (
    <VideoList
      videos={videos}
      selectedKey={selectedKey}
      analyzingPath={analyzingPath}
      isLoading={details.isLoading}
      isError={details.isError}
      error={details.error}
      onSelect={onSelect}
      skippedPaths={skippedPaths}
      maxHeight={360}
    />
  );
};

const ChildFolder = ({ node, isExpanded, onToggle, renderChildren = true, ...rest }: NodeProps) => {
  const expanded = renderChildren ? isExpanded(node.relativePath) : true;
  return (
    <Box>
      <ListItemButton
        onClick={() => onToggle(node.relativePath)}
        data-testid={renderChildren ? 'folder-row' : 'folder-root-row'}
        data-folder-name={node.name}
        data-folder-pending={node.pendingCount}
        title={node.path}
        sx={{ gap: 0.75, py: 0.5, pl: 1 + node.depth * 1.25, borderRadius: 1 }}
      >
        {expanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
        <FolderIcon fontSize="small" sx={{ color: 'primary.main' }} />
        <Typography variant="body2" noWrap sx={{ fontWeight: 500, minWidth: 0 }}>
          {node.name}
        </Typography>
        <FolderCounts
          videoCount={node.videoCount ?? node.videos.length}
          pending={node.pendingCount}
          processed={node.processedCount}
          approximate={node.countsApproximate ?? false}
        />
      </ListItemButton>
      <Collapse in={expanded} unmountOnExit>
        <NodeVideos node={node} expanded={expanded} {...rest} />
        {renderChildren
          ? node.children.map((child) => (
              <ChildFolder key={child.relativePath} node={child} isExpanded={isExpanded} onToggle={onToggle} {...rest} />
            ))
          : null}
      </Collapse>
    </Box>
  );
};

export const CatalogTree = ({ root, ...rest }: CatalogTreeProps) => {
  const dictionary = useDictionary();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const isExpanded = useCallback((relativePath: string) => expanded.has(relativePath), [expanded]);
  const onToggle = useCallback((relativePath: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(relativePath)) next.delete(relativePath);
      else next.add(relativePath);
      return next;
    });
  }, []);
  const rootVideoCount = root.videoCount ?? root.videos.length;
  const rootDirectVideoCount = root.directVideoCount ?? root.videos.length;
  const command = processDriveCommand(root.path);

  return (
    <>
      {rootVideoCount > LARGE_TREE_VIDEO_THRESHOLD ? (
        <Alert
          severity="warning"
          data-testid="large-tree-warning"
          sx={{ m: 1, alignItems: 'flex-start' }}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => {
                void navigator.clipboard?.writeText(command);
              }}
            >
              {dictionary.catalog.largeRunCommandLabel}
            </Button>
          }
        >
          <Typography variant="subtitle2">{dictionary.catalog.largeRunWarningTitle}</Typography>
          <Typography variant="body2">{dictionary.catalog.largeRunWarningBody(rootVideoCount)}</Typography>
          <Typography component="code" variant="caption" sx={{ display: 'block', mt: 0.75, userSelect: 'all' }}>
            {command}
          </Typography>
        </Alert>
      ) : null}
      <List dense disablePadding sx={{ p: 1 }}>
        {rootDirectVideoCount > 0 ? (
          <ChildFolder node={root} isExpanded={isExpanded} onToggle={onToggle} renderChildren={false} {...rest} />
        ) : null}
        {root.children.map((child) => (
          <ChildFolder key={child.relativePath} node={child} isExpanded={isExpanded} onToggle={onToggle} {...rest} />
        ))}
      </List>
    </>
  );
};
