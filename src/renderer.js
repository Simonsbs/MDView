import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';

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
const overlay = document.querySelector('#drop-overlay');
let lastPath = null;
let lastMarkdown = null;
let zoom = 100;
let layoutVersion = 0;

const blockKey = element => `${element.tagName}:${element.textContent}`;

function capturePosition() {
  const top = reader.getBoundingClientRect().top;
  const blocks = [...article.children];
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
  const match = [...article.children].filter(element => blockKey(element) === position.key)[position.occurrence];
  reader.scrollTop = match
    ? reader.scrollTop + match.getBoundingClientRect().top - reader.getBoundingClientRect().top - position.offset
    : position.top;
}

function render(state) {
  fileName.textContent = state.name || 'MDView';
  fileName.title = state.path || '';
  notice.textContent = state.notice || state.error;
  notice.hidden = !notice.textContent;
  watchStatus.hidden = !state.path;
  watchStatus.classList.toggle('waiting', Boolean(state.error));
  watchLabel.textContent = state.error ? 'Waiting' : 'Live';
  watchStatus.title = state.error || 'Watching this file for changes';
  emptyState.hidden = Boolean(state.path);
  article.hidden = !state.path;
  emptyFile.hidden = !state.path || Boolean(state.markdown.trim());
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

document.querySelector('#open-file').addEventListener('click', () => window.mdview.chooseFile());
window.addEventListener('keydown', event => {
  if (event.ctrlKey && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    if (!event.repeat) void window.mdview.chooseFile();
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

window.mdview.onChange(render);
window.mdview.getState().then(render);
