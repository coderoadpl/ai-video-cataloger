import { Tab, Tabs } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';

export type LibrarySurface = 'collection' | 'photos' | 'people' | 'map';

interface LibrarySubnavProps {
  surface: LibrarySurface;
  onSelect: (surface: LibrarySurface) => void;
}

export const LibrarySubnav = ({ surface, onSelect }: LibrarySubnavProps) => {
  const dictionary = useDictionary();
  return (
    <Tabs
      value={surface}
      onChange={(_event, next: LibrarySurface) => onSelect(next)}
      aria-label={dictionary.appFrame.subnavLabel}
    >
      <Tab value="collection" label={dictionary.appFrame.subnavCollection} data-testid="subnav-collection" />
      <Tab value="photos" label={dictionary.appFrame.subnavPhotos} data-testid="subnav-photos" />
      <Tab value="people" label={dictionary.appFrame.subnavPeople} data-testid="subnav-people" />
      <Tab value="map" label={dictionary.appFrame.subnavMap} data-testid="subnav-map" />
    </Tabs>
  );
};
