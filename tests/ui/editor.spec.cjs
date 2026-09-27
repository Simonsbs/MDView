const { test, expect, _electron: electron } = require('@playwright/test');
const { mkdtemp, writeFile, readFile, rm, mkdir } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

let application;
let page;
let directory;
let file;

async function launch(markdown = '') {
  await writeFile(file, markdown);
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
  // Electron owns the native beforeunload confirmation. Avoid Playwright's automatic dismissal.
  page.on('dialog', () => {});
  await page.waitForLoadState('domcontentloaded');
  await page.emulateMedia({ colorScheme: null });
  await expect(page.locator('#edit-file')).toBeVisible();
}

function editor() {
  return page.getByRole('textbox', { name: 'Edit Markdown document' });
}

async function enterEditor() {
  await page.locator('#edit-file').click();
  await expect(editor()).toBeVisible();
  await expect(editor()).toHaveAttribute('contenteditable', 'true');
}

async function appendText(text) {
  await editor().focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(text);
  await expect(editor()).toContainText(text);
}

async function expectSaved() {
  await expect(page.locator('#edit-status')).toHaveText('Saved');
  await expect(editor()).toBeVisible();
  await expect(editor()).toHaveAttribute('contenteditable', 'true');
  await expect(page.locator('#markdown')).toBeHidden();
}

async function returnToPreview() {
  await page.locator('#cancel-edit').click();
  await expect(page.locator('#editor')).toBeHidden();
  await expect(page.locator('#discard-dialog')).toBeHidden();
}

test.beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'mdview-editor-ui-'));
  file = path.join(directory, 'notes with spaces.md');
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

test('Ctrl+S saves Markdown while editing and Cancel resumes live refresh', async () => {
  await launch('# Editable document\n\nOriginal paragraph.\n');
  await page.keyboard.press('Control+e');
  await expect(editor()).toBeVisible();
  await expect(page.locator('#markdown')).toBeHidden();
  await appendText(' Added in MDView.');
  expect(await readFile(file, 'utf8')).not.toContain('Added in MDView.');
  await page.keyboard.press('Control+s');
  await expectSaved();
  await expect(editor()).toContainText('Original paragraph. Added in MDView.');
  expect(await readFile(file, 'utf8')).toContain('Original paragraph. Added in MDView.');
  await expect(page.locator('#notice')).toBeHidden();
  await returnToPreview();
  await expect(page.locator('#markdown')).toContainText('Original paragraph. Added in MDView.');
  await writeFile(file, '# Saved elsewhere\n\nLive refresh still works.\n');
  await expect(page.locator('#markdown h1')).toHaveText('Saved elsewhere');
});

test('formatting preserves the selection and supports undo and redo', async () => {
  await launch('Editable words\n');
  await enterEditor();
  await editor().focus();
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await expect(editor().locator('strong')).toHaveText('Editable words');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(editor().locator('strong')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(editor().locator('strong')).toHaveText('Editable words');
  await page.locator('#save-file').click();
  await expectSaved();
  await returnToPreview();
  await expect(page.locator('#markdown strong')).toHaveText('Editable words');
  expect(await readFile(file, 'utf8')).toMatch(/\*\*Editable words\*\*/);
});

test('text style changes create Markdown headings', async () => {
  await launch('A section title\n');
  await enterEditor();
  await editor().focus();
  await page.keyboard.press('Control+Home');
  await page.getByRole('combobox', { name: 'Text style' }).selectOption('heading-2');
  await expect(editor().locator('h2')).toHaveText('A section title');
  await page.locator('#save-file').click();
  await expectSaved();
  await returnToPreview();
  await expect(page.locator('#markdown h2')).toHaveText('A section title');
  expect(await readFile(file, 'utf8')).toMatch(/^## A section title/m);
});

test('saving an unchanged document stays in the same editor and preserves the original bytes', async () => {
  await launch('\ufeff# Original\r\n\r\n*One*  \r\nsecond line\r\n');
  const before = await readFile(file);
  await enterEditor();
  const originalEditor = await editor().elementHandle();
  await page.locator('#save-file').click();
  await expectSaved();
  expect(await originalEditor.evaluate(node => node === document.querySelector('#editor .ProseMirror'))).toBe(true);
  expect(await readFile(file)).toEqual(before);
  await editor().focus();
  await page.keyboard.press('Control+s');
  await expectSaved();
  expect(await readFile(file)).toEqual(before);
  await returnToPreview();
  await expect(page.locator('#markdown h1')).toHaveText('Original');
});

for (const saveWith of ['Ctrl+S', 'Save button']) {
  test(`${saveWith} preserves the editor, caret, scroll position and undo history`, async () => {
    await launch(Array.from({ length: 50 }, (_, index) => `Paragraph ${index + 1} has editable text.`).join('\n\n'));
    await enterEditor();
    const paragraph = editor().locator('p').nth(24);
    await paragraph.click();
    await page.keyboard.press('Home');
    await page.keyboard.insertText('Saved text. ');
    await expect(paragraph).toHaveText('Saved text. Paragraph 25 has editable text.');
    const originalEditor = await editor().elementHandle();
    const selectionBefore = await page.evaluate(() => ({
      text: getSelection().anchorNode.textContent,
      anchor: getSelection().anchorOffset,
      focus: getSelection().focusOffset,
      scroll: document.querySelector('#reader').scrollTop,
    }));
    expect(selectionBefore.scroll).toBeGreaterThan(0);
    if (saveWith === 'Ctrl+S') await page.keyboard.press('Control+s');
    else await page.locator('#save-file').click();
    await expectSaved();
    expect(await originalEditor.evaluate(node => node === document.querySelector('#editor .ProseMirror'))).toBe(true);
    expect(await page.evaluate(() => ({
      text: getSelection().anchorNode.textContent,
      anchor: getSelection().anchorOffset,
      focus: getSelection().focusOffset,
      scroll: document.querySelector('#reader').scrollTop,
    }))).toEqual(selectionBefore);
    await page.keyboard.press('Control+z');
    await expect(paragraph).toHaveText('Paragraph 25 has editable text.');
    await expect(page.locator('#edit-status')).toHaveText('Unsaved changes');
    await page.keyboard.press('Control+y');
    await expect(paragraph).toHaveText('Saved text. Paragraph 25 has editable text.');
    await expectSaved();
    await page.keyboard.insertText('Continued here. ');
    await expect(paragraph).toHaveText('Saved text. Continued here. Paragraph 25 has editable text.');
    await expect(page.locator('#edit-status')).toHaveText('Unsaved changes');
    expect(await readFile(file, 'utf8')).not.toContain('Continued here.');
  });
}

test('repeated saves refresh the baseline and Cancel discards only changes since the last save', async () => {
  await launch('# Original\n\nSaved paragraph.\n');
  await enterEditor();
  await appendText(' First saved change.');
  await page.locator('#save-file').click();
  await expectSaved();
  await appendText(' Second saved change.');
  await expect(page.locator('#edit-status')).toHaveText('Unsaved changes');
  await page.keyboard.press('Control+s');
  await expectSaved();
  const saved = await readFile(file, 'utf8');
  expect(saved).toContain('Saved paragraph. First saved change. Second saved change.');
  await expect(page.locator('#notice')).toBeHidden();
  await appendText(' Discard this draft.');
  await page.locator('#cancel-edit').click();
  await expect(page.locator('#discard-dialog')).toBeVisible();
  await page.locator('#discard-dialog').getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.locator('#editor')).toBeHidden();
  await expect(page.locator('#markdown')).toContainText('Saved paragraph. First saved change. Second saved change.');
  await expect(page.locator('#markdown')).not.toContainText('Discard this draft.');
  expect(await readFile(file, 'utf8')).toBe(saved);
});

test('cancel without changes leaves the original bytes untouched', async () => {
  const original = '\ufeff# Original\r\n\r\n*One*  \r\nsecond line\r\n';
  await launch(original);
  const before = await readFile(file);
  await enterEditor();
  await page.locator('#cancel-edit').click();
  await expect(page.locator('#editor')).toBeHidden();
  await expect(page.locator('#discard-dialog')).toBeHidden();
  expect(await readFile(file)).toEqual(before);
  await expect(page.locator('#markdown h1')).toHaveText('Original');
});

test('cancel offers to keep or discard a draft without writing the file', async () => {
  const original = '# Original\n\nLeave this file alone.\n';
  await launch(original);
  await enterEditor();
  await appendText(' Unsaved draft.');
  await page.locator('#cancel-edit').click();
  const dialog = page.locator('#discard-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(editor()).toContainText('Unsaved draft.');
  await page.locator('#cancel-edit').click();
  await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.locator('#editor')).toBeHidden();
  await expect(page.locator('#markdown')).not.toContainText('Unsaved draft.');
  expect(await readFile(file, 'utf8')).toBe(original);
});

test('Escape keeps a second draft after an earlier discard', async () => {
  const original = '# Original\n\nThe saved paragraph.\n';
  await launch(original);
  await enterEditor();
  await appendText(' First draft.');
  await page.locator('#cancel-edit').click();
  await page.locator('#discard-dialog').getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.locator('#editor')).toBeHidden();
  await enterEditor();
  await appendText(' Second draft.');
  await page.locator('#cancel-edit').click();
  await expect(page.locator('#discard-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#discard-dialog')).toBeHidden();
  await expect(editor()).toContainText('Second draft.');
  await expect(editor()).not.toContainText('First draft.');
  expect(await readFile(file, 'utf8')).toBe(original);
});

test('an external change preserves the draft and prevents an overwrite', async () => {
  await launch('# Original\n\nStarting paragraph.\n');
  await enterEditor();
  await appendText(' My unsaved draft.');
  const external = '# Changed on disk\n\nAnother editor saved this.\n';
  await writeFile(file, external);
  await expect(page.locator('#notice')).toContainText(/changed/i);
  await expect(editor()).toContainText('My unsaved draft.');
  await expect(editor()).not.toContainText('Another editor saved this.');
  await page.locator('#save-file').click();
  await expect(page.locator('#notice')).toContainText(/changed/i);
  await expect(editor()).toBeVisible();
  await expect(editor()).toContainText('My unsaved draft.');
  expect(await readFile(file, 'utf8')).toBe(external);
  await page.locator('#cancel-edit').click();
  await page.locator('#discard-dialog').getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.locator('#markdown h1')).toHaveText('Changed on disk');
});

test('opening another file asks before discarding unsaved changes', async () => {
  const original = '# Original\n\nKeep my work.\n';
  await launch(original);
  const other = path.join(directory, 'another document.md');
  await writeFile(other, '# Another document\n');
  await application.evaluate(({ dialog }, selected) => {
    global.discardPrompts = [];
    global.discardResponse = 1;
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
    dialog.showMessageBoxSync = (_window, options) => {
      global.discardPrompts.push(options);
      return global.discardResponse;
    };
  }, other);
  await enterEditor();
  await appendText(' Unsaved change.');
  await page.keyboard.press('Control+o');
  await expect.poll(() => application.evaluate(() => global.discardPrompts.length)).toBe(1);
  expect(await application.evaluate(() => global.discardPrompts[0].buttons)).toEqual(['Discard changes', 'Cancel']);
  await expect(editor()).toContainText('Unsaved change.');
  expect(await readFile(file, 'utf8')).toBe(original);
  await application.evaluate(() => { global.discardResponse = 0; });
  await page.keyboard.press('Control+o');
  await expect(page.locator('#markdown h1')).toHaveText('Another document');
  await expect(page.locator('#editor')).toBeHidden();
  expect(await readFile(file, 'utf8')).toBe(original);
});

test('an empty file can be edited and saved', async () => {
  await launch('');
  await expect(page.locator('#empty-file')).toBeVisible();
  await enterEditor();
  await expect(page.locator('#empty-file')).toBeHidden();
  await editor().focus();
  await page.keyboard.insertText('The first paragraph.');
  await page.locator('#save-file').click();
  await expectSaved();
  await returnToPreview();
  await expect(page.locator('#markdown p')).toHaveText('The first paragraph.');
  expect(await readFile(file, 'utf8')).toContain('The first paragraph.');
});

test('closing the window gives an unsaved draft a chance to stay open', async () => {
  await launch('# Original\n\nKeep the window open.\n');
  await application.evaluate(({ dialog }) => {
    global.closePrompt = null;
    global.closePrompts = 0;
    dialog.showMessageBoxSync = (_window, options) => {
      global.closePrompt = options;
      global.closePrompts++;
      return 1;
    };
  });
  await enterEditor();
  await appendText(' Unsaved draft.');
  await page.evaluate(() => window.mdview.getState());
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect.poll(() => application.evaluate(() => global.closePrompt?.message)).toMatch(/unsaved/i);
  await expect(editor()).toContainText('Unsaved draft.');
  // A renderer draft must also survive a close before main has learned it is dirty.
  await page.evaluate(() => window.mdview.setDirty(false));
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect.poll(() => application.evaluate(() => global.closePrompts)).toBe(2);
  await expect(editor()).toContainText('Unsaved draft.');
  expect(await readFile(file, 'utf8')).not.toContain('Unsaved draft.');
});

test('tables, tasks and relative images survive an edit and save', async () => {
  await mkdir(path.join(directory, 'assets'));
  await writeFile(path.join(directory, 'assets', 'pixel # one.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="24"><rect width="100" height="24" fill="#35675b"/></svg>');
  await launch('# Rich document\n\n| Input | Result |\n| --- | --- |\n| Markdown | Rendered |\n\n- [x] Finished task\n- [ ] Pending task\n\n![Local diagram](assets/pixel%20%23%20one.svg)\n\nFinal paragraph.\n');
  await enterEditor();
  await expect(editor().locator('table')).toBeVisible();
  await expect.poll(() => editor().getByRole('img', { name: 'Local diagram' }).evaluate(image => image.naturalWidth)).toBe(100);
  await appendText(' Added text.');
  await application.evaluate(({ BrowserWindow, nativeTheme }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1100, 950);
    nativeTheme.themeSource = 'light';
  });
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  await page.screenshot({ path: 'test-results/editor-rich-light.png' });
  await page.getByRole('switch', { name: 'Dark mode' }).click();
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await page.screenshot({ path: 'test-results/editor-rich-dark.png' });
  await page.locator('#save-file').click();
  await expectSaved();
  await returnToPreview();
  await expect(page.locator('#markdown table')).toContainText('Rendered');
  await expect(page.locator('#markdown input[type=checkbox]').first()).toBeChecked();
  await expect(page.locator('#markdown input[type=checkbox]').nth(1)).not.toBeChecked();
  await expect.poll(() => page.locator('#markdown img').evaluate(image => image.naturalWidth)).toBe(100);
  const saved = await readFile(file, 'utf8');
  expect(saved).toContain('[x] Finished task');
  expect(saved).toContain('[ ] Pending task');
  expect(saved).toContain('![Local diagram](assets/pixel%20%23%20one.svg)');
  expect(saved).not.toContain('mdview://');
  expect(saved).toContain('Added text.');
});

test('task checkboxes save their state and Enter creates a new unchecked task', async () => {
  await launch('First task\n');
  await enterEditor();
  await editor().focus();
  await page.getByRole('button', { name: 'Task list', exact: true }).click();
  const checkboxes = editor().getByRole('checkbox', { name: 'Task completed' });
  await expect(checkboxes).toHaveCount(1);
  await checkboxes.first().check();
  await editor().locator('.task-content p').first().click();
  await page.keyboard.press('End');
  await expect.poll(() => page.evaluate(() => getSelection().anchorOffset)).toBe('First task'.length);
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('Second task');
  await expect(checkboxes).toHaveCount(2);
  await expect(checkboxes.first()).toBeChecked();
  await expect(checkboxes.nth(1)).not.toBeChecked();
  await page.locator('#save-file').click();
  await expectSaved();
  await returnToPreview();
  const saved = await readFile(file, 'utf8');
  expect(saved).toContain('[x] First task');
  expect(saved).toContain('[ ] Second task');
  await expect(page.locator('#markdown input[type=checkbox]')).toHaveCount(2);
  await expect(page.locator('#markdown input[type=checkbox]').first()).toBeChecked();
  await expect(page.locator('#markdown input[type=checkbox]').nth(1)).not.toBeChecked();
});

test('the toolbar inserts a table and adds rows and columns that save correctly', async () => {
  await launch('A table follows.\n');
  await enterEditor();
  await editor().focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Insert table', exact: true }).click();
  const table = editor().locator('table');
  await expect(table.locator('tr')).toHaveCount(2);
  await table.locator('td p').first().click();
  await page.keyboard.insertText('First cell');
  await page.getByRole('button', { name: 'Add table row', exact: true }).click();
  await expect(table.locator('tr')).toHaveCount(3);
  await page.getByRole('button', { name: 'Add table column', exact: true }).click();
  await expect(table.locator('th')).toHaveCount(3);
  await expect(table.locator('td')).toHaveCount(6);
  await page.locator('#save-file').click();
  await expectSaved();
  await returnToPreview();
  await expect(page.locator('#notice')).toBeHidden();
  await expect(page.locator('#markdown table tr')).toHaveCount(3);
  await expect(page.locator('#markdown table th')).toHaveCount(3);
  await expect(page.locator('#markdown table td')).toHaveCount(6);
  await expect(page.locator('#markdown table')).toContainText('First cell');
  expect(await readFile(file, 'utf8')).toContain('First cell');
});

test('the link dialog uses selected words and saves their link', async () => {
  await launch('Selected link words\n');
  await enterEditor();
  await editor().focus();
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: 'Insert link', exact: true }).click();
  const dialog = page.locator('#insert-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Link text', exact: true })).toHaveValue('Selected link words');
  await dialog.getByRole('textbox', { name: 'URL or relative path', exact: true }).fill('https://example.com/guide');
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(editor().getByRole('link', { name: 'Selected link words', exact: true })).toHaveAttribute('href', 'https://example.com/guide');
  await page.locator('#save-file').click();
  await expectSaved();
  await returnToPreview();
  await expect(page.locator('#markdown').getByRole('link', { name: 'Selected link words', exact: true })).toHaveAttribute('href', 'https://example.com/guide');
  expect(await readFile(file, 'utf8')).toContain('[Selected link words](https://example.com/guide)');
});

test('unsafe HTML and links remain inert during editing and after saving', async () => {
  await launch('# Safe editing\n\n<script>window.compromised = true</script>\n\n<img src=x onerror="window.compromised = true">\n\n[Unsafe](javascript:alert(1))\n\nFinal paragraph.\n');
  await enterEditor();
  expect(await page.evaluate(() => window.compromised)).toBeUndefined();
  await expect(editor().locator('script, [onerror], a[href^="javascript:"]')).toHaveCount(0);
  await appendText(' Still safe.');
  await page.locator('#save-file').click();
  await expectSaved();
  await returnToPreview();
  expect(await page.evaluate(() => window.compromised)).toBeUndefined();
  await expect(page.locator('#markdown script, #markdown [onerror], #markdown a[href^="javascript:"]')).toHaveCount(0);
  await expect(page.locator('#markdown')).toContainText('Still safe.');
});

test('editing remains usable with theme, width, zoom and a narrow window', async () => {
  await launch('# Appearance\n\nEdit this paragraph.\n');
  await enterEditor();
  await application.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light'; });
  const toggle = page.getByRole('switch', { name: 'Dark mode' });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await expect(editor()).toHaveCSS('color', 'rgb(221, 225, 228)');
  const width = page.getByRole('slider', { name: 'Reading width' });
  await width.focus();
  await page.keyboard.press('Home');
  await expect(page.locator('#width-level')).toHaveText('20%');
  await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -120, cancelable: true })));
  await expect(page.locator('#zoom-level')).toHaveText('110%');
  await expect(editor()).toHaveCSS('font-size', '19.8px');
  expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())).toBe(1);
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(440, 700));
  const controls = [page.locator('#save-file'), page.locator('#cancel-edit'), page.locator('#block-format'), width, toggle];
  for (const name of ['Bold', 'Italic', 'Strikethrough', 'Bullet list', 'Numbered list', 'Task list', 'Quote', 'Code block', 'Undo', 'Redo']) {
    controls.push(page.getByRole('button', { name, exact: true }));
  }
  for (const control of controls) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  }
  await width.focus();
  await page.keyboard.press('End');
  await appendText(' Narrow editor works.');
  await page.screenshot({ path: 'test-results/editor-narrow.png' });
  await page.locator('#save-file').click();
  await expectSaved();
  await returnToPreview();
  await expect(page.locator('#markdown')).toContainText('Narrow editor works.');
  await expect(page.locator('#zoom-level')).toHaveText('110%');
  await expect(toggle).toBeChecked();
  await expect(width).toHaveValue('100');
});
