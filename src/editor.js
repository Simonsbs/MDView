import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { baseKeymap, chainCommands, exitCode, lift, setBlockType, toggleMark, wrapIn } from 'prosemirror-commands';
import { history, undo, redo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { wrapInList, splitListItem, liftListItem, sinkListItem } from 'prosemirror-schema-list';
import { addColumnAfter, addRowAfter, goToNextCell, tableEditing } from 'prosemirror-tables';
import { schema, parser, serializer } from './editor-markdown.js';

export function imageSource(source, documentId) {
  const value = String(source || '').trim();
  if (/^(https?:|data:image\/(png|gif|jpeg|webp|avif|bmp);)/i.test(value)) return value;
  if (value.startsWith('//')) return `https:${value}`;
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !value.startsWith('file:')) return '';
  return `mdview://image/?${new URLSearchParams({ document: documentId, source: value })}`;
}

export function createVisualEditor(host, { markdown, documentId, onChange }) {
  let savedDocument = parser.parse(markdown);
  const commands = {
    bold: toggleMark(schema.marks.strong),
    italic: toggleMark(schema.marks.em),
    strike: toggleMark(schema.marks.strike),
    code: toggleMark(schema.marks.code),
    bullet: toggleList(schema.nodes.bullet_list),
    ordered: toggleList(schema.nodes.ordered_list),
    task: toggleTasks,
    quote: (state, dispatch) => inside(state, 'blockquote') ? lift(state, dispatch) : wrapIn(schema.nodes.blockquote)(state, dispatch),
    codeblock: (state, dispatch) => setBlockType(state.selection.$from.parent.type === schema.nodes.code_block ? schema.nodes.paragraph : schema.nodes.code_block)(state, dispatch),
    undo, redo,
    row: addRowAfter,
    column: addColumnAfter,
    table: insertTable,
  };
  const view = new EditorView(host, {
    state: EditorState.create({
      doc: savedDocument,
      plugins: [
        history(),
        keymap({
          'Mod-z': undo, 'Mod-y': redo, 'Mod-Shift-z': redo,
          'Mod-b': commands.bold, 'Mod-i': commands.italic,
          'Mod-Enter': chainCommands(exitCode, (state, dispatch) => {
            if (!dispatch) return true;
            const tr = state.tr.insert(state.doc.content.size, schema.nodes.paragraph.create());
            dispatch(tr.setSelection(TextSelection.create(tr.doc, tr.doc.content.size - 1)).scrollIntoView());
            return true;
          }),
          Enter: (state, dispatch, editorView) => {
            // A native End/click can move the DOM caret before selectionchange
            // reaches the model. Split at the visible caret, including in tasks.
            const selection = dispatch && state.selection instanceof TextSelection
              ? editorView.dom.ownerDocument.getSelection() : null;
            if (selection?.anchorNode && selection.focusNode
                && editorView.dom.contains(selection.anchorNode) && editorView.dom.contains(selection.focusNode)) {
              const anchor = editorView.posAtDOM(selection.anchorNode, selection.anchorOffset, 1);
              const head = editorView.posAtDOM(selection.focusNode, selection.focusOffset, 1);
              if (state.doc.resolve(anchor).parent.inlineContent && state.doc.resolve(head).parent.inlineContent
                  && (anchor !== state.selection.anchor || head !== state.selection.head)) {
                dispatch(state.tr.setSelection(TextSelection.create(state.doc, anchor, head)));
                state = editorView.state;
              }
            }
            const depth = inside(state, 'list_item');
            const task = depth && state.selection.$from.node(depth).attrs.checked !== null;
            return splitListItem(schema.nodes.list_item, { checked: task ? false : null })(state, dispatch && (tr => {
              // Splitting in the middle of a checked task also starts an unchecked task.
              const newDepth = inside({ selection: tr.selection }, 'list_item');
              if (task && newDepth) {
                const pos = tr.selection.$from.before(newDepth);
                tr.setNodeMarkup(pos, null, { ...tr.doc.nodeAt(pos).attrs, checked: false });
              }
              dispatch(tr);
            }));
          },
          Tab: chainCommands(goToNextCell(1), sinkListItem(schema.nodes.list_item)),
          'Shift-Tab': chainCommands(goToNextCell(-1), liftListItem(schema.nodes.list_item)),
        }),
        keymap(baseKeymap),
        tableEditing(),
      ],
    }),
    attributes: { role: 'textbox', 'aria-label': 'Edit Markdown document', 'aria-multiline': 'true', spellcheck: 'true' },
    dispatchTransaction(transaction) {
      if (transaction.docChanged && !view.editable) return;
      view.updateState(view.state.apply(transaction));
      onChange();
    },
    handleClick(_view, _pos, event) {
      if (event.target.closest('a')) event.preventDefault();
      return false;
    },
    handleDOMEvents: {
      // File drops belong to the app's open-file flow, never image embedding.
      drop: (_view, event) => event.dataTransfer?.files.length ? (event.preventDefault(), true) : false,
    },
    nodeViews: {
      image(node) {
        const dom = document.createElement('img');
        const source = imageSource(node.attrs.src, documentId);
        if (source) dom.src = source;
        dom.alt = node.attrs.alt || '';
        dom.title = node.attrs.title || '';
        dom.referrerPolicy = 'no-referrer';
        return { dom };
      },
      list_item(node, editorView, getPos) {
        const dom = document.createElement('li');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.contentEditable = 'false';
        checkbox.setAttribute('aria-label', 'Task completed');
        checkbox.className = 'task-list-item-checkbox';
        const contentDOM = document.createElement('div');
        contentDOM.className = 'task-content';
        dom.append(checkbox, contentDOM);
        function update(current) {
          if (current.type !== schema.nodes.list_item) return false;
          node = current;
          const task = typeof node.attrs.checked === 'boolean';
          dom.classList.toggle('task-list-item', task);
          if (task) dom.dataset.checked = String(node.attrs.checked);
          else delete dom.dataset.checked;
          checkbox.hidden = !task;
          checkbox.checked = node.attrs.checked === true;
          return true;
        }
        update(node);
        checkbox.addEventListener('mousedown', event => event.preventDefault());
        checkbox.addEventListener('change', () => {
          if (!editorView.editable) { checkbox.checked = node.attrs.checked === true; return; }
          const pos = getPos();
          if (typeof pos === 'number') editorView.dispatch(editorView.state.tr.setNodeMarkup(pos, null, { ...node.attrs, checked: checkbox.checked }));
        });
        return { dom, contentDOM, update, stopEvent: event => event.target === checkbox,
          ignoreMutation: mutation => mutation.type !== 'selection' && (mutation.target === checkbox || mutation.target === dom) };
      },
    },
  });

  function inside(state, name) {
    for (let depth = state.selection.$from.depth; depth > 0; depth--) {
      if (state.selection.$from.node(depth).type.name === name) return depth;
    }
    return 0;
  }

  function toggleList(type) {
    return (state, dispatch) => {
      if (inside(state, type.name)) return liftListItem(schema.nodes.list_item)(state, dispatch);
      for (const name of ['bullet_list', 'ordered_list']) {
        const depth = inside(state, name);
        if (depth) {
          if (dispatch) dispatch(state.tr.setNodeMarkup(state.selection.$from.before(depth), type));
          return true;
        }
      }
      return wrapInList(type)(state, dispatch);
    };
  }

  function toggleTasks(state, dispatch) {
    const itemDepth = inside(state, 'list_item');
    if (itemDepth) {
      if (dispatch) {
        const tr = state.tr;
        const checked = state.selection.$from.node(itemDepth).attrs.checked === null ? false : null;
        const positions = new Set([state.selection.$from.before(itemDepth)]);
        state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
          if (node.type === schema.nodes.list_item) positions.add(pos);
        });
        for (const pos of positions) tr.setNodeMarkup(pos, null, { ...state.doc.nodeAt(pos).attrs, checked });
        dispatch(tr);
      }
      return true;
    }
    return wrapInList(schema.nodes.bullet_list)(state, dispatch && (tr => {
      const wrapped = state.apply(tr);
      const positions = new Set();
      const depth = inside(wrapped, 'list_item');
      if (depth) positions.add(wrapped.selection.$from.before(depth));
      tr.doc.nodesBetween(tr.selection.from, tr.selection.to, (node, pos) => {
        if (node.type === schema.nodes.list_item) positions.add(pos);
      });
      for (const pos of positions) tr.setNodeMarkup(pos, null, { checked: false });
      dispatch(tr);
    }));
  }

  function insertTable(state, dispatch) {
    if (inside(state, 'table')) return false;
    if (dispatch) {
      const cell = (type, text = '') => type.create(null, schema.nodes.paragraph.create(null, text ? schema.text(text) : null));
      const table = schema.nodes.table.create(null, [
        schema.nodes.table_row.create(null, [cell(schema.nodes.table_header, 'Column 1'), cell(schema.nodes.table_header, 'Column 2')]),
        schema.nodes.table_row.create(null, [cell(schema.nodes.table_cell), cell(schema.nodes.table_cell)]),
      ]);
      const tr = state.tr.replaceSelectionWith(table);
      if (tr.doc.lastChild.type === schema.nodes.table) tr.insert(tr.doc.content.size, schema.nodes.paragraph.create());
      dispatch(tr.scrollIntoView());
    }
    return true;
  }

  return {
    view,
    get dirty() { return !view.state.doc.eq(savedDocument); },
    markSaved() { savedDocument = view.state.doc; },
    getMarkdown() { return serializer.serialize(view.state.doc); },
    run(name) { commands[name]?.(view.state, view.dispatch, view); view.focus(); },
    setBlock(value) {
      const heading = /^heading-([1-6])$/.exec(value);
      setBlockType(heading ? schema.nodes.heading : schema.nodes.paragraph, heading ? { level: Number(heading[1]) } : null)(view.state, view.dispatch);
      view.focus();
    },
    selectionText() { return view.state.doc.textBetween(view.state.selection.from, view.state.selection.to, ' '); },
    insert(kind, text, url) {
      const { from, to } = view.state.selection;
      const tr = view.state.tr;
      if (kind === 'image') tr.replaceSelectionWith(schema.nodes.image.create({ src: url, alt: text }));
      else if (from !== to && (!text || text === this.selectionText())) tr.addMark(from, to, schema.marks.link.create({ href: url }));
      else tr.replaceSelectionWith(schema.text(text || url, [schema.marks.link.create({ href: url })]), false);
      view.dispatch(tr.scrollIntoView());
      view.focus();
    },
    updateToolbar(toolbar) {
      const { state } = view;
      const marks = state.storedMarks || state.selection.$from.marks();
      for (const [name, type] of [['bold', 'strong'], ['italic', 'em'], ['strike', 'strike'], ['code', 'code']]) {
        toolbar.querySelector(`[data-command="${name}"]`).setAttribute('aria-pressed', String(state.selection.empty
          ? Boolean(schema.marks[type].isInSet(marks)) : state.doc.rangeHasMark(state.selection.from, state.selection.to, schema.marks[type])));
      }
      const parent = state.selection.$from.parent;
      toolbar.querySelector('#block-format').value = parent.type === schema.nodes.heading ? `heading-${parent.attrs.level}` : 'paragraph';
      for (const name of ['undo', 'redo']) toolbar.querySelector(`[data-command="${name}"]`).disabled = !commands[name](state);
      for (const name of ['row', 'column']) toolbar.querySelector(`[data-command="${name}"]`).hidden = !inside(state, 'table');
    },
    destroy() { view.destroy(); },
  };
}
