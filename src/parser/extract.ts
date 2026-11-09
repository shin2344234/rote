// Turns a PDF, DOCX or TXT file into plain text. Runs in the options page.
import * as pdfjs from 'pdfjs-dist';
import mammoth from 'mammoth';
import { createLogger, errorData } from '../shared/log';
import { layoutPage, type PdfItem } from './layout';

const log = createLogger('extract');

export interface Extracted {
  text: string;
  warnings: string[];
}

async function extractPdf(bytes: ArrayBuffer): Promise<Extracted> {
  pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.mjs');
  // pdf.js takes ownership of the buffer, and the stored resume still needs it.
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) });
  const pages: string[] = [];
  try {
    const documentProxy = await loadingTask.promise;
    for (let number = 1; number <= documentProxy.numPages; number++) {
      const page = await documentProxy.getPage(number);
      const content = await page.getTextContent();
      const items: PdfItem[] = [];
      for (const item of content.items) {
        if (!('str' in item)) continue;
        items.push({ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width, height: item.height || Math.abs(item.transform[3]) });
      }
      const layout = layoutPage(items);
      log.info('pdf.page', { number, items: items.length, columns: layout.columns, characters: layout.text.length });
      pages.push(layout.text);
    }
  } finally {
    // Each loading task owns a worker, and Reparse would otherwise add one per run.
    await loadingTask.destroy();
  }
  const text = pages.join('\n\n');
  const warnings = text.replace(/\s/g, '').length < 100
    ? ['This PDF has almost no text and is probably a scan. Scanned PDFs need OCR, which v1 does not do.']
    : [];
  return { text, warnings };
}

export async function extractText(name: string, bytes: ArrayBuffer): Promise<Extracted> {
  const extension = name.toLowerCase().split('.').pop();
  log.info('start', { extension, size: bytes.byteLength });
  try {
    if (extension === 'pdf') return await extractPdf(bytes);
    if (extension === 'docx') {
      const result = await mammoth.extractRawText({ arrayBuffer: bytes.slice(0) });
      log.info('docx.done', { messages: result.messages.map((message) => message.message), characters: result.value.length });
      return { text: result.value, warnings: [] };
    }
    if (extension === 'txt') return { text: new TextDecoder().decode(bytes), warnings: [] };
  } catch (error) {
    log.error('failed', { extension, ...errorData(error) });
    throw error;
  }
  throw new Error(`Unsupported file type ".${extension}". Use PDF, DOCX or TXT.`);
}
