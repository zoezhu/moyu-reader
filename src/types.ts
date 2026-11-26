export type BookFormat = 'txt' | 'epub' | 'pdf';
export type ReadingDirection = -1 | 1;

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
}

export interface ParkingZone {
  startLine: number;
  endLine: number;
}

export interface DocumentModel {
  text: string;
  slots: ReadingSlot[];
  parkingZones: ParkingZone[];
  windowStart: number;
  windowEnd: number;
  totalChunks: number;
  rangeStart?: number;
  rangeEnd?: number;
}
