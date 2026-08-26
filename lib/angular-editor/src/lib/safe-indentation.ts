export type SafeIndentationCommand = 'indent' | 'outdent';

const SAFE_INDENT_CLASS_PREFIX = 'ae-safe-indent-px-';
const MAX_SAFE_INDENT_PX = 2000;

/**
 * Keep editor indentation as flat CSS instead of relying on execCommand's
 * browser-specific <blockquote><div>...</div></blockquote> output.
 *
 * The function intentionally falls back for list items so the browser keeps
 * its native ordered/unordered-list nesting behavior.
 */
export function applySafeIndentation(
  doc: Document,
  editorRoot: HTMLElement,
  command: SafeIndentationCommand,
  stepPx = 40,
): boolean {
  const selection = doc.getSelection ? doc.getSelection() : null;
  if (!selection || selection.rangeCount === 0) {
    return false;
  }

  const range = selection.getRangeAt(0);
  if (!isInsideEditor(editorRoot, range.commonAncestorContainer)) {
    return false;
  }

  const blocks = findSelectedBlocks(editorRoot, range);
  if (blocks.length === 0 || containsListItem(blocks, editorRoot)) {
    return false;
  }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const currentIndent = readPixelMarginLeft(block);
    const nextIndent = command === 'indent'
      ? currentIndent + stepPx
      : Math.max(0, currentIndent - stepPx);

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
    if (/^(P|DIV|H1|H2|H3|H4|H5|H6|PRE)$/.test(current.tagName)) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

function containsListItem(blocks: HTMLElement[], editorRoot: HTMLElement): boolean {
  for (let i = 0; i < blocks.length; i++) {
    let current: HTMLElement | null = blocks[i];
    while (current && current !== editorRoot) {
      if (current.tagName === 'LI') {
        return true;
      }
      current = current.parentElement;
    }
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
