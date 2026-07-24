import { useCallback, useState } from 'react';
import { Box, Collapse, List, ListItemButton, Typography } from '@mui/material';
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

const FolderCounts = ({
  videoCount,
  pending,
  processed,
}: {
  videoCount: number;
  pending: number | null;
  processed: number | null;
}) => {
  const dictionary = useDictionary();

  return (
    <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto', flexShrink: 0 }}>
      {dictionary.catalog.folderCounts(pending ?? videoCount, processed ?? 0)}
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
  const videoCount = node.videoCount ?? node.videos.length;
  const scan = useQuery({
    ...actions.scan({ folder: node.path }),
    enabled: expanded && videoCount > 0 && node.videos.length === 0,
  });
  if (videoCount === 0) return null;
  const videos = scan.data?.videos ?? node.videos;
  return (
    <VideoList
      videos={videos}
      selectedKey={selectedKey}
      analyzingPath={analyzingPath}
      isLoading={scan.isLoading}
      isError={scan.isError}
      error={scan.error}
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
        <FolderCounts videoCount={node.videoCount ?? node.videos.length} pending={node.pendingCount} processed={node.processedCount} />
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

  return (
    <List dense disablePadding sx={{ p: 1 }}>
      {(root.videoCount ?? root.videos.length) > 0 ? (
        <ChildFolder node={root} isExpanded={isExpanded} onToggle={onToggle} renderChildren={false} {...rest} />
      ) : null}
      {root.children.map((child) => (
        <ChildFolder key={child.relativePath} node={child} isExpanded={isExpanded} onToggle={onToggle} {...rest} />
      ))}
    </List>
  );
};
