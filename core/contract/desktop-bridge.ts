export const MENU_EVENT_NAMES = [
  'openFolder',
  'openRecentFolder',
  'clearRecentFolders',
  'toggleTerminal',
  'toggleSidebar',
  'showSettings',
  'showPrerequisites',
  'showModelManager',
] as const;

export type MenuEventName = (typeof MENU_EVENT_NAMES)[number];

export interface MenuEventPayloads {
  openFolder: undefined;
  openRecentFolder: { folderPath: string };
  clearRecentFolders: undefined;
  toggleTerminal: undefined;
  toggleSidebar: undefined;
  showSettings: undefined;
  showPrerequisites: undefined;
  showModelManager: undefined;
}

export type MenuEventHandler<Name extends MenuEventName> = (payload: MenuEventPayloads[Name]) => void;
export type Unsubscribe = () => void;

export interface FolderStoreBridge {
  showPicker(): Promise<string | null>;
  getCurrent(): Promise<string | null>;
  setCurrent(folderPath: string): Promise<void>;
  getRecent(): Promise<string[]>;
  removeRecent(folderPath: string): Promise<void>;
  clearRecent(): Promise<void>;
}

export interface WindowControlsBridge {
  close(): void;
  minimize(): void;
  maximize(): void;
}

export interface MenuEventsBridge {
  on<Name extends MenuEventName>(name: Name, handler: MenuEventHandler<Name>): Unsubscribe;
}

export interface DesktopBridge {
  platform: string;
  getAppVersion(): Promise<string>;
  folder: FolderStoreBridge;
  revealInFinder(path: string): Promise<void>;
  window: WindowControlsBridge;
  menu: MenuEventsBridge;
}
