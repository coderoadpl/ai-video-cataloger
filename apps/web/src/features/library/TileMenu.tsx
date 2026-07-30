import { useCallback, useState, type MouseEvent } from 'react';
import { Menu, MenuItem } from '@mui/material';

import { bridge } from '../../api.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import type { LibraryItem } from './core/index.js';

interface TileMenuAnchor {
  x: number;
  y: number;
  item: LibraryItem;
}

export interface TileMenuController {
  anchor: TileMenuAnchor | null;
  open: (event: MouseEvent, item: LibraryItem) => void;
  close: () => void;
}

export const useTileMenu = (): TileMenuController => {
  const [anchor, setAnchor] = useState<TileMenuAnchor | null>(null);
  const open = useCallback((event: MouseEvent, item: LibraryItem) => {
    event.preventDefault();
    setAnchor({ x: event.clientX, y: event.clientY, item });
  }, []);
  const close = useCallback(() => setAnchor(null), []);
  return { anchor, open, close };
};

interface TileMenuProps {
  controller: TileMenuController;
  onOpenInFolder: (item: LibraryItem) => void;
}

export const TileMenu = ({ controller, onOpenInFolder }: TileMenuProps) => {
  const dictionary = useDictionary();
  const { anchor, close } = controller;
  const item = anchor?.item ?? null;

  return (
    <Menu
      open={anchor !== null}
      onClose={close}
      anchorReference="anchorPosition"
      anchorPosition={anchor === null ? undefined : { top: anchor.y, left: anchor.x }}
      data-testid="library-tile-menu"
    >
      <MenuItem
        data-testid="library-tile-menu-open-folder"
        onClick={() => {
          close();
          if (item !== null) onOpenInFolder(item);
        }}
      >
        {dictionary.library.openInFolderView}
      </MenuItem>
      <MenuItem
        data-testid="library-tile-menu-reveal"
        onClick={() => {
          close();
          if (item !== null) void bridge.revealInFinder(`${item.folder.currentPath}/${item.fileName}`);
        }}
      >
        {dictionary.common.revealInFinder}
      </MenuItem>
      <MenuItem
        data-testid="library-tile-menu-copy-path"
        onClick={() => {
          close();
          if (item !== null) void navigator.clipboard?.writeText(`${item.folder.currentPath}/${item.fileName}`);
        }}
      >
        {dictionary.library.copyPath}
      </MenuItem>
    </Menu>
  );
};
