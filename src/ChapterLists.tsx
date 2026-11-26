import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Braces } from 'lucide-react';
import type { ReadingSection, ReadingSlot } from './types';

const FULL_LIST_LIMIT = 80;
const OVERSCAN = 5;
const OUTLINE_ROW_HEIGHT = 29;
const QUICK_ROW_HEIGHT = 59;

/** Keep scroll state local: scrolling a chapter list never rerenders the reader. */
function useRows(count: number, rowHeight: number, paddingTop: number, paddingBottom: number, revealIndex: number, contentKey: unknown) {
  const container = useRef<HTMLDivElement>(null);
  const pendingReveal = useRef<number | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 0 });
  const measure = useCallback(() => {
    const node = container.current;
    if (!node) return;
    const height = node.clientHeight;
    let top = node.scrollTop;
    if (height > 0) {
      const maximum = Math.max(0, paddingTop + count * rowHeight + paddingBottom - height);
      top = Math.max(0, Math.min(top, maximum));
      const index = pendingReveal.current;
      if (index !== null && index >= 0 && index < count) {
        const itemTop = paddingTop + index * rowHeight;
        const itemBottom = itemTop + rowHeight;
        if (itemTop < top) top = itemTop;
        else if (itemBottom > top + height) top = itemBottom - height;
        top = Math.max(0, Math.min(top, maximum));
      }
      pendingReveal.current = null;
      if (node.scrollTop !== top) node.scrollTop = top;
    }
    setViewport(previous => previous.top === top && previous.height === height ? previous : { top, height });
  }, [count, rowHeight, paddingTop, paddingBottom]);

  const reveal = useCallback((index: number) => {
    pendingReveal.current = index;
    measure();
  }, [measure]);

  useLayoutEffect(() => {
    const node = container.current;
    if (!node) return;
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  useLayoutEffect(() => { reveal(revealIndex); }, [reveal, revealIndex, contentKey]);

  const onScroll = useCallback(() => {
    // A manual scroll is intentional; subsequent resize measurements must not
    // keep pulling the list back to an earlier active/selected chapter.
    pendingReveal.current = null;
    measure();
  }, [measure]);
  const height = viewport.height || 300;
  const visibleStart = Math.max(0, Math.min(Math.max(0, count - 1), Math.floor((viewport.top - paddingTop) / rowHeight)));
  const visibleEnd = Math.max(visibleStart + 1, Math.min(count, Math.ceil((viewport.top + height - paddingTop) / rowHeight)));
  const virtual = count > FULL_LIST_LIMIT;
  const start = virtual ? Math.max(0, visibleStart - OVERSCAN) : 0;
  const end = virtual ? Math.min(count, visibleEnd + OVERSCAN) : count;
  return { container, onScroll, reveal, start, end, visibleStart, visibleEnd, topSpace: start * rowHeight, bottomSpace: (count - end) * rowHeight };
}

export interface ChapterOutlineProps {
  sections: ReadingSection[];
  slots: ReadingSlot[];
  activeId?: string;
  showTitles: boolean;
  onSelect: (chapter: ReadingSection) => void;
}

export const ChapterOutline = memo(function ChapterOutline({ sections, slots, activeId, showTitles, onSelect }: ChapterOutlineProps) {
  const activeIndex = useMemo(() => Math.max(0, sections.findIndex(section => section.id === activeId)), [sections, activeId]);
  const lines = useMemo(() => new Map(slots.map(slot => [slot.chunkIndex, slot.line])), [slots]);
  const rows = useRows(sections.length, OUTLINE_ROW_HEIGHT, 4, 10, activeIndex, sections);
  const [focusIndex, setFocusIndex] = useState(activeIndex);
  const pendingFocus = useRef<number | null>(null);
  useLayoutEffect(() => { setFocusIndex(activeIndex); }, [activeIndex, sections]);
  useLayoutEffect(() => {
    if (pendingFocus.current === null) return;
    const button = rows.container.current?.querySelector<HTMLButtonElement>(`[data-chapter-index="${pendingFocus.current}"]`);
    if (button) { pendingFocus.current = null; button.focus({ preventScroll: true }); }
  }, [focusIndex, rows.start, rows.end, rows.container]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-chapter-index]');
    if (!button || !sections.length) return;
    const index = Number(button.dataset.chapterIndex);
    const next = event.key === 'ArrowDown' ? Math.min(sections.length - 1, index + 1)
      : event.key === 'ArrowUp' ? Math.max(0, index - 1)
        : event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    pendingFocus.current = next;
    rows.reveal(next);
    setFocusIndex(next);
  };
  const tabIndex = focusIndex >= rows.visibleStart && focusIndex < rows.visibleEnd ? focusIndex : rows.visibleStart;
  return <div className="outline-list" ref={rows.container} onScroll={rows.onScroll} onKeyDown={onKeyDown}>
    {rows.topSpace > 0 && <div className="chapter-list-spacer" style={{ height: rows.topSpace }} aria-hidden="true" />}
    {sections.slice(rows.start, rows.end).map((chapter, relativeIndex) => {
      const index = rows.start + relativeIndex;
      const line = lines.get(chapter.startChunk);
      return <button key={chapter.id} data-chapter-index={index} tabIndex={index === tabIndex ? 0 : -1}
        aria-current={chapter.id === activeId ? 'true' : undefined} className={'outline-row' + (chapter.id === activeId ? ' active' : '')}
        style={{ paddingLeft: 16 + Math.min(3, chapter.level) * 10 }} onFocus={() => setFocusIndex(index)} onClick={() => onSelect(chapter)}>
        <Braces size={13} className="purple" /><span className="outline-label">{showTitles ? chapter.title : 'section_' + String(index + 1).padStart(3, '0')}</span>
        {line !== undefined && <span className="outline-position">L {line}</span>}
      </button>;
    })}
    {rows.bottomSpace > 0 && <div className="chapter-list-spacer" style={{ height: rows.bottomSpace }} aria-hidden="true" />}
  </div>;
});

export interface ChapterQuickItem { chapter: ReadingSection; index: number; alias: string }
export interface ChapterQuickListProps {
  items: ChapterQuickItem[];
  selectedIndex: number;
  total: number;
  onSelect: (chapter: ReadingSection) => void;
  onSelectionChange: (index: number) => void;
}

export const ChapterQuickList = memo(function ChapterQuickList({ items, selectedIndex, total, onSelect, onSelectionChange }: ChapterQuickListProps) {
  const selected = Math.max(0, Math.min(items.length - 1, selectedIndex));
  const rows = useRows(items.length, QUICK_ROW_HEIGHT, 3, 8, selected, items);
  const pendingFocus = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pendingFocus.current === null) return;
    const button = rows.container.current?.querySelector<HTMLButtonElement>(`[data-result-index="${pendingFocus.current}"]`);
    if (button) { pendingFocus.current = null; button.focus({ preventScroll: true }); }
  }, [selected, rows.start, rows.end, rows.container]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-result-index]');
    if (!button || !items.length) return;
    const index = Number(button.dataset.resultIndex);
    const next = event.key === 'ArrowDown' ? Math.min(items.length - 1, index + 1)
      : event.key === 'ArrowUp' ? Math.max(0, index - 1)
        : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    pendingFocus.current = next;
    rows.reveal(next);
    onSelectionChange(next);
  };
  const tabIndex = selected >= rows.visibleStart && selected < rows.visibleEnd ? selected : rows.visibleStart;
  return <div className="quick-list" role="listbox" aria-label="章节" ref={rows.container} onScroll={rows.onScroll} onKeyDown={onKeyDown}>
    {rows.topSpace > 0 && <div className="chapter-list-spacer" style={{ height: rows.topSpace }} aria-hidden="true" />}
    {items.slice(rows.start, rows.end).map((item, relativeIndex) => {
      const index = rows.start + relativeIndex;
      return <button role="option" data-result-index={index} aria-selected={index === selected} aria-posinset={index + 1} aria-setsize={items.length}
        tabIndex={index === tabIndex ? 0 : -1} className={'quick-item' + (index === selected ? ' selected' : '')}
        key={item.chapter.id} onClick={() => onSelect(item.chapter)}>
        <Braces size={16} className="purple" /><span className="quick-item-title"><span className="quick-item-label">{item.chapter.title}</span><span className="quick-item-meta">{item.alias}</span></span>
        <span className="quick-item-meta">{item.index + 1} / {total}</span>
      </button>;
    })}
    {rows.bottomSpace > 0 && <div className="chapter-list-spacer" style={{ height: rows.bottomSpace }} aria-hidden="true" />}
    {!items.length && <div className="quick-empty">没有匹配的章节</div>}
  </div>;
});
