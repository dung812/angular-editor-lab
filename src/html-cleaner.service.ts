import { Injectable } from '@angular/core';
import sanitizeHtml from 'sanitize-html';

/**
 * Service responsible for sanitizing and cleaning HTML content with enhanced security and structure preservation.
 *
 * This service ensures that HTML content from external sources or user inputs is safe for rendering
 * while maintaining the intended formatting and structure. It implements strict security measures
 * against XSS (Cross-Site Scripting) attacks through whitelist-based sanitization.
 *
 * Features:
 * - Strict XSS protection through allowlist-based tag and attribute filtering
 * - Preservation of semantic document structure and nested hierarchies
 * - Removal of unsafe or redundant HTML elements and attributes
 * - Validation and filtering of CSS styles based on security rules
 * - Support for common HTML elements including tables, lists, and text formatting
 *
 * @example
 * ```typescript
 * constructor(private htmlCleaner: HtmlCleanerService) {}
 *
 * processUserContent(rawHtml: string): string {
 *   return this.htmlCleaner.sanitize(rawHtml);
 * }
 * ```
 */
@Injectable({ providedIn: 'root' })
export class HtmlCleanerService {
  /**
   * Sanitizes and cleans HTML content by applying security rules and structural optimizations.
   *
   * The sanitization process includes:
   * 1. Filtering allowed HTML tags and attributes
   * 2. Validating and cleaning CSS styles
   * 3. Ensuring proper document structure
   * 4. Removing potentially malicious content
   *
   * @param html - The raw HTML string to be sanitized
   * @returns A cleaned and safe HTML string that can be safely rendered
   * @throws Will not throw errors, but will strip invalid content
   */
  sanitize(html: string): string {
    const sanitized = sanitizeHtml(html, {
      allowedTags: [
        'p', 'br', 'b', 'i', 'u','strong','em',
        'ul', 'ol', 'li',
        'table', 'thead', 'tbody', 'tr', 'td', 'th',
        'span','div', 'img',
        'blockquote',
        'h1', 'h2', 'h3', 'h4','h5'
      ],
      allowedAttributes: {
        '*': ['style', 'align'],
        img: ['src', 'srcset', 'alt', 'title', 'width', 'height', 'loading'],
      },
      allowedSchemes: ['data', 'http'],
      allowedStyles: {
        '*': {
          'font-family': [/^times-roman$/i],
          'background-color': [/^(?!transparent|white|#fff|#ffffff).*$/i], // reject transparent, white
          'color': [/^(?!white|#fff|#ffffff|rgb\(255,255,255\)).*$/i], // reject light text colors
          'text-align': [/^left$/i, /^right$/i, /^center$/i],
          'font-weight': [/^bold$/i],
          'font-style': [/^italic$/i],
        },
      },
      selfClosing: [
        'img', 'br', 'hr', 'area', 'base', 'basefont', 'input', 'link', 'meta',
      ],
    });

    return this.cleanDOM(sanitized);
  }

  /**
   * Performs a series of DOM cleanup operations on the sanitized HTML.
   * This method orchestrates multiple cleanup operations to ensure the final HTML
   * is well-structured, semantically correct, and free of common formatting issues.
   *
   * @param html The pre-sanitized HTML string to be cleaned
   * @returns A cleaned HTML string with normalized structure and formatting
   */
  private cleanDOM(html: string): string {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    this.wrapAllContentInRootDiv(doc);


    this.fixBrokenListRoots(doc); // Repair obvious structural issues
    this.foldDanglingWrapperListsKeepWrapper(doc); // Fold single-shell wrapper lists (keep wrapper type)
    this.mergeEmptyListItemsIntoPrevious(doc); // Merge empty <li> that only contain sublists into previous
    this.hoistSublistsOutOfLiForIText(doc); // Hoist sublists out of <li> for iText5 compatibility
    this.convertBlockquoteSpanToDivs(doc); // Step 5. Convert nested blockquotes (with spans/text) into flat <div> blocks. This is what produces: <div>abc</div><div>xyz</div> from your input

    // Step 6. Hygiene cleanup
    this.removeEmptyTags(doc);
    this.removeInvisibleStyles(doc);
    this.unwrapEmptySpans(doc);
    this.unwrapInlineWrappingBlock(doc);
    this.removeEmptyTables(doc);

    return doc.body.innerHTML;
  }

  /**
   * Ensure the HTML has a single root <div> wrapper .
   */
  private wrapAllContentInRootDiv(doc: Document): void {
    const body = doc.body;
    if (!body) return;

    // If there's exactly one root element and it's already <div>, skip.
    if (
      body.childElementCount === 1 &&
      body.firstElementChild!.tagName.toLowerCase() === 'div'
    ) {
      // Also verify there are no stray top-level text nodes with non-whitespace
      const hasTopLevelNonWsText = Array.prototype.some.call(
        body.childNodes,
        (n: Node) => {
          return (
            n.nodeType === 3 &&
            (n.nodeValue || '').replace(/\u00A0/g, ' ').trim().length > 0
          );
        },
      );
      if (!hasTopLevelNonWsText) return;
    }

    // Check if there is any meaningful top-level content (text or elements).
    let hasContent = false;
    for (let i = 0; i < body.childNodes.length; i++) {
      const n = body.childNodes[i];
      if (n.nodeType === 1) {
        // element
        hasContent = true;
        break;
      }
      if (n.nodeType === 3) {
        // text
        const t = (n.nodeValue || '').replace(/\u00A0/g, ' ').trim();
        if (t.length > 0) {
          hasContent = true;
          break;
        }
      }
    }
    if (!hasContent) return;

    // Create wrapper and move all nodes into it.
    const wrapper = doc.createElement('div');
    // Move in order to preserve sequence (abc, then <div>xyz</div>, then <div>123</div>, etc.)
    const snapshot: Node[] = [];
    for (let i = 0; i < body.childNodes.length; i++)
      snapshot.push(body.childNodes[i]);
    for (let i = 0; i < snapshot.length; i++) wrapper.appendChild(snapshot[i]);

    body.appendChild(wrapper);
  }

  /**
   * Convert blockquotes to divs.
   * - If a blockquote contains nested blockquotes: flatten each leaf <blockquote> into its own <div> (preserving order).
   * - If a blockquote has NO nested blockquotes: simply rename the blockquote to <div> and keep its children intact.
   */
  private convertBlockquoteSpanToDivs(doc: Document): void {
    const hasInnerBlockquote = (el: Element): boolean =>
      !!el.querySelector('blockquote');

    const isWhitespace = (n: Node): boolean =>
      n.nodeType === 3 &&
      (n.nodeValue || '').replace(/\u00A0/g, ' ').trim().length === 0;

    const textOf = (el: Element): string =>
      (el.textContent || '').replace(/\s+/g, ' ').trim();

    // Normalize a node to a block-level <div> (preserving structure for lists)
    const normalizeToBlockDiv = (node: Node): HTMLElement | Element | null => {
      if (node.nodeType === 3) {
        const t = (node.nodeValue || '').replace(/\u00A0/g, ' ').trim();
        if (!t) return null;
        const div = doc.createElement('div');
        div.textContent = t;
        return div;
      }
      if (node.nodeType !== 1) return null;

      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();

      if (tag === 'br') return null;

      if (tag === 'span') {
        const t = textOf(el);
        if (!t) return null;
        const div = doc.createElement('div');
        div.textContent = t;
        return div;
      }

      if (tag === 'div') {
        if (
          el.children.length === 1 &&
          el.firstElementChild!.tagName.toLowerCase() === 'div'
        ) {
          return el.firstElementChild as HTMLElement;
        }
        return el;
      }

      // Preserve lists as elements (do not flatten to text)
      if (tag === 'ul' || tag === 'ol') {
        return el;
      }

      if (tag === 'p') {
        const t = textOf(el);
        if (!t) return null;
        const div = doc.createElement('div');
        div.textContent = t;
        return div;
      }

      // Default: wrap any other element with non-empty text into <div>
      const t = textOf(el);
      if (!t) return null;
      const div = doc.createElement('div');
      div.textContent = t;
      return div;
    };

    // Return leaf <blockquote> elements (those without nested <blockquote>) under a root
    const listLeafBlockquotes = (rootBQ: HTMLElement): HTMLElement[] => {
      // Include root if it is itself a leaf
      if (!hasInnerBlockquote(rootBQ)) return [rootBQ];

      const desc = Array.prototype.slice.call(
        rootBQ.querySelectorAll('blockquote'),
      ) as HTMLElement[];
      const out: HTMLElement[] = [];
      for (let i = 0; i < desc.length; i++) {
        if (!hasInnerBlockquote(desc[i])) out.push(desc[i]);
      }
      return out;
    };

    // Snapshot all blockquotes and find top-level ones
    const allBqs = Array.prototype.slice.call(
      doc.querySelectorAll('blockquote'),
    ) as HTMLElement[];
    if (allBqs.length === 0) return;

    const topLevel: HTMLElement[] = [];
    for (let i = 0; i < allBqs.length; i++) {
      const bq = allBqs[i];
      let p: HTMLElement | null = bq.parentElement;
      let hasBQAncestor = false;
      while (p) {
        if (p.tagName && p.tagName.toLowerCase() === 'blockquote') {
          hasBQAncestor = true;
          break;
        }
        p = p.parentElement;
      }
      if (!hasBQAncestor) topLevel.push(bq);
    }

    for (let t = 0; t < topLevel.length; t++) {
      const root = topLevel[t];

      if (!hasInnerBlockquote(root)) {
        // Simple rename: <blockquote> -> <div>, keep children intact
        const div = doc.createElement('div');
        while (root.firstChild) div.appendChild(root.firstChild);
        if (root.parentNode) root.parentNode.replaceChild(div, root);
        continue;
      }

      // Case: contains nested blockquotes
      const wrapper = doc.createElement('div');
      const children = Array.prototype.slice.call(root.childNodes) as Node[];

      for (let i = 0; i < children.length; i++) {
        const ch = children[i];
        if (isWhitespace(ch)) continue;

        if (
          ch.nodeType === 1 &&
          (ch as Element).tagName.toLowerCase() === 'blockquote'
        ) {
          const chEl = ch as HTMLElement;

          if (!hasInnerBlockquote(chEl)) {
            // DIRECT CHILD LEAF: create <div> and MOVE its children into it (preserve structure)
            const d = doc.createElement('div');
            while (chEl.firstChild) d.appendChild(chEl.firstChild);
            wrapper.appendChild(d);
          } else {
            // Nested quotes: for each leaf descendant, create <div> and MOVE its children
            const leaves = listLeafBlockquotes(chEl);
            for (let k = 0; k < leaves.length; k++) {
              const leaf = leaves[k];
              const d = doc.createElement('div');
              while (leaf.firstChild) d.appendChild(leaf.firstChild);
              wrapper.appendChild(d);
            }
          }
          continue;
        }

        // Non-blockquote child: normalize (preserve UL/OL)
        const block = normalizeToBlockDiv(ch);
        if (block) wrapper.appendChild(block as Node);
      }

      if (root.parentNode) {
        root.parentNode.replaceChild(wrapper, root);
      }
    }
  }

  // ======================================================
  // LIST STRUCTURE REPAIR
  // ======================================================

  /** Wrap any <li> whose parent is not UL/OL into a new <ul>. */
  private fixBrokenListRoots(doc: Document): void {
    // console.log('fixBrokenListRoots called', doc);
    const lis = doc.querySelectorAll('li');
    for (let i = 0; i < lis.length; i++) {
      const li = lis[i];
      const parent = li.parentElement;
      const parentTag = parent ? parent.tagName.toLowerCase() : '';

      // If <li> is already inside <ul> or <ol> — skip
      if (parentTag === 'ul' || parentTag === 'ol') continue;

      // If <li> directly wraps a list (nested <ul> or <ol>), treat that inner list as the root.
      let hasDirectListChild = false;
      for (let c = 0; c < li.children.length; c++) {
        const child = li.children[c];
        const tag = child.tagName.toLowerCase();
        if (tag === 'ul' || tag === 'ol') {
          hasDirectListChild = true;
          break;
        }
      }
      if (hasDirectListChild) {
        // Promote its inner list and remove the wrapping <li>
        const grandParent = li.parentElement;
        if (grandParent) {
          while (li.firstChild) grandParent.insertBefore(li.firstChild, li);
          grandParent.removeChild(li);
        }
        continue;
      }

      // Normal case: wrap orphan <li> into <ul>
      const ul = doc.createElement('ul');
      if (parent) {
        parent.replaceChild(ul, li);
        ul.appendChild(li);
      }
    }
  }

  /**
   * Keep wrapper list for deeper indent level (e.g. <ol><ol>…</ol></ol>)
   * Detect a list that contains exactly one LI with no label and only one sublist.
   * Replace so the wrapper directly contains the inner list; tag matches the inner list.
   */
  private foldDanglingWrapperListsKeepWrapper(doc: Document): void {
    function isList(el: Element | null): boolean {
      return (
        !!el &&
        (el.tagName.toLowerCase() === 'ul' || el.tagName.toLowerCase() === 'ol')
      );
    }

    function liHasMeaningfulContent(li: HTMLElement): boolean {
      for (let i = 0; i < li.childNodes.length; i++) {
        const n: any = li.childNodes[i];
        if (n.nodeType === 3) {
          const txt = (n.nodeValue || '').replace(/\u00A0/g, ' ').trim();
          if (txt.length > 0) return true;
        } else if (n.nodeType === 1) {
          const tag = (n as Element).tagName.toLowerCase();
          if (tag !== 'ul' && tag !== 'ol' && tag !== 'br') return true;
        }
      }
      return false;
    }

    function getSingleWrappedSublist(
      wrapperList: HTMLElement,
    ): HTMLElement | null {
      if (wrapperList.children.length !== 1) return null;
      const li = wrapperList.children[0] as HTMLElement;
      if (!li || li.tagName.toLowerCase() !== 'li') return null;
      if (liHasMeaningfulContent(li)) return null;

      let found: HTMLElement = null;
      for (let i = 0; i < li.children.length; i++) {
        const c = li.children[i] as HTMLElement;
        if (isList(c)) {
          if (found) return null;
          found = c;
        }
      }
      return found;
    }

    const lists = doc.querySelectorAll('ul, ol');
    for (let i = 0; i < lists.length; i++) {
      const list = lists[i] as HTMLElement;
      const inner = getSingleWrappedSublist(list);
      if (!inner) continue;
      const parent = list.parentElement;
      if (!parent) continue;

      const tag = inner.tagName.toLowerCase();
      if (list.tagName.toLowerCase() === tag) {
        // reuse same node: clear and append inner
        while (list.firstChild) list.removeChild(list.firstChild);
        list.appendChild(inner);
      } else {
        const newWrapper = doc.createElement(tag);
        newWrapper.appendChild(inner);
        parent.replaceChild(newWrapper, list);
      }
    }
  }

  /**
   * Merge <li> that have no label text but contain sublists into the previous <li>
   * (or hoist them to the list level if there is no previous <li>).
   */
  private mergeEmptyListItemsIntoPrevious(doc: Document): void {
    function isList(el: Element | null): boolean {
      return (
        !!el &&
        (el.tagName.toLowerCase() === 'ul' || el.tagName.toLowerCase() === 'ol')
      );
    }

    function liHasMeaningfulContent(li: HTMLElement): boolean {
      for (let i = 0; i < li.childNodes.length; i++) {
        const n: any = li.childNodes[i];
        if (n.nodeType === 3) {
          const txt = (n.nodeValue || '').replace(/\u00A0/g, ' ').trim();
          if (txt.length > 0) return true;
        } else if (n.nodeType === 1) {
          const tag = (n as Element).tagName.toLowerCase();
          if (tag !== 'ul' && tag !== 'ol' && tag !== 'br') return true;
        }
      }
      return false;
    }

    const lists = doc.querySelectorAll('ul, ol');
    for (let i = 0; i < lists.length; i++) {
      const list = lists[i] as HTMLElement;

      let li = list.firstElementChild as HTMLElement;
      while (li) {
        const next = li.nextElementSibling as HTMLElement;

        if (li.tagName.toLowerCase() === 'li' && !liHasMeaningfulContent(li)) {
          const subLists: HTMLElement[] = [];
          for (let k = 0; k < li.children.length; k++) {
            const c = li.children[k] as HTMLElement;
            if (isList(c)) subLists.push(c);
          }

          if (subLists.length > 0) {
            // find previous <li>
            let prev = li.previousElementSibling as HTMLElement;
            while (prev && prev.tagName.toLowerCase() !== 'li') {
              prev = prev.previousElementSibling as HTMLElement;
            }

            if (prev && prev.tagName.toLowerCase() === 'li') {
              // attach sublists after prev <li> (as siblings)
              let ref: ChildNode = prev.nextSibling;
              for (let s = 0; s < subLists.length; s++) {
                list.insertBefore(subLists[s], ref);
                ref = subLists[s].nextSibling;
              }
              list.removeChild(li);
              li = next;
              continue;
            } else {
              // unwrap to list level
              for (let s2 = 0; s2 < subLists.length; s2++) {
                list.insertBefore(subLists[s2], li);
              }
              list.removeChild(li);
              li = next;
              continue;
            }
          }
        }
        li = next;
      }
    }
  }

  /**
   * Move <ul>/<ol> out of <li> to be siblings (iText5-safe).
   */
  private hoistSublistsOutOfLiForIText(doc: Document): void {
    const lists = doc.querySelectorAll('ul, ol');
    for (let i = 0; i < lists.length; i++) {
      const list = lists[i] as HTMLElement;
      const children = list.children;
      // iterate over snapshot to avoid live-collection pitfalls
      const snapshot: HTMLElement[] = [];
      for (let k = 0; k < children.length; k++)
        snapshot.push(children[k] as HTMLElement);

      for (let j = 0; j < snapshot.length; j++) {
        const node = snapshot[j];
        if (node.tagName.toLowerCase() !== 'li') continue;

        const li = node as HTMLElement;

        // collect immediate sublists under li
        const sublists: HTMLElement[] = [];
        for (let c = 0; c < li.children.length; c++) {
          const sub = li.children[c] as HTMLElement;
          const t = sub.tagName.toLowerCase();
          if (t === 'ul' || t === 'ol') sublists.push(sub);
        }
        if (sublists.length === 0) continue;

        // remove <br> right before the first sublist
        const first = sublists[0];
        const prev = first.previousSibling;
        if (
          prev &&
          prev.nodeType === 1 &&
          (prev as Element).tagName.toLowerCase() === 'br'
        ) {
          li.removeChild(prev);
        }

        // move each sublist to be a sibling after li
        let insertRef: ChildNode = li.nextSibling;
        for (let s = 0; s < sublists.length; s++) {
          list.insertBefore(sublists[s], insertRef);
          insertRef = sublists[s].nextSibling;
        }
      }
    }
  }

  // ======================================================
  // HYGIENE
  // ======================================================

  /**
   * Removes empty paragraph, span, and div elements from the document.
   * Elements are considered empty if they contain only whitespace, &nbsp;, or br tags.
   * This cleanup helps maintain a cleaner document structure by eliminating unnecessary markup.
   *
   * @param doc The Document object to be processed
   */
  private removeEmptyTags(doc: Document): void {
    const tags = doc.querySelectorAll('p, span, div');
    tags.forEach((el) => {
      const content = el.innerHTML
        .trim()
        .replace(/&nbsp;/g, '')
        .replace(/<br\s*\/?>/gi, '')
        .trim();
      if (!content) {
        el.remove();
      }
    });
  }

  /**
   * Removes or modifies styles that could make content invisible or unreadable.
   * Processes style attributes to:
   * - Remove white-on-white or transparent color combinations
   * - Remove display:none and visibility:hidden
   * - Preserve only supported font families, colors, and text alignments
   * - Maintain semantic styling like bold and italic
   *
   * @param doc The Document object to be processed
   */
  private removeInvisibleStyles(doc: Document): void {
    const elements = doc.querySelectorAll<HTMLElement>('[style]');
    elements.forEach((el) => {
      const styleStr = el.getAttribute('style') || '';
      const rules = styleStr.split(';').filter((r) => r.trim());
      const newStyles: string[] = [];

      for (const rule of rules) {
        const [propRaw, valRaw] = rule.split(':');
        if (!propRaw || !valRaw) continue;

        const prop = propRaw.trim().toLowerCase();
        const val = valRaw.trim().toLowerCase();

        const isInvisibleColor =
          ['white', '#fff', '#ffffff', 'rgb(255,255,255)'].includes(val) ||
          (val.startsWith('rgba') && val.includes(', 0)'));

        if (prop === 'font-family' && val === 'times-roman') {
          newStyles.push(`${prop}: ${val}`);
        }
        if (
          prop === 'background-color' &&
          !isInvisibleColor &&
          val !== 'transparent'
        ) {
          newStyles.push(`${prop}: ${val}`);
        }
        if (prop === 'color' && !isInvisibleColor) {
          newStyles.push(`${prop}: ${val}`);
        }
        if (
          prop === 'text-align' &&
          ['left', 'center', 'right'].includes(val)
        ) {
          newStyles.push(`${prop}: ${val}`);
        }
        if (prop === 'font-weight' && val === 'bold') {
          newStyles.push(`${prop}: ${val}`);
        }
        if (prop === 'font-style' && val === 'italic') {
          newStyles.push(`${prop}: ${val}`);
        }
        if (prop === 'display' && val === 'none') continue;
        if (prop === 'visibility' && val === 'hidden') continue;
      }

      if (newStyles.length > 0) {
        el.setAttribute('style', newStyles.join('; '));
      } else {
        el.removeAttribute('style');
      }
    });
  }

  /**
   * Removes unnecessary span elements and optimizes document structure.
   * - Removes empty spans with no content or styles
   * - Unwraps spans that have content but no styling, preserving their inner content
   * - Retains spans that have meaningful styles applied
   *
   * @param doc The Document object to be processed
   */
  private unwrapEmptySpans(doc: Document): void {
    const spans = doc.querySelectorAll('span');
    spans.forEach((span) => {
      const content = span.textContent
        ? span.textContent.replace(/[\u0000-\b]/g, '').trim()
        : '';
      const hasStyle = span.getAttribute('style') ? span.getAttribute('style')?.trim() : '';

      if (!content && !hasStyle) {
        span.remove();
      } else if (!hasStyle) {
        const parent = span.parentNode!;
        while (span.firstChild) parent.insertBefore(span.firstChild, span);
        parent.removeChild(span);
      }
    });
  }

  /**
   * Fixes invalid HTML structure where inline elements wrap block-level elements.
   * Removes inline tags (like <b>, <i>, <u>, etc.) that incorrectly wrap block-level
   * elements while preserving the content hierarchy. This ensures proper HTML semantics
   * and prevents rendering issues.
   *
   * @param doc The Document object to be processed
   */
  private unwrapInlineWrappingBlock(doc: Document): void {
    const inlineTags = ['b', 'i', 'u', 'em', 'strong', 'span'];
    const blockTags = ['p', 'div', 'table', 'ul', 'ol', 'li'];

    inlineTags.forEach((inline) => {
      const elements = doc.querySelectorAll(inline);
      elements.forEach((el) => {
        for (const block of blockTags) {
          if (el.querySelector(block)) {
            const parent = el.parentNode!;
            while (el.firstChild) parent.insertBefore(el.firstChild, el);
            parent.removeChild(el);
            break;
          }
        }
      });
    });
  }

  private removeEmptyTables(doc: Document): void {
    const tables = doc.querySelectorAll('table');
    tables.forEach((table) => {
      const cells = table.querySelectorAll('td, th');
      let hasContent = false;

      cells.forEach((cell) => {
        const textContent = cell.textContent ? cell.textContent.trim() : '';
        const hasImage = cell.querySelector('img') !== null;
        const hasInput = cell.querySelector('input, textarea, select') !== null;
        const hasOtherElements =
          cell.querySelector('button, a, iframe, video, audio') !== null;
        if (
          textContent.length > 0 ||
          hasImage ||
          hasInput ||
          hasOtherElements
        ) {
          hasContent = true;
        }
      });

      if (!hasContent) {
        table.remove();
      }
    });
  }

  /**
   * Validates HTML content for PDF compatibility and proper structure.
   * Performs comprehensive checks for common issues that can cause problems
   * when converting HTML to PDF, including:
   * - List structure validation
   * - Block/inline element nesting
   * - Invisible or hidden content detection
   * - Color contrast and visibility issues
   *
   * @param html The HTML string to validate
   * @returns An object containing validation results:
   *          - valid: boolean indicating if the content passed all checks
   *          - errors: array of specific error messages if validation failed
   */
  validateEditorContentForPDF(html: string): {
    valid: boolean;
    errors: string[];
  } {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const errors: string[] = [];

    // -----------------------------
    // Helpers (Angular 9 / ES5-safe)
    // -----------------------------
    function isWhiteColor(v: string): boolean {
      const s = (v || '').trim().toLowerCase().replace(/\s+/g, '');
      return (
        s === 'white' ||
        s === '#fff' ||
        s === '#ffffff' ||
        s === 'rgb(255,255,255)' ||
        s === 'rgba(255,255,255,1)'
      );
    }
    function isTransparent(v: string): boolean {
      const s = (v || '').trim().toLowerCase();
      return (
        s === 'transparent' ||
        (s.indexOf('rgba') === 0 &&
          /\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)/.test(s))
      );
    }
    function getCssProp(styleStr: string, prop: string): string | null {
      const re = new RegExp(prop + '\\s*:\\s*([^;]+)', 'i');
      const m = re.exec(styleStr || '');
      return m ? m[1].trim() : null;
    }

    // -----------------------------------------------------------------
    // 2) Block elements inside inline wrappers (problematic in iText5)
    // -----------------------------------------------------------------
    const inlineTags = ['b', 'i', 'u', 'em', 'strong', 'span'];
    const blockTags = [ 'p', 'div', 'table', 'ul',  'ol','li', 'thead', 'tbody', 'tr', 'td', 'th', 'h1', 'h2', 'h3', 'h4',  'h5', 'h6',
    ];
    for (let t = 0; t < inlineTags.length; t++) {
      const inline = inlineTags[t];
      const nodes = doc.querySelectorAll(inline);
      for (let k = 0; k < nodes.length; k++) {
        const el = nodes[k];
        for (let b = 0; b < blockTags.length; b++) {
          if (el.querySelector(blockTags[b])) {
            errors.push(
              'Block content (<' +
              blockTags[b] +
              '>) is wrapped by <' +
              inline +
              '>. Remove the inline wrapper around blocks.',
            );
            break;
          }
        }
      }
    }

    // -----------------------------------------------------------------
    // 3) Invisible/hidden content (white-on-white, hidden, zero opacity)
    // -----------------------------------------------------------------
    const styled = doc.querySelectorAll('[style]');
    for (let i = 0; i < styled.length; i++) {
      const el = styled[i] as HTMLElement;
      const style = (el.getAttribute('style') || '').toLowerCase();

      // Hidden via display/visibility
      if (
        /display\s*:\s*none/.test(style) ||
        /visibility\s*:\s*hidden/.test(style)
      ) {
        errors.push(
          'Hidden content detected (display:none or visibility:hidden). Remove it before exporting to PDF.',
        );
      }

      // Invisible via opacity
      const opacity = getCssProp(style, 'opacity');
      if (opacity && parseFloat(opacity) === 0) {
        errors.push('Content with opacity:0 will be invisible in the PDF.');
      }

      // White-on-white (or white on transparent/no background)
      const color = getCssProp(style, 'color');
      const bg = getCssProp(style, 'background-color');
      if (color && isWhiteColor(color)) {
        if (!bg || isWhiteColor(bg) || isTransparent(bg)) {
          errors.push(
            'White text on white/transparent background will be invisible in the PDF.',
          );
        }
      }
    }

    return { valid: errors.length === 0, errors: errors };
  }
}
