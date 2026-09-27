const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');

const result = buildSync({
  entryPoints: [path.join(__dirname, '../src/editor-markdown.js')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
});
const compiled = new Module(path.join(__dirname, 'editor-markdown-bundle.cjs'), module);
compiled.filename = path.join(__dirname, 'editor-markdown-bundle.cjs');
compiled.paths = module.paths;
compiled._compile(result.outputFiles[0].text, compiled.filename);
const { schema, parser, serializer } = compiled.exports;

function roundTrip(markdown) {
  const before = parser.parse(markdown);
  before.check();
  const saved = serializer.serialize(before);
  const after = parser.parse(saved);
  after.check();
  assert.deepEqual(after.toJSON(), before.toJSON(), saved);
  return { before, saved };
}

test('visual editing preserves headings, marks, quotes, fences, links, images and lists', () => {
  roundTrip('# Title\n\nText **bold** *italic* ~~removed~~ `code`.\n\n'
    + '> Quoted text\n\n'
    + '~~~js\nconst value = "```";\n~~~\n\n'
    + '3. First\n4. Second\n   - Nested\n\n'
    + '[link](https://example.com/path "Title") and ![alt *text*](image.png "Image")\n\n---');
});

test('tasks retain checked state, nesting, empty labels and literal escaped markers', () => {
  const { before, saved } = roundTrip('- [ ] Pending\n- [x] Done\n  - [X] Nested\n- [ ]\n- \\[x] Literal');
  const list = before.firstChild;
  assert.equal(list.child(0).attrs.checked, false);
  assert.equal(list.child(1).attrs.checked, true);
  assert.equal(list.child(1).child(1).child(0).attrs.checked, true);
  assert.equal(list.child(2).attrs.checked, false);
  assert.equal(list.child(3).attrs.checked, null);
  assert.match(saved, /\[x\] Done/);
});

test('GFM tables preserve alignment, formatting, escaped pipes and inline code', () => {
  const { before } = roundTrip('| Left | Center | Right |\n| :--- | :---: | ---: |\n'
    + '| **a\\|b** | `a\\|b` | [link](https://example.com/a%7Cb) |\n'
    + '| backslash \\\\ and pipe \\| | ~~removed~~ | ![image](image.png) |');
  assert.equal(before.firstChild.type, schema.nodes.table);
  assert.deepEqual([0, 1, 2].map(index => before.firstChild.firstChild.child(index).attrs.align), ['left', 'center', 'right']);
  assert.equal(before.firstChild.child(1).child(1).textContent, 'a|b');
});

test('literal HTML and unsafe Markdown links remain text', () => {
  const { before, saved } = roundTrip('<script>alert(1)</script>\n\n'
    + '<img src="x" onerror="alert(2)">\n\n'
    + '[unsafe](javascript:alert(3))');
  assert.ok(before.textContent.includes('<script>alert(1)</script>'));
  assert.ok(saved.includes('img'));
  let unsafeLink = false;
  before.descendants(node => { unsafeLink ||= node.marks.some(mark => mark.type.name === 'link'); });
  assert.equal(unsafeLink, false);
});

test('literal entities and angle-bracket email text typed into the editor remain literal after saving', () => {
  const text = 'An &copy; entity and <person@example.com>.';
  const document = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, schema.text(text)));
  assert.deepEqual(parser.parse(serializer.serialize(document)).toJSON(), document.toJSON());
});

test('inline code with pipes and backslashes in table cells survives saving', () => {
  const paragraph = value => schema.nodes.paragraph.create(null, schema.text(value, [schema.marks.code.create()]));
  const header = schema.nodes.table_header.create(null, paragraph('Code'));
  for (const text of ['a|b', 'a\\|b', 'a\\\\|b', '|', '`|`', 'a\\b']) {
    const cell = schema.nodes.table_cell.create(null, paragraph(text));
    const table = schema.nodes.table.create(null, [schema.nodes.table_row.create(null, header), schema.nodes.table_row.create(null, cell)]);
    const document = schema.nodes.doc.create(null, table);
    const saved = serializer.serialize(document);
    assert.deepEqual(parser.parse(saved).toJSON(), document.toJSON(), saved);
  }
});

test('table line breaks fail visibly instead of splitting the table or dropping content', () => {
  const paragraph = schema.nodes.paragraph.create(null, [schema.text('First'), schema.nodes.hard_break.create(), schema.text('Second')]);
  const header = schema.nodes.table_header.create(null, paragraph);
  const table = schema.nodes.table.create(null, schema.nodes.table_row.create(null, header));
  assert.throws(() => serializer.serialize(schema.nodes.doc.create(null, table)), /cannot contain line breaks/);
});

test('table serializer rejects merged cells rather than silently dropping their structure', () => {
  const paragraph = schema.nodes.paragraph.create(null, schema.text('Merged'));
  const header = schema.nodes.table_header.create({ colspan: 2 }, paragraph);
  const table = schema.nodes.table.create(null, schema.nodes.table_row.create(null, header));
  assert.throws(() => serializer.serialize(schema.nodes.doc.create(null, table)), /no merged cells/);
});

test('unknown parser tokens fail visibly', () => {
  parser.tokenizer.core.ruler.push('unsupported-test', state => {
    state.tokens.push(new state.Token('unsupported_extension', '', 0));
  });
  try {
    assert.throws(() => parser.parse('Retain this text'), /unsupported_extension/);
  } finally {
    parser.tokenizer.core.ruler.disable('unsupported-test');
  }
});
