import type { Extension, Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { DocumentModel } from '../types';

class ReadingBreak extends WidgetType {
  eq() { return true; }
  get lineBreaks() { return 1; }
  toDOM(view: EditorView) {
    const span = view.dom.ownerDocument.createElement('span');
    span.className = 'cm-reading-break';
    span.setAttribute('aria-hidden', 'true');
    span.appendChild(view.dom.ownerDocument.createElement('br'));
    return span;
  }
}

class ReadingTab extends WidgetType {
  eq() { return true; }
  toDOM(view: EditorView) {
    const span = view.dom.ownerDocument.createElement('span');
    span.className = 'cm-reading-tab';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = '  ';
    span.style.whiteSpace = 'pre-wrap';
    return span;
  }
}

const lineBreak = Decoration.replace({ widget: new ReadingBreak() });
const tabSpace = Decoration.replace({ widget: new ReadingTab() });
const hidden = Decoration.replace({});
type Unit = { end: number; kind: 'break' | 'tab' | 'space' | 'text' };

/** Consume an entire JSON escape, so a literal backslash followed by n stays visible. */
function nextUnit(text: string, position: number): Unit {
  let code = text.charCodeAt(position);
  let end = position + 1;
  if (code === 92) {
    const escape = text[position + 1];
    end = position + (escape === 'u' ? 6 : 2);
    if (escape === 'n') code = 10;
    else if (escape === 'r') code = 13;
    else if (escape === 't') code = 9;
    else if (escape === 'u') code = Number.parseInt(text.slice(position + 2, end), 16);
    else return { end, kind: 'text' };
  }
  const kind = code === 10 || code === 13 ? 'break'
    : code === 9 ? 'tab'
      : /\s/u.test(String.fromCharCode(code)) ? 'space' : 'text';
  return { end, kind };
}

/** Change only the view; the JSON document and all original-source offsets stay intact. */
export function readingWhitespace(model: DocumentModel): Extension {
  const ranges: Range<Decoration>[] = [];
  for (const slot of model.slots) {
    const start = slot.from + 1;
    const end = slot.to - 1;
    let position = start;
    while (position < end) {
      let unit = nextUnit(model.text, position);
      if (unit.kind === 'text') { position = unit.end; continue; }
      const runStart = position;
      let hasBreak = false;
      const tabs: { from: number; to: number }[] = [];
      while (position < end && unit.kind !== 'text') {
        if (unit.kind === 'break') hasBreak = true;
        else if (unit.kind === 'tab') tabs.push({ from: position, to: unit.end });
        position = unit.end;
        if (position < end) unit = nextUnit(model.text, position);
      }
      if (hasBreak) {
        // CRLF, blank lines and their indentation form one visual paragraph break.
        const decoration = runStart === start || position === end ? hidden : lineBreak;
        ranges.push(decoration.range(runStart, position));
      } else {
        // Ordinary spaces are untouched; only encoded tabs need a visible substitute.
        for (const tab of tabs) ranges.push(tabSpace.range(tab.from, tab.to));
      }
    }
  }
  const decorations = Decoration.set(ranges, true);
  return [
    EditorView.decorations.of(decorations),
    EditorView.atomicRanges.of(() => decorations),
  ];
}
