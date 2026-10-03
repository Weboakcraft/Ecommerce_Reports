/// <reference lib="webworker" />
/**
 * File parsing runs in a Web Worker so a large workbook never freezes the UI.
 * The file bytes never leave the browser.
 */
import { ADAPTERS, openSource } from '../adapters';
import type { ParseResult, StructureCheck } from '../adapters';
import type { EventMapping, Platform, Settings } from '../types';
import { sha256Hex } from '../utils/hash';

export interface ImportRequest {
  buffer: ArrayBuffer;
  fileName: string;
  platform: Platform;
  settings: Settings;
  mappings: EventMapping[];
  batchId: string;
}

export type ImportMessage =
  | { type: 'progress'; stage: string; done: number; total: number }
  | { type: 'structure'; check: StructureCheck }
  | { type: 'done'; result: ParseResult; fileHash: string }
  | { type: 'error'; message: string; structural: boolean };

const post = (m: ImportMessage) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = async (ev: MessageEvent<ImportRequest>) => {
  const req = ev.data;
  try {
    post({ type: 'progress', stage: 'Checking file', done: 0, total: 0 });
    const fileHash = await sha256Hex(req.buffer);
    const adapter = ADAPTERS[req.platform];
    post({ type: 'progress', stage: 'Opening workbook', done: 0, total: 0 });
    const source = openSource(req.buffer, req.fileName);
    const check = adapter.checkStructure(source);
    post({ type: 'structure', check });
    if (!check.ok) {
      post({ type: 'error', message: check.errors.join(' '), structural: true });
      return;
    }
    post({ type: 'progress', stage: 'Reading sheet', done: 0, total: 0 });
    const result = adapter.parse(source, {
      settings: req.settings,
      mappings: req.mappings,
      fileName: req.fileName,
      batchId: req.batchId,
      onProgress: (done, total) => post({ type: 'progress', stage: 'Validating rows', done, total }),
    });
    post({ type: 'done', result, fileHash });
  } catch (e) {
    post({ type: 'error', message: (e as Error).message || String(e), structural: true });
  }
};
