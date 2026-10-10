const ATTACHMENT_TOKEN = /!\[attachment:[^\]]+\]/g;
const SINGLE_ATTACHMENT_TOKEN = /^!\[attachment:[^\]]+\]$/;

export const UPLOAD_PLACEHOLDER_ATTR = 'data-ae-upload-placeholder';
export const ATTACHMENT_LOADING_CLASS = 'ae-attachment-loading';
const ATTACHMENT_TOKEN_ATTR = 'data-ae-attachment';

export interface EditorContentResponse {
  description?: string | string[] | null;
  cohort?: { notes?: string | null } | null;
}

/** Endpoints return either one string or one string per description row. */
export function extractEditorContents(response: EditorContentResponse | null): string[] {
  if (!response) {
    return [];
  }
  const value = response.description !== undefined
    ? response.description
    : (response.cohort ? response.cohort.notes : null);
  if (typeof value === 'string') {
    return [value];
  }
  return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
}

export function countAttachmentTokens(html: string): number {
  const tokens = (html || '').match(ATTACHMENT_TOKEN);
  return tokens ? tokens.length : 0;
}

/** Server-rendered content has its tokens replaced by <img>, so it cannot be edited as-is. */
export function isRenderedAttachmentContent(html: string): boolean {
  return countAttachmentTokens(html) === 0 && /<img[\s>]/i.test(html || '');
}

export function withAttachmentPlaceholders(rawHtml: string): string {
  return (rawHtml || '').replace(
    ATTACHMENT_TOKEN,
    '<span class="' + ATTACHMENT_LOADING_CLASS + '">Loading image…</span>',
  );
}

export function createAttachmentToken(doc: Document, markdown: string): HTMLElement {
  const token = doc.createElement('span');
  token.style.color = 'blue';
  token.textContent = markdown;
  markAsAttachmentToken(token);
  return token;
}

/**
 * An editable token span lets the caret settle at its end, so the browser
 * carries its colour into the text typed after it (and into the next line on
 * Enter). Non-editable tokens keep the caret outside and behave as one unit.
 */
export function markAttachmentTokens(root: HTMLElement): void {
  const spans = root.querySelectorAll('span');
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    if (span.children.length === 0 && SINGLE_ATTACHMENT_TOKEN.test((span.textContent || '').trim())) {
      markAsAttachmentToken(span);
    }
  }
}

/** Removes markup that only exists while editing: upload placeholders and token locks. */
export function stripEditorOnlyMarkup(html: string): string {
  const source = html || '';
  if (source.indexOf(UPLOAD_PLACEHOLDER_ATTR) === -1 && source.indexOf(ATTACHMENT_TOKEN_ATTR) === -1) {
    return source;
  }
  const doc = parseInert(source);
  const placeholders = doc.body.querySelectorAll('[' + UPLOAD_PLACEHOLDER_ATTR + ']');
  for (let i = 0; i < placeholders.length; i++) {
    placeholders[i].parentNode!.removeChild(placeholders[i]);
  }
  const tokens = doc.body.querySelectorAll('[' + ATTACHMENT_TOKEN_ATTR + ']');
  for (let i = 0; i < tokens.length; i++) {
    tokens[i].removeAttribute(ATTACHMENT_TOKEN_ATTR);
    tokens[i].removeAttribute('contenteditable');
  }
  return doc.body.innerHTML;
}

function markAsAttachmentToken(span: HTMLElement): void {
  span.setAttribute(ATTACHMENT_TOKEN_ATTR, 'true');
  span.setAttribute('contenteditable', 'false');
}

/**
 * The server renders attachment tokens into <img> elements but reads the
 * content from storage, which may not include the latest unsaved edit yet.
 * A server preview is only trusted when it carries exactly the same text as
 * the raw content and one image per token on top of the inline images.
 */
export function isServerPreviewOf(previewHtml: string, rawHtml: string): boolean {
  const preview = parseInert(previewHtml);
  const local = parseInert((rawHtml || '').replace(ATTACHMENT_TOKEN, ''));

  return normalizedText(preview) === normalizedText(local)
    && imageCount(preview) === imageCount(local) + countAttachmentTokens(rawHtml);
}

export function findPreviewOf(rawHtml: string, candidates: string[]): string | null {
  const match = candidates.find(candidate => isServerPreviewOf(candidate, rawHtml));
  return match === undefined ? null : match;
}

/** Falls back to the only candidate when the stored content changed since it was rendered. */
export function findRawOf(renderedHtml: string, candidates: string[]): string | null {
  const match = candidates.find(candidate => isServerPreviewOf(renderedHtml, candidate));
  if (match !== undefined) {
    return match;
  }
  return candidates.length === 1 ? candidates[0] : null;
}

function parseInert(html: string): Document {
  return new DOMParser().parseFromString(html || '', 'text/html');
}

function normalizedText(doc: Document): string {
  return (doc.body.textContent || '')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function imageCount(doc: Document): number {
  return doc.body.querySelectorAll('img').length;
}
