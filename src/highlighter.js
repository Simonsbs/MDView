const HIGHLIGHT_NAME = 'reading-focus';
const BLOCKS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'PRE', 'TD', 'TH', 'DT', 'DD', 'BLOCKQUOTE', 'DIV', 'SECTION', 'ARTICLE', 'UL', 'OL', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'HR']);
const EXCLUDED = 'button, input, select, textarea, script, style, noscript, [hidden], [aria-hidden="true"], img, svg, video, audio, canvas';
const count = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0;

// Native highlights leave both the document and the user's text selection intact.
export function createHighlighter(article, reader) {
  const doc = article.ownerDocument;
  const win = doc.defaultView;
  const registry = win.CSS?.highlights;
  const supported = Boolean(registry && win.Highlight);
  const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
  const sentenceSegmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
  const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let settings = { enabled: false, mode: 'click', amount: 'row', before: 0, after: 0 };
  let blocks = new WeakMap();
  let nodeEntries = new WeakMap();
  let graphemes = new WeakMap();
  let nodeRects = new WeakMap();
  let anchor = null;
  let hoverPoint = null;
  let press = null;
  let frame = 0;
  let destroyed = false;
  let rowCache = null;

  function clear() {
    registry?.delete(HIGHLIGHT_NAME);
    anchor = null;
    rowCache = null;
  }

  function owner(node) {
    let element = node.parentElement;
    while (element && element !== article && !BLOCKS.has(element.tagName)) element = element.parentElement;
    return element || article;
  }

  function usable(node) {
    return node.nodeType === 3 && node.data.trim() && !node.parentElement?.closest(EXCLUDED);
  }

  // Each block is collected only when visited. Nested blocks split its own text
  // into separate runs so selecting a parent list item never selects its children.
  function collect(block) {
    const runs = [];
    let entries = [];
    let text = '';
    const preserved = block.tagName === 'PRE';
    function flush() {
      if (text.trim()) {
        const run = { entries, text, words: null, sentences: null };
        runs.push(run);
        for (const entry of entries) if (entry.node) nodeEntries.set(entry.node, { run, entry });
      }
      entries = [];
      text = '';
    }
    function visit(node) {
      if (node.nodeType === 3) {
        const value = preserved ? node.data : node.data.replace(/[\r\n\t]/g, ' ');
        entries.push({ node, start: text.length, end: text.length + value.length });
        text += value;
      } else if (node.nodeType === 1) {
        if (node.matches(EXCLUDED)) {
          entries.push({ node: null, start: text.length, end: text.length + 1 });
          text += ' ';
          return;
        }
        if (BLOCKS.has(node.tagName)) { flush(); return; }
        if (node.tagName === 'BR') {
          entries.push({ node: null, start: text.length, end: text.length + 1 });
          text += preserved ? '\n' : ' ';
        } else for (const child of node.childNodes) visit(child);
      }
    }
    for (const child of block.childNodes) visit(child);
    flush();
    blocks.set(block, runs);
  }

  function indexed(node) {
    if (!article.contains(node)) return null;
    const block = owner(node);
    if (!blocks.has(block)) collect(block);
    return nodeEntries.get(node) || null;
  }

  function character(node, offset) {
    let segments = graphemes.get(node);
    if (!segments) {
      segments = graphemeSegmenter.segment(node.data);
      graphemes.set(node, segments);
    }
    return segments.containing(offset);
  }

  function characterRect(node, start, end) {
    const range = doc.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    return range.getBoundingClientRect();
  }

  function lowerBound(length, predicate) {
    let lo = 0;
    let hi = length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (predicate(mid)) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  function hitTest(point) {
    const target = doc.elementFromPoint(point.x, point.y);
    if (!target || !article.contains(target) || target.closest(EXCLUDED)) return null;
    let node;
    let offset;
    if (doc.caretPositionFromPoint) {
      const position = doc.caretPositionFromPoint(point.x, point.y);
      node = position?.offsetNode;
      offset = position?.offset;
    } else {
      const range = doc.caretRangeFromPoint?.(point.x, point.y);
      node = range?.startContainer;
      offset = range?.startOffset;
    }
    if (node?.nodeType !== 3 || !node.length || !article.contains(node) || node.parentElement?.closest(EXCLUDED)) return null;
    // Caret APIs return the nearest insertion point even over empty margins.
    // Require a real glyph/space rectangle under the pointer before accepting it.
    for (const item of [character(node, offset), character(node, offset - 1)]) {
      if (!item) continue;
      const rect = characterRect(node, item.index, item.index + item.segment.length);
      if (rect.width > 0 && point.x >= rect.left - 0.5 && point.x <= rect.right + 0.5 && point.y >= rect.top && point.y <= rect.bottom) {
        return { node, offset: item.index, rect };
      }
    }
    return null;
  }

  function rangesFor(run, start, end) {
    let first = null;
    let last = null;
    for (const entry of run.entries) {
      if (!entry.node || entry.end <= start || entry.start >= end) continue;
      const from = Math.max(start, entry.start) - entry.start;
      const to = Math.min(end, entry.end) - entry.start;
      if (from === to) continue;
      first ||= { node: entry.node, offset: from };
      last = { node: entry.node, offset: to };
    }
    if (!first || !last) return [];
    const range = doc.createRange();
    range.setStart(first.node, first.offset);
    range.setEnd(last.node, last.offset);
    return [range];
  }

  function trimmedRange(run, start, end) {
    while (start < end && /\s/u.test(run.text[start])) start++;
    while (end > start && /\s/u.test(run.text[end - 1])) end--;
    return rangesFor(run, start, end);
  }

  function wordsFor(run) {
    return run.words ||= [...wordSegmenter.segment(run.text)]
      .filter(segment => segment.isWordLike || /\p{Extended_Pictographic}/u.test(segment.segment))
      .map(segment => ({ start: segment.index, end: segment.index + segment.segment.length }));
  }

  function neighbor(run, direction) {
    const entries = run.entries.filter(entry => entry.node);
    const walker = doc.createTreeWalker(article, win.NodeFilter.SHOW_TEXT, {
      acceptNode: node => usable(node) ? win.NodeFilter.FILTER_ACCEPT : win.NodeFilter.FILTER_REJECT,
    });
    walker.currentNode = direction < 0 ? entries[0].node : entries[entries.length - 1].node;
    let node;
    while ((node = direction < 0 ? walker.previousNode() : walker.nextNode())) {
      const next = indexed(node)?.run;
      if (next && next !== run) return next;
    }
    return null;
  }

  function chunk(run, offset) {
    const words = wordsFor(run);
    if (!words.length) return [];
    let target = lowerBound(words.length, index => words[index].end > offset);
    if (target === words.length) target--;
    else if (target > 0 && offset < words[target].start && offset - words[target - 1].end <= words[target].start - offset) target--;
    const selected = [{ run, start: Math.max(0, target - settings.before), end: Math.min(words.length - 1, target + settings.after) }];
    let remaining = settings.before - target;
    let next = run;
    while (remaining > 0 && (next = neighbor(next, -1))) {
      const adjacent = wordsFor(next);
      if (!adjacent.length) continue;
      const take = Math.min(remaining, adjacent.length);
      selected.push({ run: next, start: adjacent.length - take, end: adjacent.length - 1 });
      remaining -= take;
    }
    selected.reverse();
    remaining = settings.after - (words.length - 1 - target);
    next = run;
    while (remaining > 0 && (next = neighbor(next, 1))) {
      const adjacent = wordsFor(next);
      if (!adjacent.length) continue;
      const take = Math.min(remaining, adjacent.length);
      selected.push({ run: next, start: 0, end: take - 1 });
      remaining -= take;
    }
    return selected.flatMap(selection => {
      const list = wordsFor(selection.run);
      return rangesFor(selection.run, list[selection.start].start, list[selection.end].end);
    });
  }

  function sameRow(a, b) {
    return Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > Math.min(a.height, b.height) * 0.25;
  }

  function row(run, hit) {
    if (rowCache?.run === run && sameRow(rowCache.rect, hit.rect)) return rowCache.ranges;
    let start = Infinity;
    let end = -1;
    for (const entry of run.entries) {
      if (!entry.node || !entry.node.length) continue;
      let rects = nodeRects.get(entry.node);
      if (!rects) {
        const range = doc.createRange();
        range.selectNodeContents(entry.node);
        rects = [...range.getClientRects()];
        nodeRects.set(entry.node, rects);
      }
      if (!rects.some(rect => sameRow(rect, hit.rect))) continue;
      const length = entry.node.length;
      const rectAt = offset => {
        const item = character(entry.node, offset);
        return characterRect(entry.node, item.index, item.index + item.segment.length);
      };
      const first = lowerBound(length, index => rectAt(index).bottom > hit.rect.top + hit.rect.height * 0.25);
      const after = lowerBound(length, index => rectAt(index).top >= hit.rect.bottom - hit.rect.height * 0.25);
      if (first >= after) continue;
      start = Math.min(start, entry.start + first);
      end = Math.max(end, entry.start + after);
    }
    const ranges = end > start ? trimmedRange(run, start, end) : [];
    rowCache = { run, rect: hit.rect, ranges };
    return ranges;
  }

  function paint(hit) {
    if (!supported || !settings.enabled || !hit || !article.contains(hit.node)) { clear(); return; }
    const position = indexed(hit.node);
    if (!position) { clear(); return; }
    const { run, entry } = position;
    const offset = entry.start + hit.offset;
    let ranges;
    if (settings.amount === 'paragraph') ranges = trimmedRange(run, 0, run.text.length);
    else if (settings.amount === 'chunk') ranges = chunk(run, offset);
    else if (settings.amount === 'sentence') {
      run.sentences ||= [...sentenceSegmenter.segment(run.text)];
      const sentence = run.sentences[lowerBound(run.sentences.length, index => {
        const segment = run.sentences[index];
        return segment.index + segment.segment.length > offset;
      })];
      ranges = sentence ? trimmedRange(run, sentence.index, sentence.index + sentence.segment.length) : [];
    } else ranges = row(run, hit);
    if (!ranges.length) { clear(); return; }
    const highlight = new win.Highlight();
    for (const range of ranges) highlight.add(range);
    registry.set(HIGHLIGHT_NAME, highlight);
    anchor = { node: hit.node, offset: hit.offset };
  }

  function repaintAnchor() {
    if (!anchor || !article.contains(anchor.node)) { clear(); return; }
    const item = character(anchor.node, anchor.offset);
    if (!item) { clear(); return; }
    paint({ ...anchor, rect: characterRect(anchor.node, item.index, item.index + item.segment.length) });
  }

  function queueRefresh() {
    if (frame || destroyed || !settings.enabled) return;
    frame = win.requestAnimationFrame(() => {
      frame = 0;
      if (destroyed || !settings.enabled) return;
      if (settings.mode === 'hover') {
        if (hoverPoint) paint(hitTest(hoverPoint));
      } else if (anchor) repaintAnchor();
    });
  }

  function refresh() {
    nodeRects = new WeakMap();
    rowCache = null;
    queueRefresh();
  }

  function reset() {
    if (frame) win.cancelAnimationFrame(frame);
    frame = 0;
    clear();
    hoverPoint = null;
    blocks = new WeakMap();
    nodeEntries = new WeakMap();
    graphemes = new WeakMap();
    nodeRects = new WeakMap();
  }

  function configure(next) {
    const previous = settings;
    settings = {
      enabled: Boolean(next.enabled),
      mode: next.mode === 'hover' ? 'hover' : 'click',
      amount: ['row', 'sentence', 'paragraph', 'chunk'].includes(next.amount) ? next.amount : 'row',
      before: count(next.before), after: count(next.after),
    };
    if (!settings.enabled || previous.mode !== settings.mode || previous.enabled !== settings.enabled) {
      clear();
      hoverPoint = null;
    } else if (previous.amount !== settings.amount || previous.before !== settings.before || previous.after !== settings.after) {
      rowCache = null;
      if (anchor) repaintAnchor();
    }
  }

  function pointerDown(event) {
    press = { x: event.clientX, y: event.clientY, dragged: false };
    if (settings.mode === 'hover') { hoverPoint = null; clear(); }
  }

  function pointerMove(event) {
    if (press && event.buttons && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4) press.dragged = true;
    if (!settings.enabled || settings.mode !== 'hover') return;
    if (event.buttons) { hoverPoint = null; clear(); return; }
    hoverPoint = { x: event.clientX, y: event.clientY };
    queueRefresh();
  }

  function pointerLeave() {
    if (settings.mode === 'hover') { hoverPoint = null; clear(); }
  }

  function click(event) {
    const dragged = press?.dragged;
    press = null;
    if (!settings.enabled || settings.mode !== 'click' || event.button !== 0 || dragged) return;
    const selection = doc.getSelection();
    if (selection && !selection.isCollapsed && article.contains(selection.anchorNode)) return;
    const hit = hitTest({ x: event.clientX, y: event.clientY });
    if (hit) paint(hit);
  }

  function keyDown(event) {
    if (event.key === 'Escape') { hoverPoint = null; clear(); }
  }

  article.addEventListener('pointerdown', pointerDown);
  article.addEventListener('pointermove', pointerMove);
  article.addEventListener('pointerleave', pointerLeave);
  article.addEventListener('click', click);
  doc.addEventListener('keydown', keyDown);
  reader.addEventListener('scroll', refresh, true);
  win.addEventListener('resize', refresh);
  const observer = win.ResizeObserver ? new win.ResizeObserver(refresh) : null;
  observer?.observe(article);

  return {
    configure, reset, refresh,
    destroy() {
      destroyed = true;
      reset();
      observer?.disconnect();
      article.removeEventListener('pointerdown', pointerDown);
      article.removeEventListener('pointermove', pointerMove);
      article.removeEventListener('pointerleave', pointerLeave);
      article.removeEventListener('click', click);
      doc.removeEventListener('keydown', keyDown);
      reader.removeEventListener('scroll', refresh, true);
      win.removeEventListener('resize', refresh);
    },
  };
}
