import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import { createVisualEditor } from './editor.js';

const markdown = new MarkdownIt({ html: false, linkify: true, typographer: false }).use(taskLists);
const reader = document.querySelector('#reader');
const article = document.querySelector('#markdown');
const emptyState = document.querySelector('#empty-state');
const emptyFile = document.querySelector('#empty-file');
const fileName = document.querySelector('#file-name');
const notice = document.querySelector('#notice');
const watchStatus = document.querySelector('#watch-status');
const watchLabel = document.querySelector('#watch-label');
const zoomLabel = document.querySelector('#zoom-level');
const widthSlider = document.querySelector('#reading-width');
const widthLabel = document.querySelector('#width-level');
const themeToggle = document.querySelector('#theme-toggle');
const overlay = document.querySelector('#drop-overlay');
const editorHost = document.querySelector('#editor');
const editButton = document.querySelector('#edit-file');
const saveButton = document.querySelector('#save-file');
const cancelButton = document.querySelector('#cancel-edit');
const editToolbar = document.querySelector('#edit-toolbar');
const editStatus = document.querySelector('#edit-status');
const discardDialog = document.querySelector('#discard-dialog');
const insertDialog = document.querySelector('#insert-dialog');
let currentState = null;
let editor = null;
let editBase = null;
let saving = false;
let savedInSession = false;
let editError = '';
let insertKind = 'link';
let reportedDirty = false;
let lastPath = null;
let lastMarkdown = null;
let zoom = 100;
let layoutVersion = 0;

function readPreference(key) {
  try { return localStorage.getItem(`mdview.${key}`); }
  catch { return null; }
}

function savePreference(key, value) {
  try { localStorage.setItem(`mdview.${key}`, String(value)); }
  catch { /* The controls still work when preferences cannot be saved. */ }
}

const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
const savedTheme = readPreference('theme');
let preferredTheme = ['light', 'dark'].includes(savedTheme) ? savedTheme : null;

function applyTheme() {
  const theme = preferredTheme || (systemTheme.matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
  themeToggle.setAttribute('aria-checked', String(theme === 'dark'));
  themeToggle.title = `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`;
}

function applyWidth(width) {
  article.style.setProperty('--reading-width', `${width}%`);
  editorHost.style.setProperty('--reading-width', `${width}%`);
  widthSlider.value = String(width);
  widthSlider.setAttribute('aria-valuetext', `${width}% of the window`);
  widthLabel.textContent = `${width}%`;
}

applyTheme();
const savedWidth = Number(readPreference('width'));
applyWidth(Number.isFinite(savedWidth) && savedWidth >= 20 && savedWidth <= 100 ? Math.round(savedWidth) : 80);
systemTheme.addEventListener('change', () => { if (!preferredTheme) applyTheme(); });
themeToggle.addEventListener('click', () => {
  preferredTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme();
  savePreference('theme', preferredTheme);
});
widthSlider.addEventListener('input', () => {
  const position = capturePosition();
  const width = widthSlider.valueAsNumber;
  applyWidth(width);
  layoutVersion++;
  restorePosition(position);
  savePreference('width', width);
});

const blockKey = element => `${element.tagName}:${element.textContent}`;

function capturePosition() {
  const top = reader.getBoundingClientRect().top;
  const blocks = [...(editor?.view.dom || article).children];
  const index = blocks.findIndex(element => element.getBoundingClientRect().bottom > top + 1);
  const block = blocks[index];
  const key = block ? blockKey(block) : null;
  return {
    top: reader.scrollTop,
    key,
    occurrence: blocks.slice(0, index).filter(element => blockKey(element) === key).length,
    offset: block ? block.getBoundingClientRect().top - top : 0,
  };
}

function restorePosition(position) {
  if (position.top === 0) { reader.scrollTop = 0; return; }
  const match = [...(editor?.view.dom || article).children].filter(element => blockKey(element) === position.key)[position.occurrence];
  reader.scrollTop = match
    ? reader.scrollTop + match.getBoundingClientRect().top - reader.getBoundingClientRect().top - position.offset
    : position.top;
}

function render(state) {
  if (editor && state.documentId !== editBase.documentId) stopEditing();
  currentState = state;
  fileName.textContent = state.name || 'MDView';
  fileName.title = state.path || '';
  notice.textContent = editError || (editor && !saving && state.markdown !== editBase.markdown
    ? 'This file changed in another app. Your draft is kept here. Cancel editing to load the latest version before making further changes.'
    : state.notice || state.error);
  notice.hidden = !notice.textContent;
  watchStatus.hidden = !state.path;
  watchStatus.classList.toggle('waiting', Boolean(state.error));
  watchLabel.textContent = editor ? 'Editing' : state.error ? 'Waiting' : 'Live';
  watchStatus.title = state.error || 'Watching this file for changes';
  emptyState.hidden = Boolean(state.path);
  article.hidden = !state.path || Boolean(editor);
  emptyFile.hidden = Boolean(editor) || !state.path || Boolean(state.markdown.trim());
  editButton.hidden = !state.path || Boolean(editor);
  editButton.disabled = Boolean(state.error);
  if (editor) return;
  if (state.path === lastPath && state.markdown === lastMarkdown) return;

  const sameDocument = state.path === lastPath;
  const position = capturePosition();
  const version = ++layoutVersion;
  article.innerHTML = markdown.render(state.markdown);
  const headingIds = new Map();
  for (const heading of article.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    const slug = heading.textContent.trim().toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/g, '-') || 'section';
    const count = headingIds.get(slug) || 0;
    headingIds.set(slug, count + 1);
    heading.id = count ? `${slug}-${count}` : slug;
  }
  for (const image of article.querySelectorAll('img')) {
    const source = image.getAttribute('src');
    if (source && !/^(https?:|data:|\/\/)/i.test(source)) {
      const params = new URLSearchParams({ document: state.documentId, source });
      image.src = `mdview://image/?${params}`;
    } else if (source?.startsWith('//')) {
      image.src = `https:${source}`;
    }
    image.referrerPolicy = 'no-referrer';
  }
  if (sameDocument) restorePosition(position);
  else reader.scrollTop = 0;

  // Images may finish after the text. Restore only if the user has not scrolled.
  const initialScroll = reader.scrollTop;
  Promise.all([...article.querySelectorAll('img')].map(image => image.decode().catch(() => {}))).then(() => {
    if (sameDocument && version === layoutVersion && Math.abs(reader.scrollTop - initialScroll) < 2) restorePosition(position);
  });
  lastPath = state.path;
  lastMarkdown = state.markdown;
}

function updateEditing() {
  if (!editor) return;
  const dirty = editor.dirty;
  if (dirty !== reportedDirty) {
    reportedDirty = dirty;
    void window.mdview.setDirty(dirty);
  }
  editStatus.textContent = saving ? 'Saving...' : dirty ? 'Unsaved changes' : savedInSession ? 'Saved' : 'Editing';
  saveButton.disabled = saving;
  cancelButton.disabled = saving;
  editor.updateToolbar(editToolbar);
}

function startEditing() {
  if (editor || !currentState?.path || currentState.error) return;
  editError = '';
  savedInSession = false;
  const position = capturePosition();
  editBase = currentState;
  try {
    editor = createVisualEditor(editorHost, {
      markdown: editBase.markdown, documentId: editBase.documentId, onChange: updateEditing,
    });
  } catch (error) {
    editError = `Could not edit this document. ${error.message}`;
    editorHost.replaceChildren();
    editBase = null;
    render(currentState);
    return;
  }
  editorHost.hidden = false;
  editorHost.inert = false;
  editToolbar.hidden = false;
  saveButton.hidden = false;
  cancelButton.hidden = false;
  layoutVersion++;
  render(currentState);
  restorePosition(position);
  editor.view.focus();
  updateEditing();
}

function stopEditing() {
  editor?.destroy();
  editor = null;
  editorHost.replaceChildren();
  editorHost.hidden = true;
  editToolbar.hidden = true;
  saveButton.hidden = true;
  cancelButton.hidden = true;
  discardDialog.close();
  insertDialog.close();
  editBase = null;
  editError = '';
  savedInSession = false;
  reportedDirty = false;
  void window.mdview.setDirty(false);
}

function leaveEditing() {
  const position = capturePosition();
  stopEditing();
  // Re-render even after a save whose watcher event arrived during editing.
  lastMarkdown = null;
  render(currentState);
  restorePosition(position);
}

async function saveEditing() {
  if (!editor || saving) return;
  if (!editor.dirty) {
    savedInSession = true;
    updateEditing();
    editor.view.focus();
    return;
  }
  saving = true;
  editError = '';
  editor.view.setProps({ editable: () => false });
  editorHost.inert = true;
  editToolbar.inert = true;
  updateEditing();
  try {
    const result = await window.mdview.save({
      markdown: editor.getMarkdown(), baseMarkdown: editBase.markdown, documentId: editBase.documentId,
    });
    if (result.ok) {
      currentState = result.state;
      editBase = result.state;
      editor.markSaved();
      savedInSession = true;
    } else {
      editError = result.error;
      if (result.state) currentState = result.state;
      render(currentState);
    }
  } catch (error) {
    editError = `Could not save. ${error.message}`;
    render(currentState);
  } finally {
    saving = false;
    editorHost.inert = false;
    editToolbar.inert = false;
    editor?.view.setProps({ editable: () => true });
    updateEditing();
    render(currentState);
    editor?.view.focus();
  }
}

function cancelEditing() {
  if (!editor || saving) return;
  if (editor.dirty) {
    discardDialog.returnValue = 'keep';
    discardDialog.showModal();
  }
  else leaveEditing();
}

editButton.addEventListener('click', startEditing);
saveButton.addEventListener('click', () => void saveEditing());
cancelButton.addEventListener('click', cancelEditing);
discardDialog.addEventListener('close', () => {
  if (!editor) return;
  if (discardDialog.returnValue === 'discard') leaveEditing();
  else editor.view.focus();
});
// Preserve the selection when a formatting button is clicked.
editToolbar.addEventListener('mousedown', event => { if (event.target.closest('button')) event.preventDefault(); });
editToolbar.addEventListener('click', event => {
  const command = event.target.closest('[data-command]')?.dataset.command;
  if (!command || !editor || saving) return;
  if (['link', 'image'].includes(command)) {
    insertKind = command;
    document.querySelector('#insert-title').textContent = `Insert ${command}`;
    document.querySelector('#insert-text-label').textContent = command === 'image' ? 'Image description' : 'Link text';
    document.querySelector('#insert-text').value = editor.selectionText();
    document.querySelector('#insert-url').value = '';
    document.querySelector('#insert-error').hidden = true;
    insertDialog.showModal();
    document.querySelector('#insert-url').focus();
  } else editor.run(command);
});
document.querySelector('#block-format').addEventListener('change', event => editor?.setBlock(event.target.value));
document.querySelector('#insert-cancel').addEventListener('click', () => insertDialog.close());
insertDialog.addEventListener('close', () => editor?.view.focus());
document.querySelector('#insert-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!editor) return;
  const url = document.querySelector('#insert-url').value.trim();
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(url)?.[1]?.toLowerCase();
  if (!url || (scheme && !['https', 'http', ...(insertKind === 'link' ? ['mailto'] : [])].includes(scheme))) {
    const error = document.querySelector('#insert-error');
    error.textContent = 'Use a web URL or a relative file path.';
    error.hidden = false;
    return;
  }
  editor.insert(insertKind, document.querySelector('#insert-text').value, url);
  insertDialog.close();
});

document.querySelector('#open-file').addEventListener('click', () => window.mdview.chooseFile());
window.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    if (!event.repeat) void window.mdview.chooseFile();
  }
  if ((event.ctrlKey || event.metaKey) && ['s', 'e'].includes(event.key.toLowerCase())) {
    event.preventDefault();
    if (event.repeat || document.querySelector('dialog[open]')) return;
    if (event.key.toLowerCase() === 's') void saveEditing();
    else if (editor) cancelEditing();
    else startEditing();
  }
});

window.addEventListener('wheel', event => {
  if (!event.ctrlKey) return;
  event.preventDefault();
  if (!event.deltaY) return;
  const nextZoom = Math.min(300, Math.max(50, zoom + (event.deltaY < 0 ? 10 : -10)));
  if (nextZoom === zoom) return;
  const position = capturePosition();
  zoom = nextZoom;
  article.style.fontSize = `${18 * zoom / 100}px`;
  editorHost.style.fontSize = `${18 * zoom / 100}px`;
  zoomLabel.textContent = `${zoom}%`;
  layoutVersion++;
  restorePosition(position);
}, { passive: false });

article.addEventListener('click', event => {
  const anchor = event.target.closest('a');
  if (!anchor) return;
  event.preventDefault();
  const href = anchor.getAttribute('href');
  if (!href) return;
  if (href.startsWith('#')) {
    try { document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ block: 'start' }); }
    catch { /* Ignore malformed anchors. */ }
  } else {
    void window.mdview.openLink(href);
  }
});

let dragDepth = 0;
window.addEventListener('dragenter', event => {
  event.preventDefault();
  if (event.dataTransfer.types.includes('Files')) { dragDepth++; overlay.hidden = false; }
});
window.addEventListener('dragover', event => {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('dragleave', event => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) overlay.hidden = true;
});
window.addEventListener('drop', event => {
  event.preventDefault();
  dragDepth = 0;
  overlay.hidden = true;
  const file = event.dataTransfer.files[0];
  if (file) void window.mdview.openDroppedFile(file);
});
window.addEventListener('blur', () => { dragDepth = 0; overlay.hidden = true; });
window.addEventListener('beforeunload', event => {
  if (saving || editor?.dirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});

window.mdview.onChange(render);
window.mdview.getState().then(render);
