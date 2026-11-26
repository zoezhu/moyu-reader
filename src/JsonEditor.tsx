import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { bracketMatching, foldEffect, foldedRanges, foldGutter, syntaxHighlighting, unfoldAll } from '@codemirror/language';
import { defaultKeymap } from '@codemirror/commands';
import { closeSearchPanel, openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { json } from '@codemirror/lang-json';
import { editorHighlight, editorTheme } from './editor-theme';
import { sourceOffsetToJsonOffset } from './lib/text-position';
import { readingWhitespace } from './lib/reading-whitespace';
import { readingCharacters, type ReadingCharacter } from './lib/reading-characters';
import type { DocumentModel, ReadingDirection, ReadingSlot } from './types';

export interface EditorAnchor { chunkIndex: number; delta: number }
export interface NavigationTarget {
  key: number;
  chunkIndex: number;
  mode: 'read' | 'anchor';
  delta?: number;
  /** Original UTF-16 position; maps to a visual row within a wrapped JSON string. */
  sourceOffset?: number;
  alignTop?: boolean;
  readingDirection?: ReadingDirection;
}
export interface JsonEditorHandle {
  find: () => void;
  park: () => boolean;
  resume: () => void;
  anchor: () => EditorAnchor | null;
  moveReading: (direction: ReadingDirection) => ReadingMoveResult;
  cancelReadingSteps: () => void;
}
interface Props {
  model: DocumentModel;
  fontSize: number;
  target: NavigationTarget;
  onPosition: (line: number, sourceOffset: number | null) => void;
  onBoundary: (direction: ReadingDirection) => void;
  onReadingWindow: (chunkIndex: number, direction: ReadingDirection) => void;
}

type ReadingMoveResult = 'moved' | 'end' | 'busy';

interface AnchorScrollOptions {
  /** Distance to keep between the target and the viewport's top edge. */
  delta?: number;
  selection?: number;
  /** Glyph alignment handles soft wraps; block alignment restores scroll anchors. */
  alignment?: 'glyph' | 'block';
  rememberReadingAnchor?: boolean;
}

const READING_TOP_INSET = 5;

/** Adjacent response windows must stay inside the active chapter. */
function adjacentWindowChunk(model: DocumentModel, direction: ReadingDirection): number | null {
  const index = direction > 0 ? model.windowEnd : model.windowStart - 1;
  return index >= (model.rangeStart ?? 0) && index < (model.rangeEnd ?? model.totalChunks) ? index : null;
}

export const JsonEditor = forwardRef<JsonEditorHandle, Props>(function JsonEditor(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const current = useRef(props);
  const compartment = useRef(new Compartment());
  const readingPresentation = useRef(new Compartment());
  const suppressUntil = useRef(0);
  const parked = useRef(false);
  const parkingReturn = useRef<{
    model: DocumentModel;
    position: number;
    delta: number;
    selection: number;
    folds: { from: number; to: number }[];
  } | null>(null);
  const parkingZone = useRef<{ startLine: number; endLine: number } | null>(null);
  const latestModel = useRef<DocumentModel | null>(null);
  const frame = useRef(0);
  const navigationFrame = useRef(0);
  const afterMeasureFrame = useRef(0);
  const boundaryTimer = useRef(0);
  const movement = useRef(0);
  const navigationPending = useRef(false);
  const queuedReadingSteps = useRef<ReadingDirection[]>([]);
  const readingQueueFrame = useRef(0);
  const movementMeasureKey = useRef({});
  const parkingMeasureKey = useRef({});
  const readingAlignment = useRef<{ model: DocumentModel; position: number; scrollTop: number } | null>(null);
  const characterCache = useRef<{ model: DocumentModel; slots: Map<ReadingSlot, ReadingCharacter[]> } | null>(null);
  current.current = props;

  const charactersIn = (model: DocumentModel, slot: ReadingSlot) => {
    if (characterCache.current?.model !== model) characterCache.current = { model, slots: new Map() };
    const cache = characterCache.current.slots;
    let characters = cache.get(slot);
    if (!characters) {
      characters = readingCharacters(model.text.slice(slot.from, slot.to), slot.from, slot.sourceStart);
      cache.set(slot, characters);
    }
    return characters;
  };

  // CodeMirror block heights start at the first text line, whereas scrollTop
  // includes the document's top padding. Keep these coordinate systems separate.
  const viewport = (editor: EditorView) => {
    const padding = editor.documentPadding.top;
    const top = editor.scrollDOM.scrollTop - padding;
    const height = editor.scrollDOM.clientHeight;
    return { top, height, bottom: top + height, padding };
  };

  const validView = (editor: EditorView, token: number) =>
    view.current === editor && movement.current === token && latestModel.current === current.current.model;

  const clearReadingQueue = () => {
    queuedReadingSteps.current = [];
    cancelAnimationFrame(readingQueueFrame.current);
    readingQueueFrame.current = 0;
  };

  const beginMovement = () => {
    readingAlignment.current = null;
    movement.current++;
    cancelAnimationFrame(navigationFrame.current);
    cancelAnimationFrame(afterMeasureFrame.current);
    cancelAnimationFrame(readingQueueFrame.current);
    readingQueueFrame.current = 0;
    window.clearTimeout(boundaryTimer.current);
    boundaryTimer.current = 0;
    return movement.current;
  };

  const scheduleReport = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      report();
    });
  };

  const scheduleQueuedReading = () => {
    if (!queuedReadingSteps.current.length || readingQueueFrame.current || navigationPending.current) return;
    readingQueueFrame.current = requestAnimationFrame(() => {
      readingQueueFrame.current = 0;
      if (!queuedReadingSteps.current.length || navigationPending.current) return;
      if (parked.current || latestModel.current !== current.current.model) { clearReadingQueue(); return; }
      const direction = queuedReadingSteps.current.shift()!;
      const result = advanceReading(direction);
      // Reaching an edge must not discard a later press in the other direction.
      if (result === 'end') scheduleQueuedReading();
      // The next movement's measure completion schedules the next queued step.
    });
  };

  const isSlotVisible = (editor: EditorView, from: number, to: number) =>
    editor.visibleRanges.some(range => from < range.to && to > range.from);

  const getAnchor = (): EditorAnchor | null => {
    const editor = view.current;
    const model = latestModel.current;
    if (!editor || !model?.slots.length || model !== current.current.model) return null;
    const { top } = viewport(editor);
    const topLine = editor.state.doc.lineAt(editor.lineBlockAtHeight(Math.max(0, top)).from).number;
    const slots = model.slots;
    const slot = [...slots].reverse().find(item => item.line <= topLine) ?? slots[0];
    const block = editor.lineBlockAt(editor.state.doc.line(Math.min(slot.line, editor.state.doc.lines)).from);
    return { chunkIndex: slot.chunkIndex, delta: block.top - top };
  };

  // Re-check parking after CodeMirror has measured wrapped/offscreen lines. A
  // resize, font change, or scroll can invalidate an earlier pixel estimate.
  const maintainParking = () => {
    const editor = view.current;
    const model = latestModel.current;
    const token = movement.current;
    if (!editor || !model || !parked.current || model !== current.current.model) return;
    editor.requestMeasure({
      key: parkingMeasureKey.current,
      read: () => {
        if (!validView(editor, token) || !parked.current) return null;
        const { top, bottom, height, padding } = viewport(editor);
        const margin = Math.max(32, editor.defaultLineHeight);
        const zones = model.parkingZones.map(zone => {
          const start = editor.lineBlockAt(editor.state.doc.line(zone.startLine).from).top;
          const end = editor.lineBlockAt(editor.state.doc.line(zone.endLine).from).bottom;
          return { ...zone, start, end, minTop: start + margin, maxTop: end - height - margin };
        }).filter(zone => zone.maxTop >= zone.minTop);
        if (!zones.length) return null;
        const previous = parkingZone.current;
        const selected = zones.find(zone => previous?.startLine === zone.startLine && previous.endLine === zone.endLine)
          ?? zones.sort((a, b) => Math.abs((a.start + a.end) / 2 - top - height / 2) - Math.abs((b.start + b.end) / 2 - top - height / 2))[0];
        const storyVisible = model.slots.some(slot => {
          if (!isSlotVisible(editor, slot.from, slot.to)) return false;
          const block = editor.lineBlockAt(slot.from);
          return block.bottom > top && block.top < bottom;
        });
        const inside = top >= selected.minTop && top <= selected.maxTop && !storyVisible;
        const targetTop = inside ? top : (selected.minTop + selected.maxTop) / 2;
        const center = editor.lineBlockAtHeight(Math.max(0, targetTop + height / 2));
        // The cursor is moved in a later frame, never during the measure write.
        const position = Math.max(editor.state.doc.line(selected.startLine).from,
          Math.min(editor.state.doc.line(selected.endLine).to, center.from));
        return { selected, scrollTop: targetTop + padding, position };
      },
      write: result => {
        if (!result || !validView(editor, token) || !parked.current) return;
        parkingZone.current = { startLine: result.selected.startLine, endLine: result.selected.endLine };
        const moved = Math.abs(editor.scrollDOM.scrollTop - result.scrollTop) > 1;
        if (moved) editor.scrollDOM.scrollTop = result.scrollTop;
        if (moved || editor.state.selection.main.head !== result.position) {
          cancelAnimationFrame(afterMeasureFrame.current);
          afterMeasureFrame.current = requestAnimationFrame(() => {
            if (!validView(editor, token) || !parked.current) return;
            if (editor.state.selection.main.head !== result.position) {
              editor.dispatch({ selection: { anchor: result.position } });
            }
            scheduleReport();
          });
        }
      },
    });
  };

  const report = () => {
    const editor = view.current;
    if (!editor || latestModel.current !== current.current.model) return;
    const { model, onPosition, onBoundary } = current.current;
    const scroll = editor.scrollDOM;
    const { top, bottom } = viewport(editor);
    const topLine = editor.state.doc.lineAt(editor.lineBlockAtHeight(Math.max(0, top)).from).number;
    let visibleOffset: number | null = null;
    if (!parked.current && !navigationPending.current) {
      for (const slot of model.slots) {
        // Folded text shares a visible block with its placeholder, but must not
        // count as a visible reading paragraph or advance the saved position.
        if (!isSlotVisible(editor, slot.from, slot.to)) continue;
        const block = editor.lineBlockAt(editor.state.doc.line(Math.min(slot.line, editor.state.doc.lines)).from);
        if (block.bottom >= top + 6 && block.top < bottom - 10) {
          // Read the first visible source character rather than the logical
          // JSON line's beginning. This also handles soft wraps and inline br
          // widgets whose second visual row is exactly against the top edge.
          const screenTop = editor.scrollDOM.getBoundingClientRect().top + editor.scrollDOM.clientTop;
          const screenBottom = screenTop + editor.scrollDOM.clientHeight * editor.scaleY;
          for (const character of charactersIn(model, slot)) {
            const coordinates = editor.coordsForChar(character.position);
            if (coordinates && coordinates.bottom > screenTop + 6 * editor.scaleY && coordinates.top < screenBottom - 10 * editor.scaleY) {
              visibleOffset = character.sourceOffset;
              break;
            }
          }
          if (visibleOffset !== null) break;
        }
      }
    }
    onPosition(topLine, visibleOffset);
    if (parked.current) { maintainParking(); return; }
    if (navigationPending.current) return;
    if (scroll.scrollHeight <= scroll.clientHeight + 8) return;
    // Chapter-scoped documents may only load another window within that chapter.
    const lastSlot = model.slots.at(-1);
    const passedLastReadingSlot = !lastSlot || editor.lineBlockAt(lastSlot.from).bottom <= top;
    const forward = passedLastReadingSlot && scroll.scrollTop + scroll.clientHeight > scroll.scrollHeight - 650
      && model.windowEnd < (model.rangeEnd ?? model.totalChunks);
    const firstSlot = model.slots[0];
    const beforeFirstReadingSlot = !firstSlot || editor.lineBlockAt(firstSlot.from).top > top + READING_TOP_INSET;
    const backward = beforeFirstReadingSlot && scroll.scrollTop < 180 && model.windowStart > (model.rangeStart ?? 0);
    const remaining = suppressUntil.current - performance.now();
    if (remaining > 0) {
      // A fast scrollbar drag may already be at the end when the cooldown
      // expires, producing no further scroll event. Retry once after it ends.
      if ((forward || backward) && !boundaryTimer.current) {
        boundaryTimer.current = window.setTimeout(() => {
          boundaryTimer.current = 0;
          scheduleReport();
        }, remaining + 20);
      }
      return;
    }
    if (!model.slots.length) return;
    if (forward) {
      suppressUntil.current = performance.now() + 650;
      onBoundary(1);
    } else if (backward) {
      suppressUntil.current = performance.now() + 650;
      onBoundary(-1);
    }
  };

  const scrollToAnchor = (editor: EditorView, position: number, token: number, options: AnchorScrollOptions = {}) => {
    const { delta = 0, selection = position, alignment = 'block', rememberReadingAnchor = false } = options;
    const alignGlyph = alignment === 'glyph';
    navigationPending.current = true;
    editor.dispatch({
      selection: { anchor: Math.min(selection, editor.state.doc.length) },
      effects: EditorView.scrollIntoView(position, { y: 'start', yMargin: delta }),
    });
    const align = (attempt: number) => {
      navigationFrame.current = requestAnimationFrame(() => {
        if (!validView(editor, token) || parked.current) return;
        editor.requestMeasure({
          key: movementMeasureKey.current,
          read: () => {
            if (!validView(editor, token) || parked.current) return null;
            const previousTop = editor.scrollDOM.scrollTop;
            if (alignGlyph) {
              // Use the real target glyph: cursor coordinates can land on a
              // widget or the other side of a soft wrap.
              const glyph = editor.coordsForChar(position);
              const coordinates = glyph ?? editor.coordsAtPos(position, 1);
              if (coordinates) {
                const visibleTop = editor.scrollDOM.getBoundingClientRect().top + editor.scrollDOM.clientTop * editor.scaleY;
                return {
                  top: previousTop + (coordinates.top - visibleTop) / editor.scaleY - delta - READING_TOP_INSET,
                  previousTop,
                  measured: !!glyph,
                };
              }
            }
            return {
              top: editor.lineBlockAt(position).top + editor.documentPadding.top - delta,
              previousTop,
              measured: !alignGlyph,
            };
          },
          write: result => {
            if (!result || !validView(editor, token) || parked.current) return;
            editor.scrollDOM.scrollTop = Math.max(0, result.top);
            const moved = Math.abs(editor.scrollDOM.scrollTop - result.previousTop) > 0.75;
            // Newly visible CodeMirror lines can change their measured heights
            // after the first scroll. Keep the exact source character fixed and
            // re-check in a later frame before advancing the queued key presses.
            if (alignGlyph && attempt < 3 && (attempt === 0 || moved || !result.measured)) {
              align(attempt + 1);
              return;
            }
            if (rememberReadingAnchor && latestModel.current) {
              readingAlignment.current = { model: latestModel.current, position, scrollTop: editor.scrollDOM.scrollTop };
            }
            navigationPending.current = false;
            // Layout-reading APIs cannot be used in CodeMirror's write phase.
            cancelAnimationFrame(afterMeasureFrame.current);
            afterMeasureFrame.current = requestAnimationFrame(() => {
              if (validView(editor, token) && !parked.current) {
                scheduleReport();
                scheduleQueuedReading();
              }
            });
          },
        });
      });
    };
    align(0);
  };

  const advanceReading = (direction: ReadingDirection): ReadingMoveResult => {
    const editor = view.current;
    const model = latestModel.current;
    if (!editor || !model || model !== current.current.model || parked.current || navigationPending.current) return 'busy';
    if (!model.slots.length) return 'end';
    // Reading navigation reveals folded content instead of silently skipping it.
    if (foldedRanges(editor.state).size) { readingAlignment.current = null; unfoldAll(editor); }
    const screenTop = editor.scrollDOM.getBoundingClientRect().top + editor.scrollDOM.clientTop * editor.scaleY;
    const alignment = readingAlignment.current;
    const alignedGlyph = alignment?.model === model && Math.abs(editor.scrollDOM.scrollTop - alignment.scrollTop) <= 1
      ? editor.coordsForChar(alignment.position) : null;
    const alignedSlot = alignment && alignedGlyph && Math.abs(alignedGlyph.top - screenTop - READING_TOP_INSET * editor.scaleY) <= 2 * editor.scaleY
      ? model.slots.find(slot => alignment.position >= slot.from && alignment.position < slot.to) : undefined;
    let position: number | undefined;
    const slots = direction > 0 ? model.slots : [...model.slots].reverse();
    for (const slot of slots) {
      if (alignedSlot) {
        // One key press advances one JSON value, never a soft-wrapped row
        // inside the value that is already aligned at the top.
        if ((slot.chunkIndex - alignedSlot.chunkIndex) * direction <= 0) continue;
      } else {
        const block = editor.lineBlockAt(slot.from);
        // After a manual scroll, include a partially visible value so its
        // first line is restored before subsequent presses advance onward.
        const top = viewport(editor).top;
        if (direction > 0 ? block.bottom <= top : block.top > top + READING_TOP_INSET) continue;
      }
      const firstCharacter = charactersIn(model, slot)[0];
      if (!firstCharacter) continue;
      position = firstCharacter.position;
      break;
    }
    if (position !== undefined) {
      const token = beginMovement();
      suppressUntil.current = performance.now() + 650;
      scrollToAnchor(editor, position, token, { alignment: 'glyph', rememberReadingAnchor: true });
      return 'moved';
    }
    const nextWindowIndex = adjacentWindowChunk(model, direction);
    if (nextWindowIndex !== null) {
      readingAlignment.current = null;
      navigationPending.current = true;
      current.current.onReadingWindow(nextWindowIndex, direction);
      return 'moved';
    }
    return 'end';
  };

  const moveReading = (direction: ReadingDirection): ReadingMoveResult => {
    if (!view.current || !latestModel.current || latestModel.current !== current.current.model || parked.current) return 'busy';
    if (navigationPending.current || queuedReadingSteps.current.length || readingQueueFrame.current) {
      // Keep every distinct press while the previous value is being measured.
      // Bound the queue so a stuck key cannot keep the reader moving forever.
      if (queuedReadingSteps.current.length < 100) queuedReadingSteps.current.push(direction);
      scheduleQueuedReading();
      return 'moved';
    }
    return advanceReading(direction);
  };

  useLayoutEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: current.current.model.text,
        extensions: [
          lineNumbers(), highlightActiveLineGutter(), foldGutter(), drawSelection(), highlightActiveLine(),
          bracketMatching(), json(), syntaxHighlighting(editorHighlight),
          EditorState.readOnly.of(true), EditorView.editable.of(false), EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': 'JSON 内容', spellcheck: 'false', tabindex: '0' }),
          search({ top: true }), keymap.of([...searchKeymap, ...defaultKeymap]),
          compartment.current.of(editorTheme(current.current.fontSize)),
          readingPresentation.current.of(readingWhitespace(current.current.model)),
          EditorView.updateListener.of(update => {
            if (update.viewportChanged || update.geometryChanged || update.selectionSet) scheduleReport();
          }),
        ],
      }),
    });
    view.current = editor;
    latestModel.current = current.current.model;
    editor.scrollDOM.addEventListener('scroll', scheduleReport, { passive: true });
    return () => {
      movement.current++;
      clearReadingQueue();
      cancelAnimationFrame(frame.current);
      cancelAnimationFrame(navigationFrame.current);
      cancelAnimationFrame(afterMeasureFrame.current);
      window.clearTimeout(boundaryTimer.current);
      editor.scrollDOM.removeEventListener('scroll', scheduleReport);
      editor.destroy();
      view.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const editor = view.current;
    if (!editor) return;
    // Only an explicitly top-aligned continuation carries queued presses into
    // another response window. Other navigation starts a new reading position.
    if (!props.target.alignTop) clearReadingQueue();
    const token = beginMovement();
    suppressUntil.current = performance.now() + 650;
    parked.current = false;
    parkingReturn.current = null;
    parkingZone.current = null;
    if (latestModel.current !== props.model) {
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: props.model.text },
        effects: readingPresentation.current.reconfigure(readingWhitespace(props.model)),
      });
      latestModel.current = props.model;
    }
    const direction = props.target.readingDirection ?? 1;
    const slots = direction > 0 ? props.model.slots : [...props.model.slots].reverse();
    const slot = props.target.alignTop
      ? slots.find(item => (item.chunkIndex - props.target.chunkIndex) * direction >= 0 && charactersIn(props.model, item).length)
      : props.model.slots.find(item => item.chunkIndex === props.target.chunkIndex) ?? props.model.slots[0];
    if (!slot) {
      const nextWindowIndex = adjacentWindowChunk(props.model, direction);
      if (props.target.alignTop && nextWindowIndex !== null) {
        navigationPending.current = true;
        current.current.onReadingWindow(nextWindowIndex, direction);
      } else {
        navigationPending.current = false;
        if (props.target.alignTop) scheduleQueuedReading();
        else { clearReadingQueue(); editor.scrollDOM.scrollTop = 0; }
      }
      return;
    }
    const line = editor.state.doc.line(slot.line);
    if (props.target.mode === 'anchor') {
      scrollToAnchor(editor, line.from, token, { delta: props.target.delta });
    } else {
      const sourceOffset = props.target.alignTop ? slot.sourceStart
        : Math.max(slot.sourceStart, Math.min(slot.sourceEnd, props.target.sourceOffset ?? slot.sourceStart));
      const literal = editor.state.doc.sliceString(slot.from, slot.to);
      const position = props.target.alignTop
        ? charactersIn(props.model, slot)[0]?.position ?? slot.from + 1
        : slot.from + sourceOffsetToJsonOffset(literal, sourceOffset - slot.sourceStart);
      // For a bookmark inside a long block, align its visual row at the top.
      // Adding the usual context margin would reveal earlier prose and cause
      // the next progress report to repeatedly move the bookmark backwards.
      const margin = props.target.alignTop || sourceOffset > slot.sourceStart ? 0 : editor.scrollDOM.clientHeight * 0.26;
      scrollToAnchor(editor, position, token, {
        delta: margin,
        alignment: 'glyph',
        rememberReadingAnchor: props.target.alignTop,
      });
    }
    return () => {
      if (movement.current === token) beginMovement();
    };
  }, [props.model, props.target.key]);

  useEffect(() => {
    view.current?.dispatch({ effects: compartment.current.reconfigure(editorTheme(props.fontSize)) });
  }, [props.fontSize]);

  useImperativeHandle(ref, () => ({
    find: () => { clearReadingQueue(); if (view.current) openSearchPanel(view.current); },
    anchor: getAnchor,
    moveReading,
    cancelReadingSteps: clearReadingQueue,
    park: () => {
      clearReadingQueue();
      const editor = view.current;
      const model = latestModel.current;
      if (!editor || !model || model !== current.current.model || !model.parkingZones.length) return false;
      if (parked.current) return true;
      // Use an unfolded lower bound for the synchronous result. Wrapped lines
      // can only add room; exact parking is checked in the measure phase.
      if (!model.parkingZones.some(zone => (zone.endLine - zone.startLine + 1) * editor.defaultLineHeight > editor.scrollDOM.clientHeight + 70)) return false;
      const { top } = viewport(editor);
      const block = editor.lineBlockAtHeight(Math.max(0, top));
      const folds: { from: number; to: number }[] = [];
      foldedRanges(editor.state).between(0, editor.state.doc.length, (from, to) => { folds.push({ from, to }); });
      parkingReturn.current = {
        model,
        position: block.from,
        delta: block.top - top,
        selection: editor.state.selection.main.head,
        folds,
      };
      beginMovement();
      navigationPending.current = false;
      parked.current = true;
      parkingZone.current = null;
      closeSearchPanel(editor);
      unfoldAll(editor);
      maintainParking();
      return true;
    },
    resume: () => {
      clearReadingQueue();
      const editor = view.current;
      const previous = parkingReturn.current;
      const token = beginMovement();
      parked.current = false;
      parkingZone.current = null;
      if (editor && previous && previous.model === latestModel.current && latestModel.current === current.current.model) {
        suppressUntil.current = performance.now() + 600;
        if (previous.folds.length) editor.dispatch({ effects: previous.folds.map(range => foldEffect.of(range)) });
        scrollToAnchor(editor, previous.position, token, {
          delta: previous.delta,
          selection: previous.selection,
        });
      } else {
        navigationPending.current = false;
        scheduleReport();
      }
      parkingReturn.current = null;
    },
  }));

  return <div ref={host} className="editor-container" data-testid="json-editor" />;
});
