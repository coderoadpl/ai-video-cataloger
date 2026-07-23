import { useCallback, useState } from 'react';
import { Box, Collapse, List, ListItemButton, Typography } from '@mui/material';

import { ChevronRightIcon, ExpandMoreIcon, FolderIcon } from '../../components/ui/icons.js';
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

const FolderCounts = ({ pending, processed }: { pending: number; processed: number }) => (
  <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto', flexShrink: 0 }}>
    {pending} pending · {processed} done
  </Typography>
);

interface NodeProps extends Omit<CatalogTreeProps, 'root'> {
  node: CatalogTreeNode;
  isExpanded: (relativePath: string) => boolean;
  onToggle: (relativePath: string) => void;
}

const NodeVideos = ({
  node,
  selectedKey,
  analyzingPath,
  skippedPaths,
  onSelect,
}: Pick<NodeProps, 'node' | 'selectedKey' | 'analyzingPath' | 'skippedPaths' | 'onSelect'>) =>
  node.videos.length === 0 ? null : (
    <VideoList
      videos={node.videos}
      selectedKey={selectedKey}
      analyzingPath={analyzingPath}
      isLoading={false}
      isError={false}
      error={null}
      onSelect={onSelect}
      skippedPaths={skippedPaths}
    />
  );

const ChildFolder = ({ node, isExpanded, onToggle, ...rest }: NodeProps) => {
  const expanded = isExpanded(node.relativePath);
  return (
    <Box>
      <ListItemButton
        onClick={() => onToggle(node.relativePath)}
        data-testid="folder-row"
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
        <FolderCounts pending={node.pendingCount} processed={node.processedCount} />
      </ListItemButton>
      <Collapse in={expanded} unmountOnExit>
        <NodeVideos node={node} {...rest} />
        {node.children.map((child) => (
          <ChildFolder key={child.relativePath} node={child} isExpanded={isExpanded} onToggle={onToggle} {...rest} />
        ))}
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
      <NodeVideos node={root} {...rest} />
      {root.children.map((child) => (
        <ChildFolder key={child.relativePath} node={child} isExpanded={isExpanded} onToggle={onToggle} {...rest} />
      ))}
    </List>
  );
};
