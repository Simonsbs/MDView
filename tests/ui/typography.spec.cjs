const { test, expect, _electron: electron } = require('@playwright/test');
const { mkdtemp, writeFile, readFile, rm } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

let application;
let page;
let directory;
let file;

async function launch(markdown, filePath = file) {
  if (markdown !== undefined) await writeFile(filePath, markdown);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const args = process.env.MDVIEW_EXECUTABLE ? [] : [path.resolve(__dirname, '../..')];
  if (filePath) args.push(filePath);
  args.push('--no-default-registration', `--user-data-dir=${path.join(directory, 'profile')}`);
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
  await expect(page.locator('#typography-toolbar')).toBeVisible();
}

async function setLineHeight(value, positionChanges) {
  const slider = page.locator('#reading-line-height');
  const current = Number(await slider.inputValue());
  await slider.focus();
  const key = value >= current ? 'ArrowRight' : 'ArrowLeft';
  for (let step = 0; step < Math.round(Math.abs(value - current) * 10); step++) {
    const before = positionChanges ? await visiblePassage() : null;
    await slider.press(key);
    if (before) {
      const after = await visiblePassage();
      expect(after.text).toBe(before.text);
      const drift = after.offset - before.offset;
      expect(Math.abs(drift)).toBeLessThan(1);
      positionChanges.push({ lineHeight: await slider.inputValue(), drift });
    }
  }
  await expect(slider).toHaveValue(String(value));
  await expect(page.locator('#line-height-level')).toContainText(value.toFixed(1));
}

async function typography(selector) {
  return page.locator(selector).evaluate(element => {
    const style = getComputedStyle(element);
    return { font: style.fontFamily, weight: style.fontWeight, lineHeight: style.lineHeight };
  });
}

async function expectChosenTypography() {
  await expect(page.locator('#reading-font')).toHaveValue('georgia');
  await expect(page.locator('#reading-weight')).toHaveValue('600');
  await expect(page.locator('#reading-line-height')).toHaveValue('2.2');
  await expect(page.locator('#markdown')).toHaveCSS('font-family', /Georgia/i);
  await expect(page.locator('#markdown')).toHaveCSS('font-weight', '600');
  await expect.poll(() => page.locator('#markdown').evaluate(element => {
    const style = getComputedStyle(element);
    return parseFloat(style.lineHeight) / parseFloat(style.fontSize);
  })).toBeCloseTo(2.2, 3);
}

async function visiblePassage() {
  return page.locator('#markdown').evaluate(article => {
    const top = document.querySelector('#reader').getBoundingClientRect().top;
    const first = [...article.children].find(element => element.getBoundingClientRect().bottom > top + 1);
    return { text: first.textContent, offset: first.getBoundingClientRect().top - top };
  });
}

async function highlightedText() {
  return page.evaluate(() => [...(CSS.highlights.get('reading-focus') || [])]
    .map(range => range.toString()).join(' ').replace(/\s+/g, ' ').trim());
}

async function highlightedRows() {
  return page.evaluate(() => {
    const tops = [...(CSS.highlights.get('reading-focus') || [])]
      .flatMap(range => [...range.getClientRects()])
      .filter(rect => rect.width > 0 && rect.height > 0)
      .map(rect => rect.top).sort((a, b) => a - b);
    return tops.filter((top, index) => index === 0 || top - tops[index - 1] > 2).length;
  });
}

test.beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'mdview-typography-ui-'));
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

test('view typography changes leave editor styling, toolbar styling and Markdown bytes intact', async () => {
  await launch(undefined, null);
  await expect(page.locator('#reading-font')).toHaveValue('system');
  await expect(page.locator('#reading-weight')).toHaveValue('400');
  await expect(page.locator('#reading-line-height')).toHaveValue('1.7');
  await expect(page.locator('#reading-line-height')).toHaveAttribute('min', '1');
  await expect(page.locator('#reading-line-height')).toHaveAttribute('max', '2.5');
  await expect(page.locator('#reading-line-height')).toHaveAttribute('step', '0.1');
  const source = '\ufeff# Original\r\n\r\nPlain **bold** and *italic* words.  \r\nSecond line.\r\n';
  await writeFile(file, source);
  const originalBytes = await readFile(file);
  await application.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
  }, file);
  await page.getByRole('button', { name: 'Open file' }).click();
  await expect(page.locator('#markdown h1')).toHaveText('Original');
  const toolbarBefore = await typography('.toolbar');
  const openButtonBefore = await typography('#open-file');
  await page.locator('#edit-file').click();
  await expect(page.locator('#typography-toolbar')).toBeHidden();
  const editorBefore = await typography('#editor .ProseMirror p');
  await page.locator('#cancel-edit').click();

  await page.locator('#reading-font').selectOption('georgia');
  await page.locator('#reading-weight').selectOption('600');
  await setLineHeight(2.2);
  await expectChosenTypography();
  expect(await typography('.toolbar')).toEqual(toolbarBefore);
  expect(await typography('#open-file')).toEqual(openButtonBefore);
  await expect(page.locator('#markdown strong')).toHaveText('bold');
  await expect(page.locator('#markdown em')).toHaveText('italic');

  await page.locator('#edit-file').click();
  await expect(page.locator('#typography-toolbar')).toBeHidden();
  expect(await typography('#editor .ProseMirror p')).toEqual(editorBefore);
  await page.locator('#save-file').click();
  await expect(page.locator('#edit-status')).toHaveText('Saved');
  await expect(page.locator('#editor')).toBeVisible();
  expect(await readFile(file)).toEqual(originalBytes);
  await page.locator('#cancel-edit').click();
  await expect(page.locator('#typography-toolbar')).toBeVisible();
  await expectChosenTypography();
});

test('typography survives live refresh, opening another document and an application restart', async () => {
  await launch('# Remember these settings\n\nOriginal paragraph.');
  await page.locator('#reading-font').selectOption('georgia');
  await page.locator('#reading-weight').selectOption('600');
  await setLineHeight(2.2);
  await writeFile(file, '# Refreshed document\n\nSaved by another editor.');
  await expect(page.locator('#markdown h1')).toHaveText('Refreshed document');
  await expectChosenTypography();
  const other = path.join(directory, 'another document.md');
  await writeFile(other, '# Another document\n\nThe same reading settings apply.');
  await application.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
  }, other);
  await page.getByRole('button', { name: 'Open file' }).click();
  await expect(page.locator('#markdown h1')).toHaveText('Another document');
  await expectChosenTypography();
  expect(await page.evaluate(() => Object.fromEntries(['font', 'fontWeight', 'lineHeight']
    .map(key => [key, localStorage.getItem(`mdview.${key}`)]))))
    .toEqual({ font: 'georgia', fontWeight: '600', lineHeight: '2.2' });
  await application.close();
  application = null;
  await launch(undefined, other);
  await expect(page.locator('#markdown h1')).toHaveText('Another document');
  await expectChosenTypography();
});

test('typography reflow preserves the visible passage and a row highlight anchored in its text', async () => {
  const original = '# Keep reading\n\n' + Array.from({ length: 70 }, (_, index) =>
    `Paragraph ${index + 1}. Alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima target november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu.\n\n`).join('');
  await launch(original);
  await page.locator('#highlight-mode').selectOption('click');
  await page.locator('#highlight-amount').selectOption('row');
  await page.locator('#highlight-toggle').click();
  const paragraph = page.locator('#markdown > p').nth(24);
  await paragraph.scrollIntoViewIfNeeded();
  const point = await paragraph.evaluate(element => {
    const node = element.firstChild;
    const offset = node.textContent.indexOf('target');
    const range = document.createRange();
    range.setStart(node, offset + 2);
    range.setEnd(node, offset + 3);
    const rect = range.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await page.mouse.click(point.x, point.y);
  await expect.poll(highlightedText).toContain('target');
  await paragraph.evaluate(element => {
    const reader = document.querySelector('#reader');
    reader.scrollTop += element.getBoundingClientRect().top - reader.getBoundingClientRect().top - 12;
  });
  const before = await visiblePassage();
  const positionChanges = [];
  for (const update of [
    () => page.locator('#reading-font').selectOption('georgia'),
    () => page.locator('#reading-weight').selectOption('600'),
    () => setLineHeight(2.2, positionChanges),
  ]) {
    await update();
    await expect.poll(highlightedText).toContain('target');
    await expect.poll(highlightedRows).toBe(1);
    const after = await visiblePassage();
    expect(after.text).toBe(before.text);
    expect(Math.abs(after.offset - before.offset)).toBeLessThan(3);
  }
  await test.info().attach('line-height-scroll-rounding', {
    body: JSON.stringify(positionChanges),
    contentType: 'application/json',
  });
  await writeFile(file, `${original}\nSaved while reading.`);
  await expect(page.locator('#markdown')).toContainText('Saved while reading.');
  await expectChosenTypography();
  const afterRefresh = await visiblePassage();
  expect(afterRefresh.text).toBe(before.text);
  expect(Math.abs(afterRefresh.offset - before.offset)).toBeLessThan(3);
});

test('font choices, weight limits and line height remain usable in a 440 pixel window', async () => {
  await launch('Plain reading text with **emphasis** and `code`.');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(440, 600));
  await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([440, 600]);
  await page.locator('#highlight-amount').selectOption('chunk');
  await page.locator('#highlight-toggle').click();
  for (const id of ['reading-font', 'reading-weight', 'reading-line-height', 'highlight-before', 'highlight-after']) {
    const control = page.locator(`#${id}`);
    await expect(control).toBeVisible();
    const bounds = await control.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(440);
  }
  for (const [value, expected] of [
    ['arial', /Arial/i], ['calibri', /Calibri/i], ['verdana', /Verdana/i],
    ['georgia', /Georgia/i], ['times', /Times/i], ['monospace', /monospace/i],
  ]) {
    await page.locator('#reading-font').selectOption(value);
    await expect(page.locator('#markdown')).toHaveCSS('font-family', expected);
  }
  await page.locator('#reading-font').selectOption('system');
  for (const value of ['300', '400', '500', '600', '700']) {
    await page.locator('#reading-weight').selectOption(value);
    await expect(page.locator('#markdown')).toHaveCSS('font-weight', value);
  }
  const slider = page.locator('#reading-line-height');
  await slider.focus();
  await slider.press('Home');
  await slider.press('ArrowLeft');
  await expect(slider).toHaveValue('1');
  await slider.press('End');
  await slider.press('ArrowRight');
  await expect(slider).toHaveValue('2.5');
  await expect(page.locator('#line-height-level')).toContainText('2.5');
  expect(await page.locator('#typography-toolbar').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/typography-narrow.png' });

  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(440, 320));
  await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([440, 320]);
  expect((await page.locator('#reader').boundingBox()).height).toBeGreaterThanOrEqual(60);
  for (const id of ['reading-font', 'reading-weight', 'reading-line-height', 'highlight-toggle', 'highlight-mode', 'highlight-amount', 'highlight-before', 'highlight-after']) {
    const control = page.locator(`#${id}`);
    await control.scrollIntoViewIfNeeded();
    await control.hover();
    const bounds = await control.boundingBox();
    const visibleArea = await page.locator('.reading-controls').boundingBox();
    expect(bounds.y).toBeGreaterThanOrEqual(visibleArea.y);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(visibleArea.y + visibleArea.height + 1);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(440);
  }
  await page.locator('#highlight-before').fill('1');
  await expect(page.locator('#highlight-before')).toHaveValue('1');
  await slider.scrollIntoViewIfNeeded();
  await slider.focus();
  await slider.press('ArrowLeft');
  await expect(slider).toHaveValue('2.4');
  await page.locator('#reading-font').scrollIntoViewIfNeeded();
  await page.locator('#reading-font').selectOption('georgia');
  await expect(page.locator('#markdown')).toHaveCSS('font-family', /Georgia/i);
  expect((await page.locator('#reader').boundingBox()).height).toBeGreaterThanOrEqual(60);
  await page.screenshot({ path: 'test-results/typography-minimum.png' });
});
