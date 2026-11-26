export type BookFormat = 'txt' | 'epub' | 'pdf';
export type ReadingDirection = -1 | 1;
export type DisplayFormat = 'json' | 'markdown' | 'log' | 'python' | 'sql' | 'yaml' | 'xml' | 'html' | 'dataset' | 'notebook' | 'tests' | 'http';
export type ReadingEncoding = 'json' | 'raw' | 'sql' | 'xml' | 'csv';

export interface Chapter {
  id: string;
  title: string;
  offset: number;
  level: number;
}

/** A non-overlapping chapter view; chunk indices remain relative to the whole book. */
export interface ReadingSection extends Chapter {
  startChunk: number;
  endChunk: number;
  endOffset: number;
}

export interface Book {
  id: string;
  name: string;
  alias: string;
  format: BookFormat;
  text: string;
  chapters: Chapter[];
  importedAt: number;
  size: number;
  warnings: string[];
}

export interface ReadingProgress {
  bookId: string;
  sourceOffset: number;
  updatedAt: number;
}

export interface ReaderSettings {
  displayFormat: DisplayFormat;
  fontSize: number;
  readingKey: string;
  previousReadingKey: string;
  density: 'comfortable' | 'sparse' | 'extra-sparse';
  showChapterTitles: boolean;
  showOutput: boolean;
  showSidebar: boolean;
}

export interface TextChunk {
  index: number;
  start: number;
  end: number;
  text: string;
  chapterId?: string;
}

export interface ReadingSlot {
  chunkIndex: number;
  line: number;
  from: number;
  to: number;
  sourceStart: number;
  sourceEnd: number;
  /** The literal representation in the display document; omitted means JSON. */
  encoding?: ReadingEncoding;
  /** Inclusive physical end line; original newlines may span several lines. */
  endLine?: number;
}

export interface ParkingZone {
  startLine: number;
  endLine: number;
}

export interface DocumentModel {
  format?: DisplayFormat;
  text: string;
  slots: ReadingSlot[];
  parkingZones: ParkingZone[];
  windowStart: number;
  windowEnd: number;
  totalChunks: number;
  rangeStart?: number;
  rangeEnd?: number;
  /** Structural chrome applies equally to work records and source records. */
  lineStyles?: { line: number; kind: string }[];
}
