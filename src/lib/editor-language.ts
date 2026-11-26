import type { Extension, Range } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import { StreamLanguage, syntaxHighlighting, type StringStream } from '@codemirror/language';
import { json } from '@codemirror/lang-json';
import { editorHighlight } from '../editor-theme';
import type { DisplayFormat, DocumentModel, ReadingSlot } from '../types';
import { getDisplayFormat } from './display-formats';

interface TokenState { quote: string; fence: string }
const languageCache = new Map<DisplayFormat, Extension>();

function quoted(stream: StringStream, state: TokenState): string {
  while (!stream.eol()) {
    if (stream.match(state.quote)) { state.quote = ''; break; }
    if (stream.next() === '\\') stream.next();
  }
  return 'string';
}

function sourceLanguage(format: DisplayFormat): Extension {
  if (format === 'json') return json();
  const language = StreamLanguage.define<TokenState>({
    name: format,
    startState: () => ({ quote: '', fence: '' }),
    token(stream, state) {
      if (format === 'dataset') { stream.skipToEnd(); return null; }
      // Generated code literals are single-line; an apostrophe in a raw output
      // must not change the syntax colors of subsequent work records.
      if (stream.sol()) state.quote = '';
      if (state.quote) return quoted(stream, state);
      if (format === 'markdown' && stream.sol()) {
        const fence = stream.match(/^\s*(`{3,}|~{3,})/u);
        if (fence) {
          const delimiter = (fence as RegExpMatchArray)[1];
          if (!state.fence) state.fence = delimiter;
          else if (delimiter[0] === state.fence[0] && delimiter.length >= state.fence.length) state.fence = '';
          stream.skipToEnd(); return 'meta';
        }
        if (state.fence) { stream.skipToEnd(); return 'string'; }
        if (stream.match(/^\s*#{1,6}\s/u)) { stream.skipToEnd(); return 'heading'; }
      }
      if (stream.eatSpace()) return null;
      if ((format === 'python' || format === 'yaml' || format === 'notebook' || format === 'http') && stream.match('#')) { stream.skipToEnd(); return 'comment'; }
      if (format === 'sql' && stream.match('--')) { stream.skipToEnd(); return 'comment'; }
      if ((format === 'xml' || format === 'html') && stream.match('<!--')) {
        if (stream.skipTo('-->')) stream.match('-->'); else stream.skipToEnd();
        return 'comment';
      }
      if ((format === 'xml' || format === 'html') && stream.match(/^<\/?[\w:-]+/u)) return 'tagName';
      if ((format === 'xml' || format === 'html') && stream.match(/^&(?:#x[\da-f]+|#\d+|[a-z]+);/iu)) return 'character';
      if (format === 'markdown' && stream.match(/^`[^`]*`/u)) return 'string';
      if (format === 'markdown' && stream.match(/^\[[^\]]+\]/u)) return 'labelName';
      if (format === 'log' && stream.match(/^\d{4}-\d\d-\d\dT[\d:.]+Z/u)) return 'comment';
      if ((format === 'log' || format === 'tests' || format === 'http') && stream.match(/^(?:INFO|DEBUG|PASS|WARN|ERROR|GET|POST|PUT|PATCH|DELETE|HEAD)\b/u)) return 'keyword';
      const quote = stream.match(/^(?:[eE])?("""|'''|"|')/u);
      if (quote) { state.quote = (quote as RegExpMatchArray)[1]; return quoted(stream, state); }
      if (stream.match(/^(?:true|false|null|True|False|None)\b/u)) return 'bool';
      if (stream.match(/^(?:def|import|from|return|assert|if|else|for|in|class|with|as|SELECT|FROM|WHERE|INSERT|INTO|VALUES|CREATE|TEMP|TABLE|INDEX|ON|CONFLICT|DO|NOTHING|PRIMARY|KEY|NOT|NULL|BEGIN|COMMIT|GROUP|BY|ORDER|LIMIT|AS|IF|EXISTS)\b/iu)) return 'keyword';
      if (stream.match(/^-?\d+(?:\.\d+)?\b/u)) return 'number';
      if (stream.match(/^[\w.-]+(?=\s*[:=])/u)) return 'propertyName';
      if (stream.match(/^[\w.-]+/u)) return null;
      const character = stream.next();
      return character && /[{}[\]()]/u.test(character) ? 'bracket' : null;
    },
    languageData: { commentTokens: format === 'sql' ? { line: '--' } : { line: '#' } },
  });
  return language;
}

export function editorLanguage(format: DisplayFormat = 'json'): Extension {
  const existing = languageCache.get(format);
  if (existing) return existing;
  const name = getDisplayFormat(format).language;
  const extension = [
    sourceLanguage(format), syntaxHighlighting(editorHighlight),
    EditorView.editorAttributes.of({ class: 'cm-format-' + format }),
    EditorView.contentAttributes.of({ 'aria-label': name + ' 内容', spellcheck: 'false', tabindex: '0' }),
  ];
  languageCache.set(format, extension);
  return extension;
}

/** A CSV field remains real editor text, so glyph coordinates and search still work. */
function sourceAttributes(slot: ReadingSlot) {
  return { 'data-source-start': String(slot.sourceStart), 'data-chunk-index': String(slot.chunkIndex), 'data-encoding': slot.encoding ?? 'json' };
}

function datasetCells(model: DocumentModel): Range<Decoration>[] {
  const text = model.text;
  const decorations: Range<Decoration>[] = [];
  const slots = new Map(model.slots.map(slot => [slot.from, slot]));
  let position = 0;
  let column = 0;
  const hide = Decoration.replace({});
  while (position < text.length) {
    const start = position;
    if (text[position] === '"') {
      position++;
      while (position < text.length) {
        if (text[position] !== '"') { position++; continue; }
        if (text[position + 1] === '"') {
          // The table shows the decoded quote while retaining the first glyph
          // at the source map's position and the CSV document unchanged.
          decorations.push(hide.range(position + 1, position + 2));
          position += 2;
          continue;
        }
        position++; break;
      }
    } else {
      while (position < text.length && text[position] !== ',' && text[position] !== '\n') position++;
    }
    if (position > start) {
      const slot = slots.get(start);
      decorations.push(Decoration.mark({
        class: 'cm-dataset-cell cm-dataset-col-' + column + (slot ? ' cm-reading-source' : ''),
        attributes: slot ? sourceAttributes(slot) : column < 4 ? { title: text.slice(start, position) } : {},
      }).range(start, position));
      if (text[start] === '"' && text[position - 1] === '"') {
        decorations.push(hide.range(start, start + 1), hide.range(position - 1, position));
      }
    }
    if (text[position] === ',') { decorations.push(hide.range(position, position + 1)); column++; }
    else column = 0;
    position++;
  }
  return decorations;
}

export function formatPresentation(model: DocumentModel): Extension {
  const ranges: Range<Decoration>[] = [];
  if (model.lineStyles?.length) {
    const starts = [0];
    for (let index = 0; index < model.text.length; index++) if (model.text[index] === '\n') starts.push(index + 1);
    for (const style of model.lineStyles) {
      const position = starts[style.line - 1];
      if (position !== undefined) ranges.push(Decoration.line({ class: 'cm-layout-' + style.kind }).range(position));
    }
  }
  // A raw sample is data even when it contains Markdown headings or code tokens.
  // Its ordinary text color matches other output records in the same format.
  for (const slot of model.slots) {
    if (model.format !== 'dataset' && slot.to > slot.from) ranges.push(Decoration.mark({
      class: 'cm-reading-source' + (slot.encoding === 'raw' ? ' cm-source-literal' : ''),
      attributes: sourceAttributes(slot),
    }).range(slot.from, slot.to));
  }
  if (model.format === 'dataset') {
    for (const cell of datasetCells(model)) ranges.push(cell);
  }
  return EditorView.decorations.of(Decoration.set(ranges, true));
}
