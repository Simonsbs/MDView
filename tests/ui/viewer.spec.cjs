const { test, expect, _electron: electron } = require('@playwright/test');
const { mkdtemp, writeFile, rename, rm, mkdir } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

let application;
let page;
let directory;
let file;

async function launch(filePath) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const args = process.env.MDVIEW_EXECUTABLE ? [] : [path.resolve(__dirname, '../..')];
  if (filePath) args.push(filePath);
  args.push('--no-default-registration');
  args.push(`--user-data-dir=${path.join(directory, 'profile')}`);
  application = await electron.launch({
    executablePath: process.env.MDVIEW_EXECUTABLE || undefined,
    args,
    env,
    timeout: 30000,
  });
  page = await application.firstWindow();
  await page.waitForLoadState('domcontentloaded');
}

test.beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'mdview-ui-'));
  file = path.join(directory, 'notes with spaces.md');
});

test.afterEach(async () => {
  await application?.close();
  application = null;
  await rm(directory, { recursive: true, force: true });
});

test('opens with the native picker and renders Markdown, local images and safe text', async () => {
  await writeFile(file, '# A quiet place to read\n\n**Markdown**, with live updates.\n\n## The essentials\n\n- Open a file\n- Save in your editor\n- Keep reading\n\n| Input | Result |\n| --- | --- |\n| Ctrl + scroll | Resize text |\n\n- [x] Updates automatically\n- [ ] Another task\n\n```js\nconst message = "Hello, Markdown";\n```\n\n![Local diagram](assets/pixel%20%23%20one.svg)\n\n<script>window.compromised = true</script>\n\n[Unsafe](javascript:alert(1))');
  await mkdir(path.join(directory, 'assets'));
  await writeFile(path.join(directory, 'assets', 'pixel # one.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="24"><rect width="100" height="24" rx="4" fill="#35675b"/></svg>');
  await launch();
  await expect(page.getByRole('heading', { name: 'Open a Markdown file' })).toBeVisible();
  await application.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
  }, file);
  await page.getByRole('button', { name: 'Open file' }).click();
  await expect(page.locator('#markdown h1')).toHaveText('A quiet place to read');
  await expect(page.locator('#markdown table')).toBeVisible();
  await expect(page.locator('#markdown pre code')).toContainText('Hello, Markdown');
  await expect(page.locator('#markdown input[type=checkbox]').first()).toBeChecked();
  expect(await page.locator('#markdown input[type=checkbox]').first().isDisabled()).toBe(true);
  await expect.poll(() => page.locator('#markdown img').evaluate(image => image.naturalWidth)).toBe(100);
  expect(await page.evaluate(() => window.compromised)).toBeUndefined();
  expect(await page.locator('#markdown script').count()).toBe(0);
  expect(await page.locator('#markdown a[href^="javascript:"]').count()).toBe(0);
  await expect(page.locator('#watch-label')).toHaveText('Live');
  await page.screenshot({ path: 'test-results/viewer.png' });
});

test('refreshes ordinary and atomic saves without losing scroll or text size', async () => {
  const original = '# Live document\n\n' + Array.from({ length: 70 }, (_, i) => `## Section ${i}\n\nParagraph ${i}. This is a document that stays in place as it changes.\n\n`).join('');
  await writeFile(file, original);
  await launch(file);
  await expect(page.locator('#markdown h1')).toHaveText('Live document');
  await page.locator('#reader').evaluate(element => { element.scrollTop = 1700; });
  await page.mouse.move(500, 350);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  await expect(page.locator('#zoom-level')).toHaveText('110%');
  const before = await page.locator('#reader').evaluate(element => element.scrollTop);
  await writeFile(file, `${original}\nSaved change.`);
  await expect(page.locator('#markdown')).toContainText('Saved change.');
  expect(Math.abs(await page.locator('#reader').evaluate(element => element.scrollTop) - before)).toBeLessThan(3);
  const temporary = path.join(directory, 'editor.tmp');
  await writeFile(temporary, `${original}\nAtomic save.`);
  await rename(temporary, file);
  await expect(page.locator('#markdown')).toContainText('Atomic save.');
  await expect(page.locator('#zoom-level')).toHaveText('110%');
  expect(Math.abs(await page.locator('#reader').evaluate(element => element.scrollTop) - before)).toBeLessThan(3);
  // Adding content above the viewport preserves the visible paragraph as well.
  const visibleBefore = await page.locator('#markdown').evaluate(article => {
    const top = document.querySelector('#reader').getBoundingClientRect().top;
    const first = [...article.children].find(element => element.getBoundingClientRect().bottom > top + 1);
    return { text: first.textContent, offset: first.getBoundingClientRect().top - top };
  });
  await writeFile(file, `# New introduction\n\nInserted above your reading position.\n\n${original}`);
  await expect(page.locator('#markdown h1').first()).toHaveText('New introduction');
  const visibleAfter = await page.locator('#markdown').evaluate(article => {
    const top = document.querySelector('#reader').getBoundingClientRect().top;
    const first = [...article.children].find(element => element.getBoundingClientRect().bottom > top + 1);
    return { text: first.textContent, offset: first.getBoundingClientRect().top - top };
  });
  expect(visibleAfter.text).toBe(visibleBefore.text);
  expect(Math.abs(visibleAfter.offset - visibleBefore.offset)).toBeLessThan(3);
});

test('Ctrl+scroll resizes only document text and ordinary scroll stays ordinary', async () => {
  await writeFile(file, '# Zoom\n\n' + 'A paragraph with enough text to scroll.\n\n'.repeat(100));
  await launch(file);
  await expect(page.locator('#markdown h1')).toHaveText('Zoom');
  const toolbarHeight = await page.locator('.toolbar').evaluate(element => element.getBoundingClientRect().height);
  await page.mouse.move(500, 350);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => page.locator('#reader').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(page.locator('#zoom-level')).toHaveText('100%');
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120);
  await expect(page.locator('#zoom-level')).toHaveText('110%');
  await expect(page.locator('#markdown')).toHaveCSS('font-size', '19.8px');
  await page.mouse.wheel(0, 120);
  await expect(page.locator('#zoom-level')).toHaveText('100%');
  await page.keyboard.up('Control');
  expect(await page.locator('.toolbar').evaluate(element => element.getBoundingClientRect().height)).toBe(toolbarHeight);
  expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())).toBe(1);
  await page.evaluate(() => {
    for (let i = 0; i < 40; i++) window.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -120, cancelable: true }));
  });
  await expect(page.locator('#zoom-level')).toHaveText('300%');
  await page.evaluate(() => {
    for (let i = 0; i < 50; i++) window.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: 120, cancelable: true }));
  });
  await expect(page.locator('#zoom-level')).toHaveText('50%');
});

test('shows a useful missing-file state and recovers with the last preview intact', async () => {
  await writeFile(file, '# Still here');
  await launch(file);
  await expect(page.locator('#markdown h1')).toHaveText('Still here');
  await rm(file);
  await expect(page.locator('#notice')).toContainText('File not found.');
  await expect(page.locator('#markdown h1')).toHaveText('Still here');
  await expect(page.locator('#watch-label')).toHaveText('Waiting');
  await writeFile(file, '# Back again');
  await expect(page.locator('#markdown h1')).toHaveText('Back again');
  await expect(page.locator('#notice')).toBeHidden();
  await expect(page.locator('#watch-label')).toHaveText('Live');
});

test('empty files stay open and Ctrl+O can switch to another file', async () => {
  await writeFile(file, '');
  await launch(file);
  await expect(page.locator('#empty-file')).toHaveText('This file is empty.');
  await expect(page.locator('#empty-state')).toBeHidden();
  const other = path.join(directory, 'other.markdown');
  await writeFile(other, '# Other document');
  await application.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
  }, other);
  await page.keyboard.press('Control+o');
  await expect(page.locator('#markdown h1')).toHaveText('Other document');
  await writeFile(file, '# Ignore this old file');
  await page.waitForTimeout(900);
  await expect(page.locator('#markdown h1')).toHaveText('Other document');
});

test('external links use the browser and Markdown links open in the viewer', async () => {
  await writeFile(file, '# Links\n\n[Website](https://example.com/)\n\n[Next document](next.md)');
  await writeFile(path.join(directory, 'next.md'), '# Next document');
  await launch(file);
  await expect(page.locator('#markdown h1')).toHaveText('Links');
  await application.evaluate(({ shell }) => {
    global.openedLink = null;
    shell.openExternal = async href => { global.openedLink = href; };
  });
  await page.getByRole('link', { name: 'Website' }).click();
  await expect.poll(() => application.evaluate(() => global.openedLink)).toBe('https://example.com/');
  expect(page.url()).toBe('mdview://app/index.html');
  await page.getByRole('link', { name: 'Next document' }).click();
  await expect(page.locator('#markdown h1')).toHaveText('Next document');
});

test('an unreadable startup path shows an error and the Open file button', async () => {
  await launch(file);
  await expect(page.locator('#notice')).toContainText('File not found.');
  await expect(page.getByRole('button', { name: 'Open file' })).toBeVisible();
  await expect(page.locator('#empty-state')).toBeVisible();
});

test('dropping a real file opens it and watches subsequent changes', async () => {
  await writeFile(file, '# Dropped document');
  await launch();
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.id = 'test-file';
    document.body.append(input);
  });
  await page.locator('#test-file').setInputFiles(file);
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(document.querySelector('#test-file').files[0]);
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, cancelable: true }));
    document.querySelector('#test-file').remove();
  });
  await expect(page.locator('#markdown h1')).toHaveText('Dropped document');
  await writeFile(file, '# Changed after drop');
  await expect(page.locator('#markdown h1')).toHaveText('Changed after drop');
});

test('cancelling the picker and choosing an invalid file preserve the current document', async () => {
  await writeFile(file, '# Keep reading');
  await launch(file);
  await expect(page.locator('#markdown h1')).toHaveText('Keep reading');
  await application.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });
  await page.getByRole('button', { name: 'Open file' }).click();
  await expect(page.locator('#markdown h1')).toHaveText('Keep reading');
  await expect(page.locator('#notice')).toBeHidden();
  await application.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
  }, path.join(directory, 'missing.md'));
  await page.getByRole('button', { name: 'Open file' }).click();
  await expect(page.locator('#notice')).toContainText('File not found.');
  await expect(page.locator('#markdown h1')).toHaveText('Keep reading');
  await writeFile(file, '# Still watching');
  await expect(page.locator('#markdown h1')).toHaveText('Still watching');
});

test('follows the system theme until the light/dark switch is used', async () => {
  await writeFile(file, '# Choose your appearance\n\nReadable in light or dark mode.\n\n> A quieter background for evening reading.\n\n```js\nconst theme = "dark";\n```');
  await launch(file);
  const toggle = page.getByRole('switch', { name: 'Dark mode' });
  await application.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light'; });
  await expect(toggle).not.toBeChecked();
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(250, 250, 248)');
  await application.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
  await expect(toggle).toBeChecked();
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(32, 35, 38)');
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  await application.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light'; });
  await application.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
  await expect(toggle).not.toBeChecked();
  await page.reload();
  await expect(toggle).not.toBeChecked();
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(250, 250, 248)');
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toBeChecked();
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await expect(page.locator('#markdown')).toHaveCSS('color', 'rgb(221, 225, 228)');
  await page.screenshot({ path: 'test-results/viewer-dark.png' });
});

test('width ranges from 20% to the full window and responds to resizing and dragging', async () => {
  await writeFile(file, '# A wider view\n\n' + 'This paragraph fills the chosen reading width. '.repeat(30));
  await launch(file);
  await expect(page.locator('#markdown h1')).toHaveText('A wider view');
  const slider = page.getByRole('slider', { name: 'Reading width' });
  const widthRatio = () => page.locator('#markdown').evaluate(article => {
    const reader = document.querySelector('#reader');
    const style = getComputedStyle(reader);
    return article.getBoundingClientRect().width / (reader.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
  });
  await expect(slider).toHaveValue('80');
  expect(await widthRatio()).toBeCloseTo(0.8, 2);
  await slider.focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowLeft');
  await expect(slider).toHaveValue('20');
  await expect(page.locator('#width-level')).toHaveText('20%');
  expect(await widthRatio()).toBeCloseTo(0.2, 2);
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveValue('21');
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveValue('100');
  expect(await widthRatio()).toBeCloseTo(1, 2);
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1400, 760));
  await expect.poll(widthRatio).toBeCloseTo(1, 2);
  expect((await page.locator('#markdown').boundingBox()).width).toBeGreaterThan(1200);
  await expect(page.locator('#markdown')).toHaveCSS('font-size', '18px');
  await expect(page.locator('#zoom-level')).toHaveText('100%');
  const bounds = await slider.boundingBox();
  await page.mouse.move(bounds.x + bounds.width - 7, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { steps: 8 });
  await page.mouse.up();
  const chosenWidth = Number(await slider.inputValue());
  expect(chosenWidth).toBeGreaterThan(50);
  expect(chosenWidth).toBeLessThan(70);
  expect(await widthRatio()).toBeCloseTo(chosenWidth / 100, 2);
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(440, 600));
  await expect.poll(widthRatio).toBeCloseTo(chosenWidth / 100, 2);
  for (const control of [page.getByRole('button', { name: 'Open file' }), slider, page.getByRole('switch', { name: 'Dark mode' }), page.locator('#zoom-level')]) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  }
  expect(await page.locator('.toolbar').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.getByRole('switch', { name: 'Dark mode' }).click();
  await slider.focus();
  await page.keyboard.press('End');
  expect(await widthRatio()).toBeCloseTo(1, 2);
  await page.screenshot({ path: 'test-results/viewer-narrow.png' });
});

test('theme and width survive live updates, file changes and restarting the app', async () => {
  await writeFile(file, '# Remember my view');
  await launch(file);
  await application.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light'; });
  const toggle = page.getByRole('switch', { name: 'Dark mode' });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  const slider = page.getByRole('slider', { name: 'Reading width' });
  await slider.focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await writeFile(file, '# Updated with my view');
  await expect(page.locator('#markdown h1')).toHaveText('Updated with my view');
  await expect(toggle).toBeChecked();
  await expect(slider).toHaveValue('21');
  const other = path.join(directory, 'next.md');
  await writeFile(other, '# Another document');
  await application.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
  }, other);
  await page.getByRole('button', { name: 'Open file' }).click();
  await expect(page.locator('#markdown h1')).toHaveText('Another document');
  await expect(toggle).toBeChecked();
  await expect(slider).toHaveValue('21');
  await application.close();
  application = null;
  await launch(other);
  await application.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light'; });
  await expect(page.locator('#markdown h1')).toHaveText('Another document');
  await expect(page.getByRole('switch', { name: 'Dark mode' })).toBeChecked();
  await expect(page.getByRole('slider', { name: 'Reading width' })).toHaveValue('21');
  await expect(page.locator('#width-level')).toHaveText('21%');
});

test('changing width preserves the visible passage and works with zoom and live refresh', async () => {
  const original = '# Keep your place\n\n' + Array.from({ length: 70 }, (_, i) => `## Section ${i}\n\nParagraph ${i}. ${'Keep reading while the layout changes. '.repeat(8)}\n\n`).join('');
  await writeFile(file, original);
  await launch(file);
  await expect(page.locator('#markdown h1')).toHaveText('Keep your place');
  await page.locator('#reader').evaluate(element => { element.scrollTop = 1700; });
  const passage = () => page.locator('#markdown').evaluate(article => {
    const top = document.querySelector('#reader').getBoundingClientRect().top;
    const first = [...article.children].find(element => element.getBoundingClientRect().bottom > top + 1);
    return { text: first.textContent, offset: first.getBoundingClientRect().top - top };
  });
  const before = await passage();
  await page.getByRole('slider', { name: 'Reading width' }).focus();
  await page.keyboard.press('Home');
  const narrow = await passage();
  expect(narrow.text).toBe(before.text);
  expect(Math.abs(narrow.offset - before.offset)).toBeLessThan(3);
  await page.mouse.move(500, 350);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  await expect(page.locator('#zoom-level')).toHaveText('110%');
  await writeFile(file, `${original}\nSaved while reading at 20%.`);
  await expect(page.locator('#markdown')).toContainText('Saved while reading at 20%.');
  const after = await passage();
  expect(after.text).toBe(before.text);
  expect(Math.abs(after.offset - before.offset)).toBeLessThan(3);
  await expect(page.locator('#width-level')).toHaveText('20%');
  await expect(page.locator('#zoom-level')).toHaveText('110%');
});
