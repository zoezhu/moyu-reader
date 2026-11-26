import type { Extension, Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { DocumentModel } from '../types';
import { encodedReadingCharacters } from './reading-encoding';

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

/** Change only the view; source text and every original-source offset stay intact. */
export function readingWhitespace(model: DocumentModel): Extension {
  const ranges: Range<Decoration>[] = [];
  for (const slot of model.slots) {
    const units = encodedReadingCharacters(model.text.slice(slot.from, slot.to), slot.encoding);
    let index = 0;
    while (index < units.length) {
      if (!/\s/u.test(units[index].character)) { index++; continue; }
      const runStart = index;
      let hasBreak = false;
      const tabs: { from: number; to: number }[] = [];
      while (index < units.length && /\s/u.test(units[index].character)) {
        const unit = units[index];
        if (unit.character === '\r' || unit.character === '\n') hasBreak = true;
        else if (unit.character === '\t') tabs.push({ from: slot.from + unit.from, to: slot.from + unit.to });
        index++;
      }
      if (hasBreak) {
        // CRLF, blank lines and their indentation form one visual paragraph break.
        const decoration = runStart === 0 || index === units.length ? hidden : lineBreak;
        ranges.push(decoration.range(slot.from + units[runStart].from, slot.from + units[index - 1].to));
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
