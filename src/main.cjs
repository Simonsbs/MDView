const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, session, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { access, mkdir, writeFile } = require('node:fs/promises');
const { MarkdownDocument, isMarkdown, describeError } = require('./document.cjs');
const { registerDefault } = require('./default-app.cjs');

const PAGE_URL = 'mdview://app/index.html';
const document = new MarkdownDocument();
let window;
let notice = '';
let choosingFile = false;
let openingFile = false;
let savingFile = false;
let dirty = false;

app.setName('MDView');
protocol.registerSchemesAsPrivileged([
  { scheme: 'mdview', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function state() {
  return { ...document.state, notice, documentId: document.generation };
}

function publish() {
  if (!window || window.isDestroyed()) return;
  window.setTitle(document.state.path ? `${document.state.name} | MDView` : 'MDView');
  window.webContents.send('document:changed', state());
}

function confirmDiscard(force = false) {
  if (!dirty && !force) return true;
  return dialog.showMessageBoxSync(window, {
    type: 'warning',
    title: 'Unsaved changes',
    message: 'Discard your unsaved changes?',
    detail: 'Your edits will be lost if you continue.',
    buttons: ['Discard changes', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  }) === 0;
}

async function openFile(file) {
  if (savingFile || openingFile || !confirmDiscard()) return;
  openingFile = true;
  try {
    await document.open(file);
    dirty = false;
    notice = '';
  } catch (error) {
    notice = `Could not open ${path.basename(String(file))}. ${describeError(error)}`;
  } finally {
    openingFile = false;
  }
  publish();
}

async function chooseFile() {
  if (choosingFile || savingFile || openingFile) return;
  choosingFile = true;
  try {
    const result = await dialog.showOpenDialog(window, {
      title: 'Open Markdown file',
      defaultPath: document.state.path || app.getPath('documents'),
      properties: ['openFile'],
      filters: [{ name: 'Markdown files', extensions: ['md', 'markdown', 'mdown', 'mkd'] }],
    });
    if (!result.canceled && result.filePaths[0]) await openFile(result.filePaths[0]);
  } finally {
    choosingFile = false;
  }
}

async function saveFile(request) {
  if (savingFile || openingFile || choosingFile) return { ok: false, error: 'Wait for the current file operation to finish.', state: state() };
  if (!request || typeof request !== 'object' || request.documentId !== document.generation) {
    return { ok: false, error: 'This document is no longer open. Your edits have been kept.', state: state() };
  }
  savingFile = true;
  try {
    await document.save(request.markdown, request.baseMarkdown, request.documentId);
    dirty = false;
    notice = '';
    publish();
    return { ok: true, state: state() };
  } catch (error) {
    return { ok: false, error: error.message || 'The file could not be saved. Your edits have been kept.', conflict: error.code === 'DOCUMENT_CONFLICT', state: state() };
  } finally {
    savingFile = false;
  }
}

function trusted(event) {
  return window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame?.url === PAGE_URL;
}

function handle(channel, action) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trusted(event)) throw new Error('Untrusted request.');
    return action(...args);
  });
}

async function followLink(href) {
  if (typeof href !== 'string') return;
  try {
    const base = document.state.path ? pathToFileURL(document.state.path).href : PAGE_URL;
    const url = new URL(href, base);
    if (['https:', 'http:', 'mailto:'].includes(url.protocol)) {
      await shell.openExternal(url.href);
    } else if (url.protocol === 'file:' && isMarkdown(url.pathname)) {
      url.hash = '';
      url.search = '';
      await openFile(fileURLToPath(url));
    }
  } catch (error) {
    notice = `Could not open the link. ${describeError(error)}`;
    publish();
  }
}

app.whenReady().then(async () => {
  protocol.handle('mdview', async request => {
    try {
      const url = new URL(request.url);
      if (url.host === 'app' && ['/index.html', '/styles.css', '/renderer.js'].includes(url.pathname)) {
        return net.fetch(pathToFileURL(path.join(__dirname, '..', 'dist', url.pathname.slice(1))).href);
      }
      if (url.host === 'image' && document.state.path && url.searchParams.get('document') === String(document.generation)) {
        const source = url.searchParams.get('source');
        if (!source) return new Response('Not found', { status: 404 });
        const imageUrl = new URL(source, pathToFileURL(document.state.path).href);
        if (imageUrl.protocol !== 'file:') return new Response('Not found', { status: 404 });
        const imagePath = fileURLToPath(imageUrl);
        if (!/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(imagePath)) return new Response('Not an image', { status: 403 });
        return await net.fetch(pathToFileURL(imagePath).href);
      }
    } catch { /* Missing images remain ordinary broken-image placeholders. */ }
    return new Response('Not found', { status: 404 });
  });

  session.defaultSession.setPermissionRequestHandler((_, __, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  Menu.setApplicationMenu(null);

  handle('document:state', state);
  handle('document:choose', chooseFile);
  handle('document:drop', file => typeof file === 'string' && file ? openFile(file) : undefined);
  handle('document:link', followLink);
  handle('document:save', saveFile);
  handle('document:dirty', value => { if (typeof value === 'boolean') dirty = value; });
  document.on('change', () => { notice = ''; publish(); });

  window = new BrowserWindow({
    width: 1040,
    height: 800,
    minWidth: 440,
    minHeight: 320,
    title: 'MDView',
    backgroundColor: '#fafaf8',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      navigateOnDragDrop: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  // Only the document text changes size. Native browser zoom stays disabled.
  window.webContents.setZoomMode('disabled');
  window.once('ready-to-show', () => window.show());
  window.on('close', event => {
    if (savingFile) {
      event.preventDefault();
      notice = 'Wait for the current save to finish before closing MDView.';
      publish();
    } else if (dirty) {
      event.preventDefault();
      // This is an explicit native discard approval. Bypass beforeunload once,
      // because the renderer still holds the draft we just agreed to discard.
      if (confirmDiscard()) window.destroy();
    }
  });
  window.webContents.on('will-prevent-unload', event => {
    // The renderer can notice an edit before its dirty IPC reaches this process.
    // preventDefault here allows the close, so only do it after approval.
    if (!savingFile && confirmDiscard(true)) event.preventDefault();
  });
  window.on('closed', () => { document.close(); window = null; });
  await window.loadURL(PAGE_URL);
  const args = process.argv.slice(process.defaultApp ? 2 : 1);
  const file = args.find(arg => !arg.startsWith('-'));
  if (file) await openFile(file);
  const marker = path.join(app.getPath('userData'), 'default-app-registration-v1');
  let alreadyRegistered = false;
  try { await access(marker); alreadyRegistered = true; } catch {}
  const shouldRegister = args.includes('--make-default') || (app.isPackaged && process.platform === 'linux' && !alreadyRegistered);
  if (shouldRegister && !args.includes('--no-default-registration')) {
    try {
      const executable = process.env.PORTABLE_EXECUTABLE_FILE || process.env.APPIMAGE || process.execPath;
      const result = await registerDefault({ executable, icon: path.join(__dirname, '..', 'assets', 'icon.png') });
      await mkdir(app.getPath('userData'), { recursive: true });
      await writeFile(marker, executable, 'utf8');
      if (result.needsWindowsConfirmation) {
        notice = 'In Windows Default apps, select MDView for .md files. On Windows 10, choose defaults by file type and find .md.';
        publish();
        await shell.openExternal('ms-settings:defaultapps?registeredAppUser=MDView');
      }
    } catch (error) {
      notice = `Could not set the .md default. ${describeError(error)}`;
      publish();
    }
  }
}).catch(error => {
  dialog.showErrorBox('MDView could not start', error.message);
  app.quit();
});

app.on('window-all-closed', () => app.quit());
