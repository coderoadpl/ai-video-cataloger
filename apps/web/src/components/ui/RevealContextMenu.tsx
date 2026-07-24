import { useCallback, useState, type MouseEvent } from 'react';
import { Menu, MenuItem } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';

interface RevealAnchor {
  x: number;
  y: number;
  path: string;
}

export interface RevealContextMenuController {
  anchor: RevealAnchor | null;
  open: (event: MouseEvent, path: string) => void;
  close: () => void;
}

export const useRevealContextMenu = (): RevealContextMenuController => {
  const [anchor, setAnchor] = useState<RevealAnchor | null>(null);
  const open = useCallback((event: MouseEvent, path: string) => {
    event.preventDefault();
    setAnchor({ x: event.clientX, y: event.clientY, path });
  }, []);
  const close = useCallback(() => setAnchor(null), []);
  return { anchor, open, close };
};

export const RevealContextMenu = ({
  controller,
  onReveal,
}: {
  controller: RevealContextMenuController;
  onReveal: (path: string) => void;
}) => {
  const dictionary = useDictionary();
  const { anchor, close } = controller;
  return (
    <Menu
      open={anchor !== null}
      onClose={close}
      anchorReference="anchorPosition"
      anchorPosition={anchor === null ? undefined : { top: anchor.y, left: anchor.x }}
      data-testid="reveal-context-menu"
    >
      <MenuItem
        data-testid="reveal-in-finder-item"
        onClick={() => {
          if (anchor !== null) onReveal(anchor.path);
          close();
        }}
      >
        {dictionary.common.revealInFinder}
      </MenuItem>
    </Menu>
  );
};
