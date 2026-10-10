export type SafeIndentationCommand = 'indent' | 'outdent';

/**
 * Shared indentation policy for the editor side of the pipeline.
 *
 * HtmlCleanerService (application-owned) deliberately declares its own copy of
 * these numbers so the generic editor library never depends on application PDF
 * code. `src/pdf-html-policy.spec.ts` fails if the two copies drift apart.
 */
export const SAFE_INDENT_STEP_PX = 40;
export const MAX_SAFE_INDENT_PX = 2000;

const SAFE_INDENT_CLASS_PREFIX = 'ae-safe-indent-px-';

/** Blocks that can carry a margin-left indentation directly. */
const INDENTABLE_BLOCK_TAGS = /^(P|DIV|H1|H2|H3|H4|H5|H6|PRE)$/;

/**
 * Elements that may legally contain a <p>, used when a naked text node has to
 * be wrapped before it can be indented.
 */
const PARAGRAPH_HOST_TAGS = /^(TD|TH)$/;

const BLOCK_CONTENT_SELECTOR =
  'address, article, aside, blockquote, div, dl, fieldset, figure, ' +
  'footer, form, h1, h2, h3, h4, h5, h6, header, hr, main, nav, ' +
  'ol, p, pre, section, table, ul';

/**
 * Keep editor indentation as flat paragraph CSS instead of relying on
 * execCommand's browser-specific <blockquote><div>...</div></blockquote>
 * output. iTextPDF 5 renders margin-left reliably on paragraph elements.
 *
 * @returns `true` when the safe implementation owns the command — the caller
 *   must NOT fall back to `document.execCommand`, even when nothing changed.
 *   `false` is returned for exactly one situation: the selection touches a
 *   list item, where the browser's native ordered/unordered nesting is the
 *   desired behavior. Any other unsupported selection is a safe no-op, because
 *   falling back would let the browser recreate <blockquote>.
 */
export function applySafeIndentation(
  doc: Document,
  editorRoot: HTMLElement,
  command: SafeIndentationCommand,
  stepPx = SAFE_INDENT_STEP_PX,
): boolean {
  const selection = doc.getSelection ? doc.getSelection() : null;
  if (!selection || selection.rangeCount === 0) {
    return true; // safe no-op: never hand an unknown selection to execCommand
  }

  const range = selection.getRangeAt(0);
  if (!isInsideEditor(editorRoot, range.commonAncestorContainer)) {
    return true; // safe no-op
  }

  // Lists are the single intentional native fallback.
  if (rangeTouchesListItem(range, editorRoot)) {
    return false;
  }

  // Naked text directly inside the editor (or a table cell) has no block to
  // indent. Wrap it in a paragraph instead of delegating to execCommand, which
  // is what historically recreated <blockquote>. No-op when the selection is
  // already made of block elements.
  wrapLooseInlineContent(doc, editorRoot, range);

  const blocks = findSelectedBlocks(editorRoot, range);
  if (blocks.length === 0) {
    return true; // safe no-op: normalization impossible, but never a blockquote
  }

  for (let i = 0; i < blocks.length; i++) {
    let block = blocks[i];
    const currentIndent = readPixelMarginLeft(block);
    const nextIndent = command === 'indent'
      ? Math.min(currentIndent + stepPx, MAX_SAFE_INDENT_PX)
      : Math.max(0, currentIndent - stepPx);

    // Browsers may use DIV as the paragraph separator in contenteditable.
    // Convert only an actual indentation target to P so the saved HTML is
    // rendered consistently by iTextPDF 5. The selection remains valid
    // because its text nodes are moved, not recreated.
    if (nextIndent > 0 || currentIndent > 0) {
      block = convertIndentedDivToParagraph(doc, block, range);
    }

    if (nextIndent > 0) {
      block.style.marginLeft = nextIndent + 'px';
    } else {
      block.style.removeProperty('margin-left');
      if (!block.getAttribute('style')) {
        block.removeAttribute('style');
      }
    }
  }

  return true;
}

/**
 * Convert a text-only DIV indentation target to P while preserving its
 * attributes and the active Range. DIVs containing another block remain
 * unchanged to avoid producing invalid nested paragraph markup.
 */
function convertIndentedDivToParagraph(
  doc: Document,
  block: HTMLElement,
  range: Range,
): HTMLElement {
  if (
    block.tagName !== 'DIV' ||
    !block.parentNode ||
    containsBlockContent(block)
  ) {
    return block;
  }

  const startIsBlock = range.startContainer === block;
  const endIsBlock = range.endContainer === block;
  const startOffset = range.startOffset;
  const endOffset = range.endOffset;
  const paragraph = doc.createElement('p');

  for (let i = 0; i < block.attributes.length; i++) {
    const attribute = block.attributes.item(i);
    if (attribute) {
      paragraph.setAttribute(attribute.name, attribute.value);
    }
  }

  while (block.firstChild) {
    paragraph.appendChild(block.firstChild);
  }

  block.parentNode.replaceChild(paragraph, block);

  if (startIsBlock) {
    range.setStart(paragraph, Math.min(startOffset, paragraph.childNodes.length));
  }
  if (endIsBlock) {
    range.setEnd(paragraph, Math.min(endOffset, paragraph.childNodes.length));
  }

  return paragraph;
}

/**
 * Wrap loose inline/text children of the editor (or of a table cell) in a
 * paragraph so indentation has a block to attach to.
 *
 * Nodes are moved, never recreated, so the caller's Range stays alive. This
 * replaces the historical fallback to execCommand('indent'), which recreated
 * the <blockquote><div> structure that iTextPDF 5 cannot process.
 */
function wrapLooseInlineContent(
  doc: Document,
  editorRoot: HTMLElement,
  range: Range,
): void {
  const host = findParagraphHost(editorRoot, range.commonAncestorContainer);
  if (!host) {
    return;
  }

  const children: Node[] = [];
  for (let i = 0; i < host.childNodes.length; i++) {
    children.push(host.childNodes[i]);
  }

  const startIndex = indexOfTopLevelAncestor(host, range.startContainer, range.startOffset, children);
  const endIndex = indexOfTopLevelAncestor(host, range.endContainer, range.endOffset, children);
  if (startIndex < 0 || endIndex < 0) {
    return;
  }

  const from = Math.min(startIndex, endIndex);
  const to = Math.max(startIndex, endIndex);

  // Split the affected slice into runs of consecutive inline/text nodes.
  const runs: Node[][] = [];
  let run: Node[] | null = null;
  for (let i = from; i <= to && i < children.length; i++) {
    const node = children[i];
    if (isBlockLevelNode(node)) {
      run = null;
      continue;
    }
    if (!run) {
      run = [];
      runs.push(run);
    }
    run.push(node);
  }

  for (let r = 0; r < runs.length; r++) {
    const nodes = runs[r];
    if (nodes.length === 0 || !hasMeaningfulContent(nodes)) {
      continue;
    }
    const paragraph = doc.createElement('p');
    host.insertBefore(paragraph, nodes[0]);
    for (let n = 0; n < nodes.length; n++) {
      paragraph.appendChild(nodes[n]);
    }
  }
}

/** Nearest ancestor that may host a <p>: the editor root or a table cell. */
function findParagraphHost(editorRoot: HTMLElement, node: Node | null): HTMLElement | null {
  let current: HTMLElement | null = node && node.nodeType === Node.ELEMENT_NODE
    ? node as HTMLElement
    : (node ? node.parentElement : null);

  while (current) {
    if (current === editorRoot || PARAGRAPH_HOST_TAGS.test(current.tagName)) {
      return current;
    }
    if (!editorRoot.contains(current)) {
      return null;
    }
    current = current.parentElement;
  }
  return null;
}

/** Index within `children` of the host-level ancestor of a range boundary. */
function indexOfTopLevelAncestor(
  host: HTMLElement,
  container: Node,
  offset: number,
  children: Node[],
): number {
  if (container === host) {
    // Boundary expressed against the host itself: clamp into the child list.
    if (children.length === 0) {
      return -1;
    }
    return Math.max(0, Math.min(offset, children.length - 1));
  }

  let current: Node | null = container;
  while (current && current.parentNode && current.parentNode !== host) {
    current = current.parentNode;
  }
  if (!current || current.parentNode !== host) {
    return -1;
  }
  for (let i = 0; i < children.length; i++) {
    if (children[i] === current) {
      return i;
    }
  }
  return -1;
}

function hasMeaningfulContent(nodes: Node[]): boolean {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.nodeType === Node.ELEMENT_NODE) {
      return true;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.nodeValue || '').replace(/\u00A0/g, ' ').trim();
      if (text.length > 0) {
        return true;
      }
    }
  }
  return false;
}

function isBlockLevelNode(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }
  const tag = (node as HTMLElement).tagName;
  return INDENTABLE_BLOCK_TAGS.test(tag) ||
    /^(UL|OL|LI|TABLE|BLOCKQUOTE|HR|FIGURE|SECTION|ARTICLE|HEADER|FOOTER|NAV|MAIN|ASIDE|DL|FORM|FIELDSET)$/
      .test(tag);
}

function containsBlockContent(element: HTMLElement): boolean {
  return element.querySelector(BLOCK_CONTENT_SELECTOR) !== null;
}

/**
 * Angular's HTML sanitizer removes style attributes. Encode only a validated
 * margin-left as a temporary class, which the sanitizer safely preserves.
 */
export function encodeSafeIndentationForSanitizer(
  html: string,
  doc: Document,
): string {
  const container = doc.createElement('div');
  container.innerHTML = html || '';
  const styled = container.querySelectorAll<HTMLElement>('[style]');

  for (let i = 0; i < styled.length; i++) {
    const indent = readPixelMarginLeft(styled[i]);
    if (indent <= 0 || indent > MAX_SAFE_INDENT_PX) continue;
    const token = String(Math.round(indent * 100) / 100).replace('.', '_');
    styled[i].classList.add(SAFE_INDENT_CLASS_PREFIX + token);
  }

  return container.innerHTML;
}

/** Restore only the bounded numeric indentation after Angular sanitized HTML. */
export function restoreSafeIndentationAfterSanitizer(
  html: string,
  doc: Document,
): string {
  const container = doc.createElement('div');
  container.innerHTML = html || '';
  const elements = container.querySelectorAll<HTMLElement>('[class]');

  for (let i = 0; i < elements.length; i++) {
    const classes: string[] = [];
    for (let c = 0; c < elements[i].classList.length; c++) {
      classes.push(elements[i].classList.item(c)!);
    }

    for (let c = 0; c < classes.length; c++) {
      if (classes[c].indexOf(SAFE_INDENT_CLASS_PREFIX) !== 0) continue;

      const encoded = classes[c].substring(SAFE_INDENT_CLASS_PREFIX.length);
      const match = /^(\d{1,4}(?:_\d{1,2})?)$/.exec(encoded);
      const indent = match ? Number(match[1].replace('_', '.')) : 0;
      elements[i].classList.remove(classes[c]);

      if (indent > 0 && indent <= MAX_SAFE_INDENT_PX) {
        elements[i].style.marginLeft = indent + 'px';
      }
    }

    if (elements[i].classList.length === 0) {
      elements[i].removeAttribute('class');
    }
  }

  return container.innerHTML;
}

function findSelectedBlocks(editorRoot: HTMLElement, range: Range): HTMLElement[] {
  if (range.collapsed) {
    const block = findClosestBlock(range.startContainer, editorRoot);
    return block ? [block] : [];
  }

  const selector = 'p,div,h1,h2,h3,h4,h5,h6,pre';
  const all = editorRoot.querySelectorAll(selector);
  const selected: HTMLElement[] = [];

  for (let i = 0; i < all.length; i++) {
    const candidate = all[i] as HTMLElement;
    if (rangeIntersectsNode(range, candidate)) {
      selected.push(candidate);
    }
  }

  if (selected.length === 0) {
    // Expanded selection inside a single block that the intersection test
    // missed (e.g. a caret-sized selection at a block boundary).
    const block = findClosestBlock(range.startContainer, editorRoot);
    return block ? [block] : [];
  }

  // An ancestor and its child both intersect the range. Only indent the
  // deepest content blocks to avoid applying the same step twice.
  const leaves: HTMLElement[] = [];
  for (let i = 0; i < selected.length; i++) {
    let containsSelectedBlock = false;
    for (let j = 0; j < selected.length; j++) {
      if (i !== j && selected[i].contains(selected[j])) {
        containsSelectedBlock = true;
        break;
      }
    }
    if (!containsSelectedBlock) {
      leaves.push(selected[i]);
    }
  }

  return leaves;
}

function findClosestBlock(node: Node, editorRoot: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = node.nodeType === Node.ELEMENT_NODE
    ? node as HTMLElement
    : node.parentElement;

  while (current && current !== editorRoot) {
    if (INDENTABLE_BLOCK_TAGS.test(current.tagName)) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

/** True when any part of the selection sits inside a list item. */
function rangeTouchesListItem(range: Range, editorRoot: HTMLElement): boolean {
  if (hasListItemAncestor(range.startContainer, editorRoot) ||
      hasListItemAncestor(range.endContainer, editorRoot)) {
    return true;
  }

  if (range.collapsed) {
    return false;
  }

  const listItems = editorRoot.querySelectorAll('li');
  for (let i = 0; i < listItems.length; i++) {
    if (rangeIntersectsNode(range, listItems[i])) {
      return true;
    }
  }
  return false;
}

function hasListItemAncestor(node: Node | null, editorRoot: HTMLElement): boolean {
  let current: HTMLElement | null = node && node.nodeType === Node.ELEMENT_NODE
    ? node as HTMLElement
    : (node ? node.parentElement : null);

  while (current && current !== editorRoot) {
    if (current.tagName === 'LI') {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function readPixelMarginLeft(element: HTMLElement): number {
  const value = element.style.marginLeft || '';
  const match = /^(-?\d+(?:\.\d+)?)px$/i.exec(value.trim());
  if (!match) {
    return 0;
  }

  const parsed = Number(match[1]);
  return isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function rangeIntersectsNode(range: Range, node: Node): boolean {
  if (typeof range.intersectsNode === 'function') {
    try {
      return range.intersectsNode(node);
    } catch (_error) {
      return false;
    }
  }

  const nodeRange = node.ownerDocument!.createRange();
  nodeRange.selectNodeContents(node);
  return range.compareBoundaryPoints(Range.END_TO_START, nodeRange) < 0 &&
    range.compareBoundaryPoints(Range.START_TO_END, nodeRange) > 0;
}

function isInsideEditor(editorRoot: HTMLElement, node: Node | null): boolean {
  return !!node && (node === editorRoot || editorRoot.contains(node));
}
