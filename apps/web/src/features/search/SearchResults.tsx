import { Fragment, type ReactNode } from 'react';
import { Box, Button, Chip, CircularProgress, Divider, List, ListItemButton, Typography } from '@mui/material';

import { ApiError, type SearchOutput } from '@core/client/index.js';

import { FolderIcon, SearchIcon } from '../../components/ui/icons.js';
import { type Dictionary } from '../../i18n/dictionary.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { folderName } from '../../lib/format.js';
import { bridge } from '../../api.js';
import type { GlobalSearchState, SearchGroup } from './use-global-search.js';

interface SearchResultsProps {
  search: GlobalSearchState;
  onOpenFolder: (folderPath: string) => void;
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

export const SearchResults = ({ search, onOpenFolder }: SearchResultsProps) => {
  const dictionary = useDictionary();

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
    <Box sx={{ height: '100%', overflow: 'auto' }}>
      <Box sx={{ px: 3, py: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="h2">{dictionary.search.resultCount(search.count)}</Typography>
        <Typography variant="caption">{dictionary.search.resultsFor(search.debouncedQuery)}</Typography>
      </Box>
      <Box sx={{ px: 2, py: 1.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {search.groups.map((group) => (
          <SearchFolderGroup
            key={group.folder.folderId}
            group={group}
            onOpenFolder={onOpenFolder}
            dictionary={dictionary}
          />
        ))}
      </Box>
    </Box>
  );
};

const SearchFolderGroup = ({
  group,
  onOpenFolder,
  dictionary,
}: {
  group: SearchGroup;
  onOpenFolder: (folderPath: string) => void;
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
          <SearchResultRow result={result} dictionary={dictionary} />
        </Fragment>
      ))}
    </List>
  </Box>
);

const SearchResultRow = ({
  result,
  dictionary,
}: {
  result: SearchOutput['results'][number];
  dictionary: Dictionary;
}) => {
  const filePath = `${result.folder.currentPath}/${result.fileName}`;
  return (
    <ListItemButton
      disabled={!result.folder.online || result.missing}
      onClick={() => {
        if (result.folder.online && !result.missing) void bridge.revealInFinder(filePath);
      }}
      title={filePath}
      sx={{ alignItems: 'flex-start', borderRadius: 1, py: 1, gap: 1.5 }}
    >
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
