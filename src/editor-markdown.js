import MarkdownIt from 'markdown-it';
import { Schema } from 'prosemirror-model';
import {
  schema as commonmarkSchema,
  defaultMarkdownParser,
  defaultMarkdownSerializer,
  MarkdownParser,
  MarkdownSerializer,
  MarkdownSerializerState,
} from 'prosemirror-markdown';
import { tableNodes } from 'prosemirror-tables';

// Match the viewer's Markdown dialect. HTML remains literal text, including
// when a document is opened in the visual editor.
const tokenizer = new MarkdownIt({ html: false, linkify: true, typographer: false });

function safeURL(value) {
  return typeof value === 'string' && tokenizer.validateLink(value);
}

const cells = tableNodes({
  tableGroup: 'block',
  cellContent: 'paragraph',
  cellAttributes: {
    align: {
      default: null,
      getFromDOM: element => ['left', 'center', 'right'].includes(element.style.textAlign)
        ? element.style.textAlign : null,
      setDOMAttr(value, attrs) {
        if (['left', 'center', 'right'].includes(value)) attrs.style = `text-align: ${value}`;
      },
    },
  },
});

const nodes = commonmarkSchema.spec.nodes
  .update('heading', { ...commonmarkSchema.spec.nodes.get('heading'), content: 'inline*' })
  .update('list_item', {
    ...commonmarkSchema.spec.nodes.get('list_item'),
    attrs: { checked: { default: null } },
    parseDOM: [{
      tag: 'li',
      getAttrs(element) {
        const checked = element.getAttribute('data-checked');
        return { checked: checked === 'true' ? true : checked === 'false' ? false : null };
      },
      contentElement: element => element.querySelector('.task-content') || element,
    }],
    toDOM(node) {
      if (node.attrs.checked === null) return ['li', 0];
      return ['li', { class: 'task-list-item', 'data-checked': String(node.attrs.checked) },
        ['div', { class: 'task-content' }, 0]];
    },
  })
  .update('image', {
    ...commonmarkSchema.spec.nodes.get('image'),
    parseDOM: [{
      tag: 'img[src]',
      getAttrs(element) {
        const src = element.getAttribute('src');
        if (!safeURL(src)) return false;
        return { src, alt: element.getAttribute('alt'), title: element.getAttribute('title') };
      },
    }],
    toDOM(node) {
      return ['img', { ...node.attrs, src: safeURL(node.attrs.src) ? node.attrs.src : '' }];
    },
  })
  .append(cells);

const marks = commonmarkSchema.spec.marks
  .update('link', {
    ...commonmarkSchema.spec.marks.get('link'),
    parseDOM: [{
      tag: 'a[href]',
      getAttrs(element) {
        const href = element.getAttribute('href');
        return safeURL(href) ? { href, title: element.getAttribute('title') } : false;
      },
    }],
    toDOM(mark) {
      return ['a', { ...mark.attrs, href: safeURL(mark.attrs.href) ? mark.attrs.href : '#' }];
    },
  })
  .addBefore('code', 'strike', {
    parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }],
    toDOM: () => ['s', 0],
  });

export const schema = new Schema({ nodes, marks });

// Keep task state in the document model rather than injecting HTML checkbox
// tokens. Adding paragraph wrappers gives table cells the usual editor shape.
tokenizer.core.ruler.after('block', 'editor-blocks', state => {
  const tokens = [];
  for (let index = 0; index < state.tokens.length; index += 1) {
    const token = state.tokens[index];
    if (token.type === 'list_item_open'
        && state.tokens[index + 1]?.type === 'paragraph_open'
        && state.tokens[index + 2]?.type === 'inline') {
      const inline = state.tokens[index + 2];
      const task = /^\[([ xX])\](?:[ \t]+|$)/.exec(inline.content);
      if (task) {
        token.meta = { ...token.meta, checked: task[1].toLowerCase() === 'x' };
        inline.content = inline.content.slice(task[0].length);
      }
    }
    if (token.type === 'th_close' || token.type === 'td_close') {
      tokens.push(new state.Token('paragraph_close', 'p', -1));
    }
    tokens.push(token);
    if (token.type === 'th_open' || token.type === 'td_open') {
      tokens.push(new state.Token('paragraph_open', 'p', 1));
    }
  }
  state.tokens = tokens;
});

function cellAttrs(token) {
  const align = /text-align:\s*(left|center|right)/.exec(token.attrGet('style') || '')?.[1] || null;
  return { align };
}

export const parser = new MarkdownParser(schema, tokenizer, {
  ...defaultMarkdownParser.tokens,
  list_item: { block: 'list_item', getAttrs: token => ({ checked: token.meta?.checked ?? null }) },
  image: {
    node: 'image',
    getAttrs: token => ({
      src: token.attrGet('src'),
      title: token.attrGet('title') || null,
      alt: tokenizer.renderer.renderInlineAsText(token.children || [], tokenizer.options, {}) || null,
    }),
  },
  s: { mark: 'strike' },
  table: { block: 'table' },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: 'table_row' },
  th: { block: 'table_header', getAttrs: cellAttrs },
  td: { block: 'table_cell', getAttrs: cellAttrs },
});

const nodeSerializers = {
  ...defaultMarkdownSerializer.nodes,
  list_item(state, node) {
    if (node.attrs.checked !== null) state.write(node.attrs.checked ? '[x] ' : '[ ] ');
    state.renderContent(node);
  },
  table(state, table) {
    const width = table.firstChild.childCount;
    const rows = [];
    table.forEach((row, _, rowIndex) => {
      if (row.childCount !== width) throw new Error('Markdown tables must have the same number of cells in every row.');
      const content = [];
      row.forEach((cell, _, columnIndex) => {
        if (cell.attrs.colspan !== 1 || cell.attrs.rowspan !== 1
            || cell.childCount !== 1 || cell.firstChild.type !== schema.nodes.paragraph) {
          throw new Error('Markdown tables support one paragraph per cell and no merged cells.');
        }
        if ((rowIndex === 0) !== (cell.type === schema.nodes.table_header)) {
          throw new Error('Markdown tables require one header row at the top.');
        }
        if (cell.attrs.align !== table.firstChild.child(columnIndex).attrs.align) {
          throw new Error('Markdown table alignment must be the same throughout each column.');
        }
        let hasLineBreak = false;
        cell.descendants(child => { hasLineBreak ||= child.type === schema.nodes.hard_break; });
        if (hasLineBreak) throw new Error('Markdown table cells cannot contain line breaks. Use separate rows.');
        const inline = new MarkdownSerializerState(nodeSerializers, markSerializers, serializerOptions);
        inline.renderInline(cell.firstChild, false);
        // GFM requires pipes to be escaped even inside a code span. Escaping
        // after rendering also covers link URLs and image titles.
        content.push(inline.out.replace(/\|/g, '\\|'));
      });
      rows.push(`| ${content.join(' | ')} |`);
      if (rowIndex === 0) {
        const dividers = [];
        row.forEach(cell => dividers.push(
          cell.attrs.align === 'center' ? ':---:' : cell.attrs.align === 'right' ? '---:'
            : cell.attrs.align === 'left' ? ':---' : '---',
        ));
        rows.push(`| ${dividers.join(' | ')} |`);
      }
    });
    for (const row of rows) {
      state.write(row);
      state.ensureNewLine();
    }
    state.closeBlock(table);
  },
};

const markSerializers = {
  ...defaultMarkdownSerializer.marks,
  strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
};

// An edited literal entity or angle-bracket URL must not become a different
// character or a link when the saved Markdown is parsed again.
const serializerOptions = { escapeExtraCharacters: /[<&]/g };
export const serializer = new MarkdownSerializer(nodeSerializers, markSerializers, serializerOptions);
