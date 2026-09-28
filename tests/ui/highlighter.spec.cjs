const { test, expect, _electron: electron } = require('@playwright/test');
const { mkdtemp, writeFile, readFile, rm } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

let application;
let page;
let directory;
let file;

async function launch(markdown) {
  if (markdown !== undefined) await writeFile(file, markdown);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const args = process.env.MDVIEW_EXECUTABLE ? [] : [path.resolve(__dirname, '../..')];
  args.push(file, '--no-default-registration', `--user-data-dir=${path.join(directory, 'profile')}`);
  application = await electron.launch({
    executablePath: process.env.MDVIEW_EXECUTABLE || undefined,
    args,
    env,
    timeout: 30000,
  });
  page = await application.firstWindow();
  page.on('dialog', () => {});
  await page.waitForLoadState('domcontentloaded');
  await page.emulateMedia({ colorScheme: null });
  await expect(page.locator('#highlight-toggle')).toBeVisible();
}

// Pointer actions use rendered text geometry, including words inside inline markup.
async function textPoint(selector, text, fraction = 0.5) {
  const target = page.locator(selector);
  await target.scrollIntoViewIfNeeded();
  return target.evaluate((element, { text, fraction }) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let content = '';
    while (walker.nextNode()) {
      nodes.push({ node: walker.currentNode, start: content.length });
      content += walker.currentNode.textContent;
    }
    const start = content.indexOf(text);
    if (start < 0) throw new Error(`Text not found: ${text}`);
    const offset = start + Math.min(text.length - 1, Math.floor(text.length * fraction));
    const entry = nodes.find(({ node, start }) => offset >= start && offset < start + node.length);
    const range = document.createRange();
    range.setStart(entry.node, offset - entry.start);
    range.setEnd(entry.node, offset - entry.start + 1);
    const rect = range.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, { text, fraction });
}

async function pointAt(selector, text, action = 'click') {
  const point = await textPoint(selector, text);
  if (action === 'hover') await page.mouse.move(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}

async function highlightedText() {
  return page.evaluate(() => [...(CSS.highlights.get('reading-focus') || [])]
    .map(range => range.toString()).join(' ').replace(/\s+/g, ' ').trim());
}

async function highlightRows() {
  return page.evaluate(() => {
    const tops = [...(CSS.highlights.get('reading-focus') || [])]
      .flatMap(range => [...range.getClientRects()])
      .filter(rect => rect.width > 0 && rect.height > 0)
      .map(rect => rect.top).sort((a, b) => a - b);
    return tops.filter((top, index) => index === 0 || top - tops[index - 1] > 2).length;
  });
}

async function expectHighlight(text) {
  await expect.poll(highlightedText).toBe(text);
}

async function enable(amount = 'sentence', mode = 'click') {
  await page.locator('#highlight-mode').selectOption(mode);
  await page.locator('#highlight-amount').selectOption(amount);
  await page.locator('#highlight-toggle').click();
  await expect(page.locator('#highlight-toggle')).toHaveAttribute('aria-pressed', 'true');
}

async function setCount(id, value) {
  await page.locator(`#highlight-${id}`).fill(String(value));
  await page.locator(`#highlight-${id}`).press('Tab');
}

async function setWidth(value) {
  await page.locator('#reading-width').evaluate((slider, width) => {
    slider.value = String(width);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await expect(page.locator('#width-level')).toHaveText(`${value}%`);
}

async function nativeDrag(start, end) {
  // CDP mouse moves do not establish a native selection in Electron 44 on Windows,
  // even with highlighting off. Electron input exercises the real selection path.
  await application.evaluate(({ BrowserWindow }, { start, end }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.focus();
    const view = window.webContents;
    view.sendInputEvent({ type: 'mouseMove', x: Math.round(start.x), y: Math.round(start.y) });
    view.sendInputEvent({ type: 'mouseDown', x: Math.round(start.x), y: Math.round(start.y), button: 'left', clickCount: 1 });
    for (let step = 1; step <= 12; step++) {
      view.sendInputEvent({
        type: 'mouseMove',
        x: Math.round(start.x + (end.x - start.x) * step / 12),
        y: Math.round(start.y + (end.y - start.y) * step / 12),
        button: 'left',
      });
    }
    view.sendInputEvent({ type: 'mouseUp', x: Math.round(end.x), y: Math.round(end.y), button: 'left', clickCount: 1 });
  }, { start, end });
}

test.beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'mdview-highlighter-ui-'));
  file = path.join(directory, 'reading notes.md');
});

test.afterEach(async () => {
  if (application) {
    if (page && !page.isClosed()) await page.evaluate(() => window.mdview.setDirty(false)).catch(() => {});
    await application.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 0; }).catch(() => {});
    await application.close();
    application = null;
  }
  page = null;
  await rm(directory, { recursive: true, force: true });
});

test('click highlights complete sentences and paragraphs without changing the document', async () => {
  const source = 'The first sentence ends here. The second **bold sentence** ends here! Is this the third?\n\nA separate paragraph.\n';
  await launch(source);
  const originalHtml = await page.locator('#markdown').innerHTML();
  await expect(page.locator('#highlight-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#highlight-mode')).toHaveValue('click');
  await expect(page.locator('#highlight-amount')).toHaveValue('sentence');
  await expect(page.locator('#highlight-before')).toHaveValue('0');
  await expect(page.locator('#highlight-after')).toHaveValue('0');
  await expect(page.locator('#highlight-before')).toBeHidden();
  await pointAt('#markdown p:first-child', 'bold');
  await expectHighlight('');

  await enable();
  await pointAt('#markdown p:first-child', 'bold');
  await expectHighlight('The second bold sentence ends here!');
  await pointAt('#markdown p:last-child', 'separate', 'hover');
  await expectHighlight('The second bold sentence ends here!');
  await pointAt('#markdown p:first-child', 'third');
  await expectHighlight('Is this the third?');
  await page.locator('#highlight-amount').selectOption('paragraph');
  await expectHighlight('The first sentence ends here. The second bold sentence ends here! Is this the third?');
  await page.keyboard.press('Escape');
  await expectHighlight('');
  await pointAt('#markdown p:last-child', 'separate');
  await expectHighlight('A separate paragraph.');
  await page.locator('#highlight-toggle').click();
  await expectHighlight('');
  expect(await page.locator('#markdown').innerHTML()).toBe(originalHtml);
  expect(await readFile(file, 'utf8')).toBe(source);
});

test('hover follows the pointer, clears on leaving content, and mode changes clear the anchor', async () => {
  await launch('First sentence. Second sentence.\n\nAnother paragraph.');
  await enable('sentence', 'hover');
  await pointAt('#markdown p:first-child', 'First', 'hover');
  await expectHighlight('First sentence.');
  await pointAt('#markdown p:first-child', 'Second', 'hover');
  await expectHighlight('Second sentence.');
  await page.locator('#highlight-toggle').hover();
  await expectHighlight('');
  await pointAt('#markdown p:last-child', 'Another', 'hover');
  await expectHighlight('Another paragraph.');
  await page.locator('#highlight-mode').selectOption('click');
  await expectHighlight('');
  await pointAt('#markdown p:first-child', 'First', 'hover');
  await expectHighlight('');
  await pointAt('#markdown p:first-child', 'First');
  await expectHighlight('First sentence.');
  await page.locator('#highlight-mode').selectOption('hover');
  await expectHighlight('');
});

test('chunks support one word, asymmetric counts and passage boundaries', async () => {
  await launch('alpha bravo charlie\n\ndelta **echo** foxtrot golf');
  await enable('chunk');
  await expect(page.getByLabel('Words before', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Words after', { exact: true })).toBeVisible();
  await expect(page.locator('#highlight-before')).toHaveAttribute('min', '0');
  await expect(page.locator('#highlight-after')).toHaveAttribute('min', '0');
  await pointAt('#markdown p:last-child', 'echo');
  await expectHighlight('echo');
  await setCount('before', 2);
  await setCount('after', 1);
  await expectHighlight('charlie delta echo foxtrot');
  await application.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light'; });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({ path: 'test-results/highlight-light.png' });
  await page.locator('#theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'test-results/highlight-dark.png' });
  await setCount('before', 0);
  await setCount('after', 0);
  await expectHighlight('echo');
  await setCount('before', 1000);
  await setCount('after', 1000);
  await expectHighlight('alpha bravo charlie delta echo foxtrot golf');
  await page.locator('#highlight-amount').selectOption('paragraph');
  await expect(page.locator('#highlight-before')).toBeHidden();
  await expectHighlight('delta echo foxtrot golf');
});

test('rows track wrapped inline text and reflow after width and text size changes', async () => {
  const paragraph = 'Alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima **target november oscar papa** quebec romeo sierra tango uniform victor whiskey xray yankee zulu.';
  await launch(paragraph);
  await setWidth(35);
  await enable('row');
  await pointAt('#markdown p', 'target');
  const narrowText = await highlightedText();
  expect(narrowText).toContain('target');
  await expect.poll(highlightRows).toBe(1);
  await page.locator('#highlight-amount').selectOption('paragraph');
  await expectHighlight(paragraph.replaceAll('**', ''));
  expect(await highlightRows()).toBeGreaterThan(1);
  await page.locator('#highlight-amount').selectOption('row');
  await setWidth(90);
  await expect.poll(highlightedText).not.toBe(narrowText);
  expect(await highlightedText()).toContain('target');
  await expect.poll(highlightRows).toBe(1);
  const wideText = await highlightedText();
  const point = await textPoint('#markdown p', 'target');
  await page.mouse.move(point.x, point.y);
  await page.keyboard.down('Control');
  for (let index = 0; index < 8; index++) {
    await page.mouse.wheel(0, -120);
    await expect(page.locator('#zoom-level')).toHaveText(`${110 + index * 10}%`);
  }
  await page.keyboard.up('Control');
  await expect(page.locator('#zoom-level')).toHaveText('180%');
  await expect.poll(highlightedText).not.toBe(wideText);
  expect(await highlightedText()).toContain('target');
  await expect.poll(highlightRows).toBe(1);
});

test('word chunks preserve Hebrew combining marks and count adjacent words', async () => {
  await launch('אחד שָׁלוֹם שלוש ארבע');
  await enable('chunk');
  await pointAt('#markdown p', 'שָׁלוֹם');
  await expectHighlight('שָׁלוֹם');
  await setCount('before', 1);
  await setCount('after', 1);
  await expectHighlight('אחד שָׁלוֹם שלוש');
});

test('paragraphs isolate list items and table cells, while code rows follow real line breaks', async () => {
  await launch('- Outer **list entry**\n  - Nested child entry\n- Sibling entry\n\n| Left | Right |\n| --- | --- |\n| First cell | Second cell |\n\n```text\nfirst code line\nsecond code line\nthird code line\n```');
  await enable('paragraph');
  await pointAt('#markdown > ul > li:first-child', 'Outer');
  await expectHighlight('Outer list entry');
  await pointAt('#markdown ul ul li', 'Nested');
  await expectHighlight('Nested child entry');
  await pointAt('#markdown tbody td:first-child', 'First');
  await expectHighlight('First cell');
  await pointAt('#markdown pre code', 'second');
  await expectHighlight('first code line second code line third code line');
  await page.locator('#highlight-amount').selectOption('row');
  await expectHighlight('second code line');
  await expect.poll(highlightRows).toBe(1);
  await pointAt('#markdown tbody td:last-child', 'Second');
  await expectHighlight('Second cell');
});

test('row boundaries honor hard breaks while including inline formatting', async () => {
  await launch('First **bold** *italic* `code` row.  \nSecond short row.');
  await enable('row');
  await pointAt('#markdown p', 'italic');
  await expectHighlight('First bold italic code row.');
  await pointAt('#markdown p', 'Second');
  await expectHighlight('Second short row.');
  await page.locator('#highlight-amount').selectOption('chunk');
  await pointAt('#markdown p', 'row.', 'click');
  await expectHighlight('row');
});

test('paragraphs include text on both sides of an inline image', async () => {
  await writeFile(path.join(directory, 'marker.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><circle cx="9" cy="9" r="8" fill="#35675b"/></svg>');
  await launch('Before image ![Inline marker](marker.svg) after image.');
  await expect.poll(() => page.locator('#markdown img').evaluate(image => image.naturalWidth)).toBe(18);
  const originalHtml = await page.locator('#markdown').innerHTML();
  await enable('paragraph');
  await pointAt('#markdown p', 'Before');
  await expectHighlight('Before image after image.');
  await pointAt('#markdown p', 'after');
  await expectHighlight('Before image after image.');
  expect(await page.locator('#markdown').innerHTML()).toBe(originalHtml);
});

test('highlight settings survive application restart', async () => {
  await launch('Read these words again.');
  await enable('chunk', 'hover');
  await setCount('before', 3);
  await setCount('after', 7);
  expect(await page.evaluate(() => Object.fromEntries(['enabled', 'mode', 'amount', 'before', 'after']
    .map(key => [key, localStorage.getItem(`mdview.highlight.${key}`)]))))
    .toEqual({ enabled: 'true', mode: 'hover', amount: 'chunk', before: '3', after: '7' });
  await application.close();
  application = null;
  await launch();
  await expect(page.locator('#highlight-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#highlight-mode')).toHaveValue('hover');
  await expect(page.locator('#highlight-amount')).toHaveValue('chunk');
  await expect(page.locator('#highlight-before')).toHaveValue('3');
  await expect(page.locator('#highlight-after')).toHaveValue('7');
  await expectHighlight('');
  await pointAt('#markdown p', 'these', 'hover');
  await expectHighlight('Read these words again');
});

test('all highlight controls remain usable in a narrow window', async () => {
  await launch('A short highlighted paragraph in a narrow window.');
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setBounds({ width: 440, height: 800 });
  });
  await enable('chunk');
  await setCount('before', 1);
  await setCount('after', 2);
  await pointAt('#markdown p', 'highlighted');
  await expectHighlight('short highlighted paragraph in');
  for (const id of ['highlight-toggle', 'highlight-mode', 'highlight-amount', 'highlight-before', 'highlight-after']) {
    const control = page.locator(`#${id}`);
    await expect(control).toBeVisible();
    const bounds = await control.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  }
  await page.screenshot({ path: 'test-results/highlight-narrow.png' });
});

test('live refresh and editing clear old ranges and resume highlighting on the current preview', async () => {
  await launch('Original sentence.');
  await enable();
  await pointAt('#markdown p', 'Original');
  await expectHighlight('Original sentence.');
  await writeFile(file, 'Replacement sentence.');
  await expect(page.locator('#markdown p')).toHaveText('Replacement sentence.');
  await expectHighlight('');
  await pointAt('#markdown p', 'Replacement');
  await expectHighlight('Replacement sentence.');
  await page.locator('#edit-file').click();
  await expect(page.getByRole('textbox', { name: 'Edit Markdown document' })).toBeVisible();
  await expect(page.locator('#highlight-toolbar')).toBeHidden();
  await expectHighlight('');
  await pointAt('#editor .ProseMirror p', 'Replacement');
  await expectHighlight('');
  await page.locator('#cancel-edit').click();
  await expect(page.locator('#highlight-toolbar')).toBeVisible();
  await expect(page.locator('#highlight-toggle')).toHaveAttribute('aria-pressed', 'true');
  await pointAt('#markdown p', 'Replacement');
  await expectHighlight('Replacement sentence.');
  expect(await readFile(file, 'utf8')).toBe('Replacement sentence.');
});

test('enabled highlights preserve links and native drag selection', async () => {
  await launch('Alpha bravo charlie delta echo foxtrot.\n\n[Website](https://example.com/)\n\n[Next document](next.md)');
  await writeFile(path.join(directory, 'next.md'), 'Next document content.');
  await application.evaluate(({ shell }) => {
    global.openedLink = null;
    shell.openExternal = async href => { global.openedLink = href; };
  });
  const start = await textPoint('#markdown p:first-child', 'bravo', 0);
  const end = await textPoint('#markdown p:first-child', 'echo', 1);
  await nativeDrag(start, end);
  await expect.poll(() => page.evaluate(() => getSelection().toString())).toContain('charlie delta');
  await enable('chunk');
  await pointAt('#markdown p:first-child', 'Alpha');
  await expectHighlight('Alpha');
  await nativeDrag(start, end);
  await expect.poll(() => page.evaluate(() => getSelection().toString())).toContain('charlie delta');
  expect(await highlightedText()).not.toBe('echo');
  await page.getByRole('link', { name: 'Website' }).click();
  await expect.poll(() => application.evaluate(() => global.openedLink)).toBe('https://example.com/');
  await page.getByRole('link', { name: 'Next document' }).click();
  await expect(page.locator('#markdown')).toHaveText('Next document content.');
  await expectHighlight('');
});
