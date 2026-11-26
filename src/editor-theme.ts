import { EditorView } from '@codemirror/view';
import { HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

export const editorHighlight = HighlightStyle.define([
  { tag: tags.propertyName, color: '#83d7a5' },
  { tag: tags.string, color: '#bc9df5' },
  { tag: [tags.number, tags.bool, tags.null], color: '#efa4bd' },
  { tag: tags.bracket, color: '#b8c9ee' },
  { tag: tags.punctuation, color: '#c0c3cb' },
]);

export const editorTheme = (fontSize: number) => EditorView.theme({
  '&': { height: '100%', backgroundColor: '#1b1c20', color: '#d1d3da', fontSize: `${fontSize}px` },
  '.cm-scroller': { overflow: 'auto', fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", "PingFang SC", monospace', lineHeight: '1.65', scrollbarWidth: 'thin', scrollbarColor: '#45474f transparent' },
  '.cm-content': { padding: '12px 0 60px', caretColor: '#b5c0d3' },
  '.cm-line': { padding: '0 28px 0 8px' },
  '.cm-gutters': { backgroundColor: '#1b1c20', border: 'none', color: '#666a75', userSelect: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '52px', padding: '0 10px 0 12px', fontSize: '0.82em' },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 7px 0 0', color: '#626874' },
  '.cm-activeLine': { backgroundColor: '#ffffff04' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#bbc0ca' },
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: '#35455f !important' },
  '.cm-cursor': { borderLeftColor: '#c3cad6' },
  '.cm-panels': { backgroundColor: '#25262d', color: '#d8dce4', borderColor: '#363942', font: '13px system-ui' },
  '.cm-search': { padding: '10px 14px !important' },
  '.cm-textfield': { backgroundColor: '#191a1f', border: '1px solid #434751', color: '#e0e3e9', padding: '5px 8px', outline: 'none' },
  '.cm-button': { backgroundImage: 'none', backgroundColor: '#353842', border: '1px solid #4a4f5c', color: '#e0e3e9', borderRadius: '3px' },
  '.cm-searchMatch': { backgroundColor: '#8e723c55', outline: '1px solid #b4965355' },
  '.cm-searchMatch-selected': { backgroundColor: '#a0874c99' },
}, { dark: true });
