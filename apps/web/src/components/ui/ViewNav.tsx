import { Button, ButtonGroup } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';

export type MainView = 'videos' | 'people' | 'map';

interface ViewNavProps {
  activeView: MainView;
  onSelectView: (view: MainView) => void;
}

export const ViewNav = ({ activeView, onSelectView }: ViewNavProps) => {
  const dictionary = useDictionary();
  return (
    <ButtonGroup fullWidth size="small" variant="outlined" aria-label="Main view">
      <Button
        variant={activeView === 'videos' ? 'contained' : 'outlined'}
        onClick={() => onSelectView('videos')}
        data-testid="nav-videos"
      >
        {dictionary.appFrame.navVideos}
      </Button>
      <Button
        variant={activeView === 'people' ? 'contained' : 'outlined'}
        onClick={() => onSelectView('people')}
        data-testid="nav-people"
      >
        {dictionary.appFrame.navPeople}
      </Button>
      <Button
        variant={activeView === 'map' ? 'contained' : 'outlined'}
        onClick={() => onSelectView('map')}
        data-testid="nav-map"
      >
        {dictionary.appFrame.navMap}
      </Button>
    </ButtonGroup>
  );
};
