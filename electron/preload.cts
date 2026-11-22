import { contextBridge, ipcRenderer } from 'electron';
import type { MonitorBridge, MonitorSnapshot } from '../src/shared/types.js';

const bridge: MonitorBridge = {
  getSnapshot: () => ipcRenderer.invoke('monitor:snapshot'),
  getSessionPreview: id => ipcRenderer.invoke('monitor:session-preview', id),
  onSnapshot: callback => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: MonitorSnapshot) => callback(snapshot);
    ipcRenderer.on('monitor:updated', listener);
    return () => { ipcRenderer.removeListener('monitor:updated', listener); };
  },
  onFocusSession: callback => {
    const listener = (_event: Electron.IpcRendererEvent, id: string) => callback(id);
    ipcRenderer.on('monitor:focus-session', listener);
    return () => { ipcRenderer.removeListener('monitor:focus-session', listener); };
  },
  refresh: () => ipcRenderer.invoke('monitor:refresh'),
  chooseDirectory: id => ipcRenderer.invoke('monitor:choose-directory', id),
  copyTelemetrySetup: id => ipcRenderer.invoke('monitor:telemetry-setup', id),
  updateSettings: settings => ipcRenderer.invoke('monitor:settings', settings),
  compact: threadId => ipcRenderer.invoke('monitor:compact', threadId),
  freshContext: threadId => ipcRenderer.invoke('monitor:fresh-context', threadId),
  revealSession: threadId => ipcRenderer.invoke('monitor:reveal', threadId),
  copySessionId: threadId => ipcRenderer.invoke('monitor:copy-id', threadId),
};

contextBridge.exposeInMainWorld('monitor', bridge);
