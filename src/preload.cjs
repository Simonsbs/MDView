const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('mdview', {
  getState: () => ipcRenderer.invoke('document:state'),
  chooseFile: () => ipcRenderer.invoke('document:choose'),
  openDroppedFile: file => ipcRenderer.invoke('document:drop', webUtils.getPathForFile(file)),
  openLink: href => ipcRenderer.invoke('document:link', href),
  onChange: callback => {
    const listener = (_, state) => callback(state);
    ipcRenderer.on('document:changed', listener);
    return () => ipcRenderer.removeListener('document:changed', listener);
  },
});
