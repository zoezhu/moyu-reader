import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, ArrowRight, Braces, Check, ChevronDown, ChevronRight, CircleHelp, FileJson, Files, Folder, FolderOpen, Info, ListTree, Loader2, MoreHorizontal, PanelBottom, Search, Settings, ShieldCheck, Trash2, Upload, X } from 'lucide-react';
import { JsonEditor, type JsonEditorHandle, type NavigationTarget } from './JsonEditor';
import { PositionIndicator, type PositionIndicatorHandle } from './PositionIndicator';
import { ChapterOutline, ChapterQuickList } from './ChapterLists';
import { Modal } from './Modal';
import { ReaderSettingsPanel } from './ReaderSettingsPanel';
import { chunkBook, buildDocument, findChunkAtOffset, getReadingSections } from './lib/document';
import { importBook } from './lib/importers';
import { deleteBook, getBooks, getProgress, readActiveBook, readSettings, saveBook, saveProgress, writeActiveBook, writeSettings } from './lib/storage';
import { READING_SHORTCUTS, getReadingDirection, readingKeyLabel } from './lib/reading-shortcut';
import { demoBook } from './data/demo';
import templateData from './data/config-template.json';
import type { Book, Chapter, DocumentModel, ReaderSettings, ReadingDirection } from './types';

type ModalName = 'import' | 'settings' | 'quick' | 'help' | null;
type TabName = 'reader' | 'schema' | 'settings';
interface LogEntry { time: string; message: string; warning?: boolean }
const WINDOW_SIZE = 24;
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl';
const formatSize = (size: number) => size < 1024 * 1024 ? Math.max(1, Math.round(size / 1024)) + ' KB' : (size / 1024 / 1024).toFixed(1) + ' MB';

function AliasInput({ book, onSave }: { book: Book; onSave: (book: Book, alias: string) => void }) {
  const [value, setValue] = useState(book.alias);
  useEffect(() => setValue(book.alias), [book.alias]);
  return <input aria-label={'显示名称 ' + book.name} className="text-input alias-input" value={value} maxLength={80} onChange={event => setValue(event.target.value)} onBlur={() => {
    const name = value.trim().replace(/[\\/<>:"|?*]/g, '_');
    if (!name) { setValue(book.alias); return; }
    onSave(book, name.endsWith('.json') ? name : name + '.json');
  }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />;
}

export default function App() {
  const [books, setBooks] = useState<Book[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [activeBookId, setActiveBookId] = useState(demoBook.id);
  const [settings, setSettings] = useState<ReaderSettings>(readSettings);
  const [activeTab, setActiveTab] = useState<TabName>('reader');
  const [modal, setModal] = useState<ModalName>(null);
  const [busy, setBusy] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const [importError, setImportError] = useState('');
  const [importNotice, setImportNotice] = useState('');
  const [toast, setToast] = useState('');
  const [dragging, setDragging] = useState(false);
  const [windowStart, setWindowStart] = useState(0);
  const [sourceOffset, setSourceOffset] = useState(0);
  const [parked, setParked] = useState(false);
  const [query, setQuery] = useState('');
  const [quickSelection, setQuickSelection] = useState(0);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [responsesOpen, setResponsesOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(254);
  const [windowHeight, setWindowHeight] = useState(window.innerHeight);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [navigation, setNavigation] = useState<NavigationTarget>({ key: 0, chunkIndex: 0, mode: 'read' });
  const [history, setHistory] = useState<number[]>([0]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<'output' | 'problems'>('output');
  const [logs, setLogs] = useState<LogEntry[]>([{ time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), message: 'Local workspace ready' }]);
  const editor = useRef<JsonEditorHandle>(null);
  const positionIndicator = useRef<PositionIndicatorHandle>(null);
  const keyboardHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const sourceOffsetRef = useRef(0);
  const readyBook = useRef('');
  const restoreVersion = useRef(0);
  const blockedProgress = useRef(new Set<string>());
  const sequence = useRef(1);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveFailureShown = useRef(false);
  const parkedRef = useRef(false);
  parkedRef.current = parked;
  const allBooks = useMemo(() => [demoBook, ...books], [books]);
  const book = allBooks.find(item => item.id === activeBookId) ?? demoBook;
  const chunks = useMemo(() => chunkBook(book), [book.id, book.text, book.chapters]);
  const sections = useMemo(() => getReadingSections(book, chunks), [book, chunks]);
  // Only explicit navigation chooses a section. Scroll reports update the
  // bookmark, never the chapter that is allowed into this document.
  const currentSection = useMemo(() => sections.find(section => navigation.chunkIndex >= section.startChunk && navigation.chunkIndex < section.endChunk) ?? sections[0], [sections, navigation.chunkIndex]);
  const rangeStart = currentSection?.startChunk ?? 0;
  const rangeEnd = currentSection?.endChunk ?? chunks.length;
  const sourceStart = currentSection?.offset ?? 0;
  const sourceEnd = currentSection?.endOffset ?? book.text.length;
  const desiredGap = Math.max(
    { comfortable: 40, sparse: 60, 'extra-sparse': 90 }[settings.density],
    Math.ceil(Math.max(300, windowHeight - 150) / (settings.fontSize * 1.65) * 1.15) + 6,
  );
  const gapRef = useRef(desiredGap);
  if (!parked) gapRef.current = desiredGap;
  const minimumGap = gapRef.current;
  const readingModel = useMemo(() => buildDocument(book, chunks, { start: windowStart, count: WINDOW_SIZE, rangeStart, rangeEnd, minGapLines: minimumGap, density: settings.density }), [book.id, chunks, windowStart, rangeStart, rangeEnd, minimumGap, settings.density]);
  const auxiliaryModel = useMemo<DocumentModel>(() => ({
    text: JSON.stringify(activeTab === 'settings' ? { editor: { fontSize: settings.fontSize, wordWrap: 'on', readOnly: true }, workspace: { storage: 'local', density: settings.density, outlineLabels: settings.showChapterTitles ? 'title' : 'symbol' } } : templateData.data.list.find(item => item.id === '114761')?.input_schema, null, 2),
    slots: [], parkingZones: [], windowStart: 0, windowEnd: 0, totalChunks: 0,
  }), [activeTab, settings]);
  const model = activeTab === 'reader' ? readingModel : auxiliaryModel;
  const currentChunk = Math.max(rangeStart, Math.min(rangeEnd - 1, findChunkAtOffset(chunks, sourceOffset)));
  const chapterItems = useMemo(() => sections.map((chapter, index) => ({ chapter, index, alias: 'section_' + String(index + 1).padStart(3, '0'), searchTitle: chapter.title.toLocaleLowerCase() })), [sections]);
  const filteredChapters = useMemo(() => {
    const search = query.trim().toLocaleLowerCase().replace(/^@/, '');
    return search ? chapterItems.filter(item => item.alias.includes(search) || String(item.index + 1) === search || item.searchTitle.includes(search)) : chapterItems;
  }, [chapterItems, query]);
  const sidebarVisible = settings.showSidebar && (windowWidth > 680 || mobileSidebarOpen);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4000);
  }, []);
  const log = useCallback((message: string, warning = false) => {
    setLogs(previous => [...previous.slice(-39), { time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), message, warning }]);
  }, []);
  const persistProgress = useCallback((bookId: string, offset: number) => {
    // A pending debounce, pagehide, or old-book cleanup must not recreate a
    // bookmark while its book is being removed or after deletion completes.
    if (blockedProgress.current.has(bookId)) return Promise.resolve();
    return saveProgress({ bookId, sourceOffset: offset, updatedAt: Date.now() });
  }, []);

  useEffect(() => {
    let alive = true;
    getBooks().then(saved => {
      if (!alive) return;
      const ordered = saved.sort((a, b) => b.importedAt - a.importedAt);
      setBooks(ordered);
      const last = readActiveBook();
      if (last && ordered.some(item => item.id === last)) setActiveBookId(last);
      log(ordered.length ? ordered.length + ' local document(s) restored' : 'Sample configuration loaded · 200 template records');
    }).catch(() => {
      notify('浏览器本地存储不可用，导入内容仅在本次会话中保留。');
      log('Persistent storage unavailable; session mode enabled', true);
    }).finally(() => { if (alive) setHydrated(true); });
    return () => { alive = false; };
  }, [log, notify]);

  useEffect(() => {
    if (!hydrated) return;
    let alive = true;
    const version = ++restoreVersion.current;
    const alreadyPositioned = readyBook.current === book.id;
    const currentOffset = sourceOffsetRef.current;
    readyBook.current = '';
    setParked(false);
    setActiveTab('reader');
    const restore = (offset: number) => {
      if (!alive || restoreVersion.current !== version) return;
      const bounded = Math.max(0, Math.min(offset, Math.max(0, book.text.length - 1)));
      const index = Math.max(0, findChunkAtOffset(chunks, bounded));
      sourceOffsetRef.current = bounded;
      setSourceOffset(bounded);
      setWindowStart(Math.max(0, index - 5));
      setNavigation({ key: sequence.current++, chunkIndex: index, sourceOffset: bounded, mode: 'read' });
      setHistory([bounded]);
      setHistoryIndex(0);
      readyBook.current = book.id;
      writeActiveBook(book.id);
    };
    if (alreadyPositioned) restore(currentOffset);
    else getProgress(book.id).then(progress => restore(progress?.sourceOffset ?? 0)).catch(() => restore(0));
    return () => {
      alive = false;
      if (readyBook.current === book.id) {
        void persistProgress(book.id, sourceOffsetRef.current).catch(() => {});
      }
    };
  }, [book.id, chunks, hydrated, persistProgress]);

  useEffect(() => {
    if (readyBook.current !== book.id) return;
    const pending = setTimeout(() => {
      persistProgress(book.id, sourceOffset).catch(() => {
        if (!saveFailureShown.current) { saveFailureShown.current = true; log('Position could not be saved locally', true); }
      });
    }, 450);
    return () => clearTimeout(pending);
  }, [book.id, sourceOffset, log, persistProgress]);

  useEffect(() => {
    // Also applies the layout migration when the development page hot-reloads.
    const restored = readSettings();
    setSettings(previous => JSON.stringify(previous) === JSON.stringify(restored) ? previous : restored);
  }, []);

  useEffect(() => {
    if (!writeSettings(settings)) log('Settings are available for this session only', true);
  }, [settings, log]);
  useEffect(() => {
    const flush = () => {
      if (readyBook.current === book.id) void persistProgress(book.id, sourceOffsetRef.current).catch(() => {});
    };
    const visibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [book.id, persistProgress]);
  useEffect(() => {
    const resize = () => {
      const anchor = parkedRef.current ? null : editor.current?.anchor();
      if (anchor) setNavigation({ key: sequence.current++, chunkIndex: anchor.chunkIndex, mode: 'anchor', delta: anchor.delta });
      setWindowHeight(window.innerHeight);
      setWindowWidth(window.innerWidth);
    };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const moveTo = useCallback((offset: number, remember = true, alignTop = false, readingDirection: ReadingDirection = 1) => {
    // Explicit navigation wins over any earlier asynchronous bookmark read.
    restoreVersion.current++;
    readyBook.current = book.id;
    writeActiveBook(book.id);
    const index = Math.max(0, findChunkAtOffset(chunks, offset));
    if (remember) {
      const previous = history.slice(0, historyIndex + 1);
      if (previous.at(-1) !== sourceOffsetRef.current) previous.push(sourceOffsetRef.current);
      if (previous.at(-1) !== offset) previous.push(offset);
      setHistory(previous);
      setHistoryIndex(previous.length - 1);
    }
    setParked(false);
    setActiveTab('reader');
    if (index < readingModel.windowStart || index >= readingModel.windowEnd) setWindowStart(Math.max(0, index - (readingDirection < 0 ? 18 : 5)));
    sourceOffsetRef.current = offset;
    setSourceOffset(offset);
    setNavigation({ key: sequence.current++, chunkIndex: index, sourceOffset: offset, mode: 'read', alignTop, readingDirection });
  }, [book.id, chunks, history, historyIndex, readingModel.windowStart, readingModel.windowEnd]);
  const goHistory = (direction: ReadingDirection) => {
    const next = historyIndex + direction;
    if (next < 0 || next >= history.length) return;
    setHistoryIndex(next);
    moveTo(history[next], false);
  };
  const jumpChapter = useCallback((chapter: Chapter) => { setModal(null); setMobileSidebarOpen(false); moveTo(chapter.offset); }, [moveTo]);
  const nextContent = (direction: ReadingDirection) => {
    if (!chunks.length) return;
    const next = Math.max(rangeStart, Math.min(rangeEnd - 1, currentChunk + direction));
    if (next !== currentChunk) moveTo(chunks[next].start);
    else notify(currentSection
      ? (direction > 0 ? '已到当前章节末尾' : '已到当前章节开头') + '，可从大纲选择其他章节'
      : direction > 0 ? '已到文件末尾' : '已到文件开头');
  };
  const changeSettings = (update: Partial<ReaderSettings>) => {
    if (parked) editor.current?.resume();
    // Changes in padding or wrapped line height invalidate pixel anchors.
    // Keep the same original text slice in view instead.
    setNavigation({ key: sequence.current++, chunkIndex: currentChunk, sourceOffset: sourceOffsetRef.current, mode: 'read' });
    setParked(false);
    setSettings(previous => ({ ...previous, ...update }));
  };
  const toggleParking = () => {
    if (activeTab !== 'reader') { setActiveTab('reader'); setNavigation({ key: sequence.current++, chunkIndex: currentChunk, sourceOffset: sourceOffsetRef.current, mode: 'read' }); return; }
    if (parked) {
      editor.current?.resume();
      if (gapRef.current !== desiredGap) setNavigation({ key: sequence.current++, chunkIndex: currentChunk, sourceOffset: sourceOffsetRef.current, mode: 'read' });
      setParked(false);
    }
    else if (editor.current?.park()) setParked(true);
  };
  const toggleSidebar = () => {
    if (windowWidth <= 680) {
      if (!settings.showSidebar) changeSettings({ showSidebar: true });
      setMobileSidebarOpen(previous => !previous);
    } else changeSettings({ showSidebar: !settings.showSidebar });
  };
  const openQuick = useCallback(() => {
    if (!sections.length) { editor.current?.find(); return; }
    setQuery(''); setQuickSelection(0); setModal('quick');
  }, [sections]);
  const openImport = () => { setImportError(''); setImportNotice(''); setModal('import'); };
  const moveReading = (direction: ReadingDirection) => {
    if (activeTab !== 'reader') return;
    if (parked) { toggleParking(); return; }
    if (editor.current?.moveReading(direction) === 'end') {
      notify(currentSection
        ? direction > 0 ? '已到当前章节末尾，可从大纲选择下一章' : '已到当前章节开头，可从大纲选择上一章'
        : direction > 0 ? '已到文件末尾' : '已到文件开头');
    }
  };

  keyboardHandler.current = (event: KeyboardEvent) => {
    if (modal) return;
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (event.isComposing) return;

    const readingDirection = getReadingDirection(event, settings);
    if (activeTab === 'reader' && readingDirection !== null) {
      // A configured Space key must still activate focused buttons normally.
      if (event.key === ' ' && target instanceof Element && target.closest('button, a[href], [role="button"]')) return;
      event.preventDefault();
      if (!event.repeat) moveReading(readingDirection);
      return;
    }

    const command = event.metaKey || event.ctrlKey;
    if (command && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      if (event.shiftKey) openQuick(); else openImport();
    } else if (command && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      editor.current?.find();
    } else if (event.key === 'F8' || event.key === 'Escape') {
      event.preventDefault();
      toggleParking();
    } else if (event.altKey && event.key === 'ArrowDown') {
      event.preventDefault();
      nextContent(1);
    } else if (event.altKey && event.key === 'ArrowUp') {
      event.preventDefault();
      nextContent(-1);
    } else if (command && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      toggleSidebar();
    }
  };
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => keyboardHandler.current(event);
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, []);
  useEffect(() => {
    if (modal || activeTab !== 'reader') editor.current?.cancelReadingSteps();
  }, [modal, activeTab]);

  const handleFiles = async (files: FileList | File[]) => {
    if (busy || !files.length) return;
    setModal('import'); setBusy(true); setImportError(''); setImportNotice('');
    let last: Book | undefined;
    const failures: string[] = [];
    try {
      for (const file of Array.from(files)) {
        setImportMessage('正在读取 ' + file.name);
        try {
          const imported = await importBook(file, message => setImportMessage(message));
          try { await saveBook(imported); }
          catch { imported.warnings.push('本地保存失败，此文件仅在本次会话可用。'); }
          setBooks(previous => [imported, ...previous]);
          log(imported.alias + ' loaded · ' + imported.chapters.length + ' symbols');
          for (const warning of imported.warnings) log(warning, true);
          last = imported;
        } catch (error) {
          failures.push(file.name + '：' + (error instanceof Error ? error.message : '无法读取此文件'));
          log('Document import failed (' + file.name.split('.').at(-1) + ')', true);
        }
      }
      if (last) {
        setActiveBookId(last.id);
        setActiveTab('reader');
        notify('已导入，可以开始浏览');
      }
      if (failures.length) setImportError(failures.join('\n'));
      else if (last?.warnings.length) setImportNotice(last.warnings.join('\n'));
      else setModal(null);
    } finally {
      setBusy(false); setImportMessage('');
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const removeBook = async (id: string) => {
    if (blockedProgress.current.has(id)) return;
    blockedProgress.current.add(id);
    try { await deleteBook(id); }
    catch {
      blockedProgress.current.delete(id);
      if (readyBook.current === id) void persistProgress(id, sourceOffsetRef.current).catch(() => {});
      notify('无法移除本地副本，请重试'); return;
    }
    setBooks(previous => previous.filter(item => item.id !== id));
    setActiveBookId(previous => previous === id ? demoBook.id : previous);
    setPendingDelete(null);
  };
  const renameBook = async (item: Book, alias: string) => {
    if (alias === item.alias) return;
    const updated = { ...item, alias };
    try { await saveBook(updated); setBooks(previous => previous.map(existing => existing.id === item.id ? updated : existing)); }
    catch { notify('显示名称保存失败'); }
  };
  const onPosition = useCallback((nextLine: number, offset: number | null) => {
    positionIndicator.current?.update(nextLine);
    if (offset !== null && readyBook.current === book.id) {
      // A final string's closing quote can map to its exclusive source end.
      // Keep the bookmark inside this section so reopening cannot enter the next.
      const bounded = Math.max(sourceStart, Math.min(offset, Math.max(sourceStart, sourceEnd - 1)));
      sourceOffsetRef.current = bounded;
      setSourceOffset(previous => previous === bounded ? previous : bounded);
    }
  }, [book.id, sourceStart, sourceEnd]);
  const onBoundary = (direction: ReadingDirection) => {
    if (activeTab !== 'reader') return;
    const nextChunk = direction > 0 ? readingModel.windowEnd : readingModel.windowStart - 1;
    if (nextChunk < rangeStart || nextChunk >= rangeEnd) return;
    // Boundary padding is window-specific. Resume at the first new text slice
    // rather than carrying a pixel offset across differently sized padding.
    setWindowStart(Math.max(rangeStart, nextChunk - (direction > 0 ? 5 : 18)));
    setNavigation({ key: sequence.current++, chunkIndex: nextChunk, mode: 'read' });
  };
  const onReadingWindow = (index: number, direction: ReadingDirection) => {
    if (activeTab !== 'reader' || index < rangeStart || index >= rangeEnd) return;
    moveTo(chunks[index].start, false, true, direction);
  };
  const startSidebarResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = event.clientX;
    const width = sidebarWidth;
    event.currentTarget.setPointerCapture(event.pointerId);
    const element = event.currentTarget;
    const move = (next: PointerEvent) => setSidebarWidth(Math.max(200, Math.min(420, width + next.clientX - start)));
    const up = () => { element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', up); };
    element.addEventListener('pointermove', move); element.addEventListener('pointerup', up);
  };
  const openAuxiliary = (tab: TabName) => {
    setActiveTab(tab); setParked(false);
    if (tab === 'reader') setNavigation({ key: sequence.current++, chunkIndex: currentChunk, sourceOffset: sourceOffsetRef.current, mode: 'read' });
  };
  const problems = logs.filter(entry => entry.warning);

  return <div className={'workbench' + (sidebarVisible ? '' : ' sidebar-hidden') + (windowWidth <= 680 ? ' mobile-layout' : '')} style={{ '--sidebar-width': sidebarWidth + 'px' } as CSSProperties}
    onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; setDragging(true); } }}
    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
    onDragLeave={event => { if (event.dataTransfer.types.includes('Files')) { dragDepth.current--; if (dragDepth.current <= 0) setDragging(false); } }}
    onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); if (event.dataTransfer.files.length) void handleFiles(event.dataTransfer.files); }}>
    <input className="sr-only" tabIndex={-1} type="file" multiple accept=".txt,.epub,.pdf" ref={fileInput} onChange={event => { if (event.target.files) void handleFiles(event.target.files); }} aria-label="选择本地文件" />
    <header className="titlebar">
      <span className="brand-mark"><Braces size={20} /></span><span className="workspace-title">JSON WORKBENCH</span>
      <div className="titlebar-history"><button className="icon-button" onClick={() => goHistory(-1)} disabled={historyIndex === 0} title="后退" aria-label="后退"><ArrowLeft size={17} /></button><button className="icon-button" onClick={() => goHistory(1)} disabled={historyIndex >= history.length - 1} title="前进" aria-label="前进"><ArrowRight size={17} /></button></div>
      <button className="command-button" onClick={openQuick} aria-label="搜索章节或符号"><Search size={14} /><span>搜索文件中的符号</span><span className="kbd">{mod} ⇧ O</span></button>
      <div className="titlebar-actions"><button className="import-button" onClick={openImport}><Upload size={14} />导入</button><button className="icon-button" onClick={() => setModal('settings')} title="设置" aria-label="打开设置"><MoreHorizontal size={18} /></button></div>
    </header>
    <nav className="activitybar" aria-label="工作区导航">
      <button className={'activity-button' + (sidebarVisible ? ' active' : '')} title="资源管理器" aria-label="切换资源管理器" onClick={toggleSidebar}><Files size={22} /></button>
      <button className="activity-button" title={'查找 ' + mod + ' F'} aria-label="查找文本" onClick={() => editor.current?.find()}><Search size={22} /></button>
      {sections.length > 0 && <button className="activity-button" title="转到符号" aria-label="定位章节" onClick={openQuick}><ListTree size={22} /></button>}
      <div className="activity-spacer" />
      <button className="activity-button" title="使用说明" aria-label="使用说明" onClick={() => setModal('help')}><CircleHelp size={21} /></button>
      <button className="activity-button" title="设置" aria-label="设置" onClick={() => setModal('settings')}><Settings size={21} /></button>
    </nav>
    <aside className="sidebar" aria-label="资源管理器">
      <div className="sidebar-heading"><span>资源管理器</span><button className="icon-button" title="管理本地文件" aria-label="管理本地文件" onClick={openImport}><MoreHorizontal size={17} /></button></div>
      <div className="sidebar-scroll">
        <div className="workspace-heading"><ChevronDown size={15} /><span>API-CONFIG</span><span className="workspace-badge">LOCAL</span></div>
        <div className="tree">
          <button className="tree-row" onClick={() => setConfigOpen(!configOpen)}>{configOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<Folder size={15} className="muted" /><span>config</span></button>
          {configOpen && <><button className={'tree-row indent-2' + (activeTab === 'schema' ? ' active' : '')} onClick={() => openAuxiliary('schema')}><Braces size={15} className="yellow" /><span className="tree-label">schema.json</span></button><button className={'tree-row indent-2' + (activeTab === 'settings' ? ' active' : '')} onClick={() => openAuxiliary('settings')}><Braces size={15} className="yellow" /><span className="tree-label">settings.json</span></button></>}
          <button className="tree-row" onClick={() => setResponsesOpen(!responsesOpen)}>{responsesOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<FolderOpen size={15} className="muted" /><span>responses</span><span className="tree-count">{allBooks.length}</span></button>
          {responsesOpen && allBooks.map(item => <button key={item.id} className={'tree-row indent-2' + (item.id === activeBookId && activeTab === 'reader' ? ' active' : '')} title={item.alias} onClick={() => { setActiveBookId(item.id); openAuxiliary('reader'); setMobileSidebarOpen(false); }}><Braces size={15} className="yellow" /><span className="tree-label">{item.alias}</span>{item.id === demoBook.id && <span className="demo-label">示例</span>}</button>)}
          <button className="tree-row indent" onClick={() => setModal('settings')}><Settings size={14} className="muted" /><span>workspace.settings</span></button>
        </div>
      </div>
      {sections.length > 0 && <section className="outline-panel">
        <div className="panel-heading"><button className="outline-heading-button" onClick={() => setOutlineOpen(!outlineOpen)}>{outlineOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<span>大纲</span><span className="outline-count">{sections.length}</span></button><div><button className="icon-button" title="搜索章节" aria-label="搜索章节" onClick={openQuick}><Search size={15} /></button><button className="icon-button" title={settings.showChapterTitles ? '切换为编号显示' : '切换为原始标题'} aria-label="切换章节标题显示" onClick={() => changeSettings({ showChapterTitles: !settings.showChapterTitles })}><MoreHorizontal size={17} /></button></div></div>
        {outlineOpen && <ChapterOutline sections={sections} slots={readingModel.slots} activeId={currentSection?.id} showTitles={settings.showChapterTitles} onSelect={jumpChapter} />}
      </section>}
      <div className="sidebar-bottom"><ShieldCheck size={13} /><span>本地文件 · 浏览器存储</span></div>
      <div className="sidebar-resizer" onPointerDown={startSidebarResize} role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" />
    </aside>
    {windowWidth <= 680 && sidebarVisible && <button className="sidebar-dismiss" aria-label="收起资源管理器" onClick={() => setMobileSidebarOpen(false)} />}
    <main className="editor-column">
      <div className="file-tabs" role="tablist" aria-label="打开的文件">
        <button className={'file-tab' + (activeTab === 'reader' ? ' active' : '')} role="tab" aria-selected={activeTab === 'reader'} onClick={() => openAuxiliary('reader')}><Braces size={15} className="yellow" /><span className="tab-label">{book.alias}</span><span className="tab-dot" /></button>
        <button className={'file-tab' + (activeTab === 'schema' ? ' active' : '')} role="tab" aria-selected={activeTab === 'schema'} onClick={() => openAuxiliary('schema')}><Braces size={15} className="yellow" /><span>schema.json</span></button>
        <button className={'file-tab' + (activeTab === 'settings' ? ' active' : '')} role="tab" aria-selected={activeTab === 'settings'} onClick={() => openAuxiliary('settings')}><Braces size={15} className="yellow" /><span>settings.json</span></button>
        <div className="spacer" /><button className="icon-button tabs-action" aria-label="切换输出面板" title="切换输出面板" onClick={() => changeSettings({ showOutput: !settings.showOutput })}><PanelBottom size={16} /></button>
      </div>
      <div className="breadcrumbs"><span>responses</span><ChevronRight size={13} /><Braces size={13} className="yellow" /><span className="breadcrumb-file">{activeTab === 'reader' ? book.alias : activeTab + '.json'}</span>{activeTab === 'reader' && <><ChevronRight size={13} /><span>data</span><ChevronRight size={13} /><span>list</span><ChevronRight size={13} /><span className="muted">{currentChunk}</span></>}<span className="spacer" /><span className="breadcrumb-readonly">只读</span></div>
      <JsonEditor ref={editor} model={model} fontSize={settings.fontSize} target={navigation} onPosition={onPosition} onBoundary={onBoundary} onReadingWindow={onReadingWindow} />
      {settings.showOutput && <section className="bottom-panel">
        <div className="panel-tabs"><button className={'panel-tab' + (panelTab === 'problems' ? ' active' : '')} onClick={() => setPanelTab('problems')}>问题{problems.length > 0 && <span className="problem-count">{problems.length}</span>}</button><button className={'panel-tab' + (panelTab === 'output' ? ' active' : '')} onClick={() => setPanelTab('output')}>输出</button><span className="spacer" /><span className="panel-source">JSON Workbench</span><button className="icon-button" aria-label="清空输出" title="清空输出" onClick={() => setLogs([])}><Trash2 size={13} /></button><button className="icon-button" aria-label="关闭输出面板" onClick={() => changeSettings({ showOutput: false })}><X size={15} /></button></div>
        <div className="panel-body" role="log">{(panelTab === 'output' ? logs.slice(-4) : problems).map((entry, index) => <div className="log-line" key={index}><span className="log-time">{entry.time}</span><span className={'log-level' + (entry.warning ? ' log-warning' : '')}>{entry.warning ? '[warn]' : '[info]'}</span><span>{entry.message}</span></div>)}{panelTab === 'problems' && !problems.length && <div className="log-line muted">未检测到问题。</div>}</div>
      </section>}
    </main>
    <footer className="statusbar">
      <div className="status-group"><span className="status-local"><Braces size={13} /></span><span className="status-item">本地工作区</span><span className="status-item"><Check size={12} />就绪</span></div>
      <div className="status-group"><button className="status-item" title={parked ? '返回原定位 (F8)' : '定位到纯配置区域 (F8)'} aria-label={parked ? '返回阅读位置' : '定位纯配置区域'} onClick={toggleParking}><ShieldCheck size={13} /></button><PositionIndicator ref={positionIndicator} onLocate={openQuick} /><button className="status-item" onClick={() => setModal('settings')}>空格: 2</button><span className="status-item">UTF-8</span><span className="status-item">LF</span><span className="status-item">JSON</span><span className="status-item">只读</span></div>
    </footer>

    {modal === 'import' && <Modal title="导入本地文件" onClose={() => { if (!busy) setModal(null); }} footer={<><span className="muted import-footer-note"><ShieldCheck size={14} /> 文件仅在当前浏览器处理</span><span className="spacer" /><button className="button subtle" onClick={() => setModal(null)} disabled={busy}>完成</button></>}>
      <div className="modal-content">
        <button className="import-zone" onClick={() => fileInput.current?.click()} disabled={busy} data-autofocus>
          {busy ? <Loader2 size={29} className="spin" /> : <Upload size={29} />}
          <strong>{busy ? '正在解析文件' : '选择文件，或拖放到这里'}</strong>
          <span>{busy ? importMessage : '正文保持原样，自动识别可用章节'}</span>
          {!busy && <div className="format-chips"><span className="format-chip">TXT</span><span className="format-chip">EPUB</span><span className="format-chip">PDF</span><span className="format-note">最大 100 MB / 文件</span></div>}
        </button>
        {busy && <div className="import-progress" aria-live="polite"><div className="progress-track"><div className="progress-bar" /></div><span>{importMessage}</span></div>}
        {importError && <div className="error-message" role="alert"><Info size={16} /><span style={{ whiteSpace: 'pre-line' }}>{importError}</span></div>}
        {importNotice && <div className="info-message" role="status"><Info size={16} /><span style={{ whiteSpace: 'pre-line' }}>{importNotice}</span></div>}
        <p className="field-hint">PDF 支持提取已有文字；扫描版需先完成 OCR。书名只在此管理窗口显示，工作区使用 JSON 别名。</p>
        <div className="library-heading"><span>本地文件</span><span className="muted">{books.length} 个</span></div>
        {books.length ? <div className="library-list">{books.map(item => <div className="library-row" key={item.id}>
          <FileJson size={22} className="muted" /><div className="library-detail"><div className="library-name">{item.name}</div><div className="library-meta">{item.format.toUpperCase()} · {formatSize(item.size)} · {item.chapters.length ? item.chapters.length + ' 个章节' : '无章节目录'}</div><AliasInput book={item} onSave={renameBook} /></div>
          <div className="library-actions">{pendingDelete === item.id ? <><button className="button danger" onClick={() => void removeBook(item.id)}>移除副本</button><button className="button subtle" onClick={() => setPendingDelete(null)}>取消</button></> : <><button className="button subtle" onClick={() => { setActiveBookId(item.id); setModal(null); }}>打开</button><button className="icon-button" aria-label={'移除 ' + item.name} onClick={() => setPendingDelete(item.id)}><Trash2 size={15} /></button></>}</div>
        </div>)}</div> : <div className="library-empty"><Files size={21} /><span>还没有导入文件。当前工作区展示的是内置示例。</span></div>}
      </div>
    </Modal>}

    {modal === 'quick' && <Modal title="转到符号" className="quick-picker" onClose={() => setModal(null)} footer={<div className="quick-footer"><span><span className="kbd">↑ ↓</span> 选择</span><span><span className="kbd">Enter</span> 定位</span><span><span className="kbd">Esc</span> 关闭</span></div>}>
      <div className="quick-search"><Search size={18} /><input data-autofocus aria-label="搜索章节名称或编号" placeholder="输入章节编号或原始标题…" value={query} onChange={event => { setQuery(event.target.value); setQuickSelection(0); }} onKeyDown={event => {
        if (event.key === 'ArrowDown') { event.preventDefault(); setQuickSelection(previous => Math.min(Math.max(0, filteredChapters.length - 1), previous + 1)); }
        if (event.key === 'ArrowUp') { event.preventDefault(); setQuickSelection(previous => Math.max(0, previous - 1)); }
        if (!query && event.key === 'Home') { event.preventDefault(); setQuickSelection(0); }
        if (!query && event.key === 'End') { event.preventDefault(); setQuickSelection(Math.max(0, filteredChapters.length - 1)); }
        if (event.key === 'Enter' && filteredChapters[quickSelection]) { event.preventDefault(); jumpChapter(filteredChapters[quickSelection].chapter); }
      }} /></div>
      <ChapterQuickList items={filteredChapters} selectedIndex={quickSelection} total={sections.length} onSelect={jumpChapter} onSelectionChange={setQuickSelection} />
    </Modal>}

    {modal === 'settings' && (
      <Modal
        title="工作区设置"
        onClose={() => setModal(null)}
        footer={<>
          <span className="muted">设置自动保存在此浏览器</span>
          <span className="spacer" />
          <button className="button primary" onClick={() => setModal(null)}>完成</button>
        </>}
      >
        <ReaderSettingsPanel
          settings={settings}
          onChange={changeSettings}
          onShortcutChange={update => setSettings(previous => ({ ...previous, ...update }))}
          notify={notify}
          onHelp={() => setModal('help')}
        />
      </Modal>
    )}

    {modal === 'help' && <Modal title="工作区使用说明" onClose={() => setModal(null)}>
      <div className="modal-content"><p className="modal-description">导入本地文本后，原文会按顺序分散到 JSON 配置中的 default 字段。段落之间的参数、枚举和运行配置来自配置模板，全文不作改写。</p>
        <div className="shortcuts-grid help-shortcuts">
          {READING_SHORTCUTS.map(shortcut => (
            <Fragment key={shortcut.key}>
              <span>{shortcut.target}正文，第一行贴齐顶部</span>
              <span className="kbd">{readingKeyLabel(settings[shortcut.key])}</span>
            </Fragment>
          ))}
          <span>导入文件</span><span className="kbd">{mod} O</span>
          <span>搜索章节 / 转到符号</span><span className="kbd">{mod} ⇧ O</span>
          <span>查找当前响应中的文本</span><span className="kbd">{mod} F</span>
          <span>纯配置区域 / 返回原位置</span><span className="kbd">F8 / Esc</span>
          <span>章内下一个原文片段</span><span className="kbd">Alt ↓</span>
          <span>章内上一个原文片段</span><span className="kbd">Alt ↑</span>
          <span>切换侧栏</span><span className="kbd">{mod} B</span>
        </div>
        <div className="info-message"><Info size={16} /><span>每个章节独立显示，滚到章首或章尾都不会切章，请通过大纲或章节搜索主动切换。长章节会在本章内随滚动加载；无目录的文件保持连续浏览。正文、进度和显示名称保存在此浏览器中，清除网站数据会移除这些本地副本。浏览器占用某些快捷键时，可使用界面按钮。</span></div>
      </div>
    </Modal>}
    {dragging && <div className="drop-overlay"><Upload size={42} /><h2>松开以导入本地文件</h2><p>TXT · EPUB · PDF</p></div>}
    {toast && <div className="toast" role="status"><Check size={16} /><span>{toast}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setToast('')}><X size={14} /></button></div>}
  </div>;
}
