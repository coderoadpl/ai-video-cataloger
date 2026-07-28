import { Fragment, type ReactNode } from 'react';
import { Box, Button, Chip, CircularProgress, Divider, IconButton, List, ListItemButton, Tooltip, Typography } from '@mui/material';

import { ApiError, type SearchOutput } from '@core/client/index.js';

import { ArrowBackIcon, FolderIcon, SearchIcon } from '../../components/ui/icons.js';
import { MediaThumbnail } from '../../components/ui/MediaThumbnail.js';
import { RevealContextMenu, useRevealContextMenu, type RevealContextMenuController } from '../../components/ui/RevealContextMenu.js';
import { type Dictionary } from '../../i18n/dictionary.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { folderName } from '../../lib/format.js';
import { bridge } from '../../api.js';
import type { GlobalSearchState, SearchGroup } from './use-global-search.js';

const RESULT_THUMB_BOX = 56;

interface SearchResultsProps {
  search: GlobalSearchState;
  onBack: () => void;
  onOpenFolder: (folderPath: string) => void;
  onOpenResult: (folderPath: string, videoPath: string) => void;
}

const Centered = ({ children }: { children: ReactNode }) => (
  <Box
    sx={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 1,
      color: 'text.secondary',
      textAlign: 'center',
      px: 3,
    }}
  >
    {children}
  </Box>
);

const errorMessage = (error: unknown, dictionary: Dictionary): string =>
  error instanceof ApiError ? error.appError.message : dictionary.search.genericError;

const BackBar = ({ onBack, dictionary, children }: { onBack: () => void; dictionary: Dictionary; children?: ReactNode }) => (
  <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1.5 }}>
    <Tooltip title={dictionary.search.back}>
      <IconButton size="small" onClick={onBack} aria-label={dictionary.search.back} data-testid="search-back">
        <ArrowBackIcon fontSize="small" />
      </IconButton>
    </Tooltip>
    {children}
  </Box>
);

export const SearchResults = ({ search, onBack, onOpenFolder, onOpenResult }: SearchResultsProps) => {
  const dictionary = useDictionary();
  const revealMenu = useRevealContextMenu();

  const body = (): ReactNode => {
    if (search.isLoading) {
      return (
        <Centered>
          <CircularProgress size={22} />
          <Typography variant="body2">{dictionary.search.searchingCatalog}</Typography>
        </Centered>
      );
    }
    if (search.isError) {
      return (
        <Centered>
          <Typography
            variant="body2"
            role="alert"
            sx={(theme) => ({ color: theme.palette.status.error.main })}
          >
            {errorMessage(search.error, dictionary)}
          </Typography>
        </Centered>
      );
    }
    if (search.debouncedQuery.length > 0 && search.count === 0) {
      return (
        <Centered>
          <SearchIcon />
          <Typography variant="body2">{dictionary.search.noResultsFound}</Typography>
        </Centered>
      );
    }
    return (
      <Box sx={{ px: 2, py: 1.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {search.groups.map((group) => (
          <SearchFolderGroup
            key={group.folder.folderId}
            group={group}
            onOpenFolder={onOpenFolder}
            onOpenResult={onOpenResult}
            revealMenu={revealMenu}
            dictionary={dictionary}
          />
        ))}
      </Box>
    );
  };

  const showHeaderText = !search.isLoading && !search.isError && !(search.debouncedQuery.length > 0 && search.count === 0);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <BackBar onBack={onBack} dictionary={dictionary}>
        {showHeaderText ? (
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h2">{dictionary.search.resultCount(search.count)}</Typography>
            <Typography variant="caption" noWrap component="div" title={search.debouncedQuery}>
              {dictionary.search.resultsFor(search.debouncedQuery)}
            </Typography>
          </Box>
        ) : null}
      </BackBar>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>{body()}</Box>
      <RevealContextMenu controller={revealMenu} onReveal={(path) => bridge.revealInFinder(path)} />
    </Box>
  );
};

const SearchFolderGroup = ({
  group,
  onOpenFolder,
  onOpenResult,
  revealMenu,
  dictionary,
}: {
  group: SearchGroup;
  onOpenFolder: (folderPath: string) => void;
  onOpenResult: (folderPath: string, videoPath: string) => void;
  revealMenu: RevealContextMenuController;
  dictionary: Dictionary;
}) => (
  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, px: 1 }}>
      <FolderIcon fontSize="small" sx={{ color: group.folder.online ? 'primary.main' : 'text.secondary' }} />
      <Button
        size="small"
        color="inherit"
        disabled={!group.folder.online}
        onClick={() => onOpenFolder(group.folder.currentPath)}
        sx={{ minWidth: 0, justifyContent: 'flex-start' }}
      >
        <Typography variant="body2" noWrap title={group.folder.currentPath}>
          {folderName(group.folder.currentPath)}
        </Typography>
      </Button>
      {group.folder.online ? null : (
        <Chip
          size="small"
          label={dictionary.search.driveNotConnected}
          sx={(theme) => ({
            bgcolor: theme.palette.status.notTracked.soft,
            color: theme.palette.status.notTracked.main,
          })}
        />
      )}
    </Box>
    <List dense disablePadding>
      {group.results.map((result, index) => (
        <Fragment key={result.fingerprint}>
          {index === 0 ? null : <Divider component="li" />}
          <SearchResultRow result={result} onOpenResult={onOpenResult} revealMenu={revealMenu} dictionary={dictionary} />
        </Fragment>
      ))}
    </List>
  </Box>
);

const SearchResultRow = ({
  result,
  onOpenResult,
  revealMenu,
  dictionary,
}: {
  result: SearchOutput['results'][number];
  onOpenResult: (folderPath: string, videoPath: string) => void;
  revealMenu: RevealContextMenuController;
  dictionary: Dictionary;
}) => {
  const filePath = `${result.folder.currentPath}/${result.fileName}`;
  const canOpen = result.folder.online;
  const reachable = result.folder.online && !result.missing;
  return (
    <ListItemButton
      disabled={!canOpen}
      onClick={() => {
        if (canOpen) onOpenResult(result.folder.currentPath, filePath);
      }}
      onContextMenu={reachable ? (event) => revealMenu.open(event, filePath) : undefined}
      title={filePath}
      sx={{ alignItems: 'flex-start', borderRadius: 1, py: 1, gap: 1.5 }}
    >
      <MediaThumbnail
        path={result.thumbnailPath}
        mtime={null}
        alt={result.finalName ?? result.fileName}
        width={RESULT_THUMB_BOX}
        square
      />
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.65 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <Typography variant="body2" noWrap sx={{ fontWeight: 600, minWidth: 0 }}>
            {result.finalName ?? result.fileName}
          </Typography>
          {result.missing ? (
            <Chip
              size="small"
              label={dictionary.search.fileMissing}
              sx={(theme) => ({
                flexShrink: 0,
                bgcolor: theme.palette.status.notTracked.soft,
                color: theme.palette.status.notTracked.main,
              })}
            />
          ) : null}
          {result.variantCount > 1 ? (
            <Chip
              size="small"
              variant="outlined"
              label={dictionary.search.multipleVariants(result.variantCount)}
              data-testid="search-variant-count"
            />
          ) : null}
        </Box>
        <Typography variant="caption" component="div" sx={{ whiteSpace: 'normal' }}>
          <HighlightedSnippet value={result.snippet} />
        </Typography>
        {result.tags.length === 0 ? null : (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {result.tags.map((tag) => (
              <Chip key={tag} label={tag} size="small" />
            ))}
          </Box>
        )}
      </Box>
    </ListItemButton>
  );
};

interface SnippetSegment {
  text: string;
  marked: boolean;
}

const parseSnippet = (value: string): SnippetSegment[] => {
  const segments: SnippetSegment[] = [];
  let marked = false;
  for (const part of value.split(/(<mark>|<\/mark>)/g)) {
    if (part === '<mark>') {
      marked = true;
    } else if (part === '</mark>') {
      marked = false;
    } else if (part.length > 0) {
      segments.push({ text: part, marked });
    }
  }
  return segments;
};

const HighlightedSnippet = ({ value }: { value: string }) => (
  <>
    {parseSnippet(value).map((segment, index) => {
      const key = `${index}-${segment.text}`;
      return segment.marked ? (
        <Box key={key} component="mark" sx={{ px: 0.25 }}>
          {segment.text}
        </Box>
      ) : (
        <span key={key}>{segment.text}</span>
      );
    })}
  </>
);
