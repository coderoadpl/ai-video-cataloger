import { useMemo, useState } from 'react';
import { Autocomplete, Box, Button, IconButton, InputAdornment, TextField, Typography } from '@mui/material';

import { versionLabel } from '../../lib/format.js';
import { FolderBar } from './FolderBar.js';
import { CancelIcon, SearchIcon } from './icons.js';

export interface AppHeaderTag {
  name: string;
  count: number;
}

interface AppHeaderProps {
  appVersion: string;
  recentFolders: string[];
  isCheckingFolder: boolean;
  onOpenFolder: () => void;
  onSelectRecentFolder: (folderPath: string) => void;
  onShowSettings: () => void;
  onShowModelManager: () => void;
  onShowPrerequisites: () => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onSearchSubmit: (query: string) => void;
  recentSearches: readonly string[];
  onRemoveRecentSearch: (query: string) => void;
  topTags: readonly AppHeaderTag[];
  onSearchFocus: () => void;
}

type SearchOption =
  | { kind: 'recent'; label: string }
  | { kind: 'tag'; label: string; count: number };

export const AppHeader = ({
  appVersion,
  recentFolders,
  isCheckingFolder,
  onOpenFolder,
  onSelectRecentFolder,
  onShowSettings,
  onShowModelManager,
  onShowPrerequisites,
  searchQuery,
  onSearchQueryChange,
  onSearchSubmit,
  recentSearches,
  onRemoveRecentSearch,
  topTags,
  onSearchFocus,
}: AppHeaderProps) => {
  const [focused, setFocused] = useState(false);
  const options = useMemo<SearchOption[]>(() => [
    ...recentSearches.slice(0, 10).map((label) => ({ kind: 'recent' as const, label })),
    ...topTags.slice(0, 15).map((tag) => ({ kind: 'tag' as const, label: tag.name, count: tag.count })),
  ], [recentSearches, topTags]);
  const open = focused && searchQuery.trim().length === 0 && options.length > 0;

  return (
    <Box
      component="header"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: 3,
        py: 1.25,
        bgcolor: 'background.paper',
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      <Typography variant="h1">AI Video Cataloger</Typography>
      {appVersion.length === 0 ? null : (
        <Typography variant="caption">{versionLabel(appVersion)}</Typography>
      )}
      <Box sx={{ flex: 1, display: 'flex', justifyContent: 'center', minWidth: 180 }}>
        <Autocomplete
          freeSolo
          clearOnBlur={false}
          value={null}
          inputValue={searchQuery}
          open={open}
          options={options}
          groupBy={(option) => option.kind === 'recent' ? 'Recent searches' : 'Top tags'}
          getOptionLabel={(option) => typeof option === 'string' ? option : option.label}
          onInputChange={(_, value, reason) => {
            if (reason === 'input' || reason === 'clear') onSearchQueryChange(value);
          }}
          onChange={(_, value) => {
            if (value === null) return;
            onSearchSubmit(typeof value === 'string' ? value : value.label);
          }}
          onFocus={() => {
            setFocused(true);
            onSearchFocus();
          }}
          onBlur={() => setFocused(false)}
          renderOption={(props, option) => {
            const { key, ...optionProps } = props;
            return (
              <Box key={key} component="li" {...optionProps}>
                <Box component="span" sx={{ flex: 1, minWidth: 0 }}>
                  {option.label}
                </Box>
                {option.kind === 'tag' ? (
                  <Typography variant="caption">{option.count}</Typography>
                ) : (
                  <IconButton
                    aria-label={`Remove ${option.label}`}
                    size="small"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemoveRecentSearch(option.label);
                    }}
                  >
                    <CancelIcon fontSize="small" />
                  </IconButton>
                )}
              </Box>
            );
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder="Search catalog"
              size="small"
              onKeyDown={(event) => {
                if (event.key === 'Enter') onSearchSubmit(searchQuery);
              }}
              slotProps={{
                ...params.slotProps,
                input: {
                  ...params.slotProps.input,
                  startAdornment: (
                    <>
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" />
                      </InputAdornment>
                      {params.slotProps.input.startAdornment}
                    </>
                  ),
                },
              }}
            />
          )}
          sx={{ width: { xs: 220, md: 360 }, maxWidth: '100%' }}
        />
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <FolderBar
          recentFolders={recentFolders}
          isCheckingFolder={isCheckingFolder}
          onOpenFolder={onOpenFolder}
          onSelectRecentFolder={onSelectRecentFolder}
        />
        <Button variant="outlined" size="small" color="inherit" onClick={onShowSettings}>
          Settings
        </Button>
        <Button variant="outlined" size="small" color="inherit" onClick={onShowModelManager}>
          Models
        </Button>
        <Button variant="text" size="small" color="inherit" onClick={onShowPrerequisites}>
          Prerequisites
        </Button>
      </Box>
    </Box>
  );
};
