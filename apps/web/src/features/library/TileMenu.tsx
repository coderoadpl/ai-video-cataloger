import { useCallback, useState, type MouseEvent } from 'react';
import { Alert, Divider, Menu, MenuItem, Snackbar } from '@mui/material';

import { bridge } from '../../api.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { useSavedToast } from '../../components/ui/SavedToastProvider.js';
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

const pathOf = (item: LibraryItem): string => item.media === 'video' ? `${item.folder.currentPath}/${item.fileName}` : item.currentPath;

interface TileMenuProps {
  controller: TileMenuController;
  onOpenInAnalysis: (item: LibraryItem) => void;
  hiddenView: boolean;
  onHideItem?: ((item: LibraryItem) => void) | undefined;
  onRestoreItem?: ((item: LibraryItem) => void) | undefined;
}

export const TileMenu = ({
  controller,
  onOpenInAnalysis,
  hiddenView,
  onHideItem,
  onRestoreItem,
}: TileMenuProps) => {
  const dictionary = useDictionary();
  const showSavedToast = useSavedToast();
  const { anchor, close } = controller;
  const item = anchor?.item ?? null;
  const [revealFailed, setRevealFailed] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const dismissRevealFailed = useCallback(() => setRevealFailed(false), []);
  const dismissCopyFailed = useCallback(() => setCopyFailed(false), []);
  const visibilityAction = hiddenView ? onRestoreItem : onHideItem;

  return (
    <>
      <Menu
        open={anchor !== null}
        onClose={close}
        anchorReference="anchorPosition"
        anchorPosition={anchor === null ? undefined : { top: anchor.y, left: anchor.x }}
        data-testid="library-tile-menu"
      >
        {visibilityAction === undefined ? null : (
          <MenuItem
            data-testid={hiddenView ? 'library-tile-menu-restore' : 'library-tile-menu-hide'}
            onClick={() => {
              close();
              if (item !== null) visibilityAction(item);
            }}
          >
            {hiddenView ? dictionary.library.restoreItem : dictionary.library.hideItem}
          </MenuItem>
        )}
        {visibilityAction === undefined ? null : <Divider />}
        <MenuItem
          data-testid="library-tile-menu-open-analysis"
          onClick={() => {
            close();
            if (item !== null) onOpenInAnalysis(item);
          }}
        >
          {dictionary.library.openInAnalysis}
        </MenuItem>
        <MenuItem
          data-testid="library-tile-menu-reveal"
          onClick={() => {
            const target = item === null ? null : pathOf(item);
            close();
            if (target === null) return;
            void (async () => {
              const revealed = await bridge.revealInFinder(target);
              if (!revealed) setRevealFailed(true);
            })();
          }}
        >
          {dictionary.common.revealInFinder}
        </MenuItem>
        <MenuItem
          data-testid="library-tile-menu-copy-path"
          onClick={() => {
            const target = item === null ? null : pathOf(item);
            close();
            if (target === null) return;
            void (async () => {
              try {
                if (navigator.clipboard === undefined) throw new Error('Clipboard API unavailable');
                await navigator.clipboard.writeText(target);
                showSavedToast(dictionary.common.copied);
              } catch {
                setCopyFailed(true);
              }
            })();
          }}
        >
          {dictionary.library.copyPath}
        </MenuItem>
      </Menu>
      <Snackbar
        open={revealFailed}
        autoHideDuration={6000}
        onClose={dismissRevealFailed}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={dismissRevealFailed} data-testid="library-tile-menu-reveal-failed-toast">
          {dictionary.common.revealFailed}
        </Alert>
      </Snackbar>
      <Snackbar
        open={copyFailed}
        autoHideDuration={6000}
        onClose={dismissCopyFailed}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={dismissCopyFailed} data-testid="library-tile-menu-copy-failed-toast">
          {dictionary.common.copyFailed}
        </Alert>
      </Snackbar>
    </>
  );
};
