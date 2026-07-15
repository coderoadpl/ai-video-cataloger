import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { z } from 'zod';

import {
  desktopFetchResponseSchema,
  type DesktopBridge,
  type DesktopFetchResponse,
  type MenuEventHandler,
  type MenuEventName,
  type MenuEventPayloads,
  type Unsubscribe,
} from '@core/contract/index.js';

import { CHANNELS } from './channels.js';

const invokeUnknown = (channel: string, ...args: readonly unknown[]): Promise<unknown> =>
  ipcRenderer.invoke(channel, ...args).then((value: unknown) => value);

const send = (channel: string): void => {
  ipcRenderer.send(channel);
};

const menuChannelByName = {
  openFolder: CHANNELS.menuOpenFolder,
  openRecentFolder: CHANNELS.menuOpenRecentFolder,
  clearRecentFolders: CHANNELS.menuClearRecentFolders,
  toggleTerminal: CHANNELS.menuToggleTerminal,
  toggleSidebar: CHANNELS.menuToggleSidebar,
  showSettings: CHANNELS.menuShowSettings,
  showPrerequisites: CHANNELS.menuShowPrerequisites,
  showModelManager: CHANNELS.menuShowModelManager,
  showSetupWizard: CHANNELS.menuShowSetupWizard,
} satisfies { [Name in MenuEventName]: string };

const menuPayloadParsers = {
  openFolder: () => undefined,
  openRecentFolder: (args: readonly unknown[]) => ({ folderPath: z.string().parse(args[0]) }),
  clearRecentFolders: () => undefined,
  toggleTerminal: () => undefined,
  toggleSidebar: () => undefined,
  showSettings: () => undefined,
  showPrerequisites: () => undefined,
  showModelManager: () => undefined,
  showSetupWizard: () => undefined,
} satisfies { [Name in MenuEventName]: (args: readonly unknown[]) => MenuEventPayloads[Name] };

type MenuEventSubscriptionArgs =
  | [name: 'openFolder', handler: MenuEventHandler<'openFolder'>]
  | [name: 'openRecentFolder', handler: MenuEventHandler<'openRecentFolder'>]
  | [name: 'clearRecentFolders', handler: MenuEventHandler<'clearRecentFolders'>]
  | [name: 'toggleTerminal', handler: MenuEventHandler<'toggleTerminal'>]
  | [name: 'toggleSidebar', handler: MenuEventHandler<'toggleSidebar'>]
  | [name: 'showSettings', handler: MenuEventHandler<'showSettings'>]
  | [name: 'showPrerequisites', handler: MenuEventHandler<'showPrerequisites'>]
  | [name: 'showModelManager', handler: MenuEventHandler<'showModelManager'>]
  | [name: 'showSetupWizard', handler: MenuEventHandler<'showSetupWizard'>];

function onMenuEvent(name: 'openFolder', handler: MenuEventHandler<'openFolder'>): Unsubscribe;
function onMenuEvent(name: 'openRecentFolder', handler: MenuEventHandler<'openRecentFolder'>): Unsubscribe;
function onMenuEvent(name: 'clearRecentFolders', handler: MenuEventHandler<'clearRecentFolders'>): Unsubscribe;
function onMenuEvent(name: 'toggleTerminal', handler: MenuEventHandler<'toggleTerminal'>): Unsubscribe;
function onMenuEvent(name: 'toggleSidebar', handler: MenuEventHandler<'toggleSidebar'>): Unsubscribe;
function onMenuEvent(name: 'showSettings', handler: MenuEventHandler<'showSettings'>): Unsubscribe;
function onMenuEvent(name: 'showPrerequisites', handler: MenuEventHandler<'showPrerequisites'>): Unsubscribe;
function onMenuEvent(name: 'showModelManager', handler: MenuEventHandler<'showModelManager'>): Unsubscribe;
function onMenuEvent(name: 'showSetupWizard', handler: MenuEventHandler<'showSetupWizard'>): Unsubscribe;
function onMenuEvent(...args: MenuEventSubscriptionArgs): Unsubscribe {
  switch (args[0]) {
    case 'openFolder':
      return listenToMenuEvent(menuChannelByName.openFolder, menuPayloadParsers.openFolder, args[1]);
    case 'openRecentFolder':
      return listenToMenuEvent(menuChannelByName.openRecentFolder, menuPayloadParsers.openRecentFolder, args[1]);
    case 'clearRecentFolders':
      return listenToMenuEvent(menuChannelByName.clearRecentFolders, menuPayloadParsers.clearRecentFolders, args[1]);
    case 'toggleTerminal':
      return listenToMenuEvent(menuChannelByName.toggleTerminal, menuPayloadParsers.toggleTerminal, args[1]);
    case 'toggleSidebar':
      return listenToMenuEvent(menuChannelByName.toggleSidebar, menuPayloadParsers.toggleSidebar, args[1]);
    case 'showSettings':
      return listenToMenuEvent(menuChannelByName.showSettings, menuPayloadParsers.showSettings, args[1]);
    case 'showPrerequisites':
      return listenToMenuEvent(menuChannelByName.showPrerequisites, menuPayloadParsers.showPrerequisites, args[1]);
    case 'showModelManager':
      return listenToMenuEvent(menuChannelByName.showModelManager, menuPayloadParsers.showModelManager, args[1]);
    case 'showSetupWizard':
      return listenToMenuEvent(menuChannelByName.showSetupWizard, menuPayloadParsers.showSetupWizard, args[1]);
  }
}

const listenToMenuEvent = <Payload>(
  channel: string,
  parsePayload: (args: readonly unknown[]) => Payload,
  handler: (payload: Payload) => void,
): Unsubscribe => {
  const listener = (_event: IpcRendererEvent, ...args: readonly unknown[]): void => {
    handler(parsePayload(args));
  };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

const desktopBridge: DesktopBridge = {
  platform: process.platform,
  getAppVersion: async () => z.string().parse(await invokeUnknown(CHANNELS.appGetVersion)),
  api: {
    request: async (input) =>
      desktopFetchResponseSchema.parse(await invokeUnknown(CHANNELS.apiRequest, input)) satisfies DesktopFetchResponse,
  },
  folder: {
    showPicker: async () => z.string().nullable().parse(await invokeUnknown(CHANNELS.folderShowPicker)),
    getCurrent: async () => z.string().nullable().parse(await invokeUnknown(CHANNELS.folderGetCurrent)),
    setCurrent: async (folderPath) => {
      await invokeUnknown(CHANNELS.folderSetCurrent, folderPath);
    },
    getRecent: async () => z.array(z.string()).parse(await invokeUnknown(CHANNELS.folderGetRecent)),
    removeRecent: async (folderPath) => {
      await invokeUnknown(CHANNELS.folderRemoveRecent, folderPath);
    },
    clearRecent: async () => {
      await invokeUnknown(CHANNELS.folderClearRecent);
    },
  },
  revealInFinder: async (targetPath) => {
    await invokeUnknown(CHANNELS.revealInFinder, targetPath);
  },
  window: {
    close: () => send(CHANNELS.windowClose),
    minimize: () => send(CHANNELS.windowMinimize),
    maximize: () => send(CHANNELS.windowMaximize),
  },
  menu: {
    on: onMenuEvent,
  },
  onboarding: {
    getCompleted: async () => z.boolean().parse(await invokeUnknown(CHANNELS.onboardingGetCompleted)),
    setCompleted: async () => {
      await invokeUnknown(CHANNELS.onboardingSetCompleted);
    },
  },
};

contextBridge.exposeInMainWorld('desktopBridge', desktopBridge);

declare global {
  interface Window {
    desktopBridge: DesktopBridge;
  }
}
