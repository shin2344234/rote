// Injected into every frame when the user clicks Scan. Never runs on its own.
import { createLogger, errorData, stripUrl } from '../shared/log';
import type { ContentRequest } from '../shared/types';
import { addRow, fillItems, findLostFields, readField, sentFileId, setRun, showField, trackUserEdits, undoAll, uploadFile, waitForSettle } from './fill';
import { scanFrame } from './scan';

declare global {
  // eslint-disable-next-line no-var
  var __resumeAutofillLoaded: boolean | undefined;
}

let runId: string | undefined;
const log = createLogger('content', () => runId);

async function handle(request: ContentRequest): Promise<unknown> {
  runId = request.runId;
  setRun(request.runId);
  switch (request.type) {
    case 'scan': {
      const started = performance.now();
      const result = scanFrame(request.frameId);
      log.info('scan.frame', {
        frameUrl: stripUrl(location.href),
        isTop: window === window.top,
        fields: result.fields.length,
        skipped: result.skipped,
        totalElements: result.totalElements,
        ms: Math.round(performance.now() - started),
      });
      return result.fields;
    }
    case 'fill':
      return fillItems(request.items);
    case 'upload':
      return uploadFile(request.fieldId, request.file, request.mark);
    case 'uploaded':
      return sentFileId();
    case 'settle':
      return waitForSettle();
    case 'undo':
      return undoAll();
    case 'check':
      return findLostFields(request.fields);
    case 'read':
      return readField(request.fieldId);
    case 'show':
      return showField(request.fieldId);
    case 'addRow':
      return addRow(request.fieldId, request.group);
  }
}

if (!globalThis.__resumeAutofillLoaded) {
  globalThis.__resumeAutofillLoaded = true;
  trackUserEdits();
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || message?.type === 'log') return false;
    handle(message as ContentRequest)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => {
        log.error('request.failed', { type: message?.type, ...errorData(error) });
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  });
}
