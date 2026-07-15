import { z } from 'zod';

export const MENU_EVENT_NAMES = [
  'openFolder',
  'openRecentFolder',
  'clearRecentFolders',
  'toggleTerminal',
  'toggleSidebar',
  'showSettings',
  'showPrerequisites',
  'showModelManager',
  'showSetupWizard',
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
  showSetupWizard: undefined;
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
  on(name: 'openFolder', handler: MenuEventHandler<'openFolder'>): Unsubscribe;
  on(name: 'openRecentFolder', handler: MenuEventHandler<'openRecentFolder'>): Unsubscribe;
  on(name: 'clearRecentFolders', handler: MenuEventHandler<'clearRecentFolders'>): Unsubscribe;
  on(name: 'toggleTerminal', handler: MenuEventHandler<'toggleTerminal'>): Unsubscribe;
  on(name: 'toggleSidebar', handler: MenuEventHandler<'toggleSidebar'>): Unsubscribe;
  on(name: 'showSettings', handler: MenuEventHandler<'showSettings'>): Unsubscribe;
  on(name: 'showPrerequisites', handler: MenuEventHandler<'showPrerequisites'>): Unsubscribe;
  on(name: 'showModelManager', handler: MenuEventHandler<'showModelManager'>): Unsubscribe;
  on(name: 'showSetupWizard', handler: MenuEventHandler<'showSetupWizard'>): Unsubscribe;
}

export interface OnboardingBridge {
  getCompleted(): Promise<boolean>;
  setCompleted(): Promise<void>;
}

export const desktopFetchRequestSchema = z.object({
  url: z.string().min(1),
  method: z.string().min(1).optional(),
  headers: z.record(z.string()).optional(),
  body: z.string().nullable().optional(),
});

export const desktopFetchResponseSchema = z.object({
  status: z.number().int(),
  statusText: z.string(),
  headers: z.record(z.string()),
  body: z.string(),
});

export type DesktopFetchRequest = z.infer<typeof desktopFetchRequestSchema>;
export type DesktopFetchResponse = z.infer<typeof desktopFetchResponseSchema>;

export interface DesktopApiBridge {
  request(input: DesktopFetchRequest): Promise<DesktopFetchResponse>;
}

export interface DesktopBridge {
  platform: string;
  getAppVersion(): Promise<string>;
  api: DesktopApiBridge;
  folder: FolderStoreBridge;
  revealInFinder(path: string): Promise<void>;
  window: WindowControlsBridge;
  menu: MenuEventsBridge;
  onboarding: OnboardingBridge;
}
