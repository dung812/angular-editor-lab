import { Injectable } from '@angular/core';
import sanitizeHtml from 'sanitize-html';

/** Must match SAFE_INDENT_STEP_PX in the editor library. */
export const PDF_INDENT_STEP_PX = 40;
/** Must match MAX_SAFE_INDENT_PX in the editor library. */
export const PDF_MAX_INDENT_PX = 2000;
/** Persisted/PDF body size; the editor only displays it as 14px via CSS. */
export const PDF_BODY_FONT_SIZE_PX = 16;
export const PDF_MIN_FONT_SIZE_PX = 6;
export const PDF_MAX_FONT_SIZE_PX = 96;
export const PDF_DEFAULT_FONT_FAMILY = 'Arial';

/** Families iTextPDF 5 resolves; anything else falls back to Arial. */
export const PDF_SUPPORTED_FONT_FAMILIES: string[] = [
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Times-Roman',
  'Calibri',
  'Comic Sans MS',
];

/** Explicit heading sizes so iText never infers them. */
export const PDF_HEADING_FONT_SIZE_PX: { [tag: string]: number } = {
  h1: 32,
  h2: 24,
  h3: 19,
  h4: 16,
  h5: 13,
  h6: 11,
};

/** Same table the editor uses for `<font size="N">`. */
const LEGACY_FONT_SIZE_PX: { [size: string]: number } = {
  '1': 10,
  '2': 13,
  '3': 16,
  '4': 18,
  '5': 24,
  '6': 32,
  '7': 48,
};

const TEXT_BEARING_TAGS =
  /^(DIV|P|PRE|SPAN|LI|TD|TH|A|B|I|U|EM|STRONG|STRIKE|SUB|SUP|H1|H2|H3|H4|H5|H6)$/;

/** Elements a `<p>` cannot contain. */
const BLOCK_CONTENT_SELECTOR =
  'address, article, aside, blockquote, div, dl, fieldset, figure, ' +
  'footer, form, h1, h2, h3, h4, h5, h6, header, hr, main, nav, ' +
  'ol, p, pre, section, table, ul';

/** Shared by Reformat and Validate so Reformat always fixes what Validate reports. */
const INLINE_TAGS = ['b', 'i', 'u', 'strike', 'em', 'strong', 'span', 'sub', 'sup', 'a'];
const BLOCK_TAGS = [
  'p', 'div', 'table', 'ul', 'ol', 'li', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'hr',
];

/** Serialization order of the only style properties the cleaner keeps. */
const STYLE_ORDER = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'color',
  'background-color',
  'text-align',
  'margin-left',
];
const PRESENTATION_STYLES = STYLE_ORDER.filter(property => property !== 'margin-left');

const NORMALIZED_INDENT_ATTR = 'data-ae-normalized-indent';

@Injectable({ providedIn: 'root' })
export class HtmlCleanerService {
  /**
   * Returns canonical PDF-safe HTML (idempotent). Legacy formatting is
   * converted in an inert document first, and that output still goes through
   * the sanitize-html allowlist.
   */
  sanitize(html: string): string {
    const raw = typeof html === 'string' ? html : '';
    if (raw.replace(/\s/g, '') === '') {
      return '';
    }

    let preNormalized: string;
    try {
      preNormalized = this.preNormalizeLegacyFormatting(raw);
    } catch (_error) {
      preNormalized = raw;
    }

    const sanitized = sanitizeHtml(preNormalized, {
      allowedTags: [
        'p', 'br', 'b', 'i', 'u', 'strike', 'strong', 'em', 'sub', 'sup',
        'ul', 'ol', 'li',
        'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
        'span', 'div', 'img', 'a', 'pre', 'hr',
        // Input only: converted to paragraphs by cleanDOM().
        'blockquote',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      ],
      allowedAttributes: {
        '*': ['style', 'align'],
        a: ['href', 'target', 'title', 'rel'],
        img: ['src', 'srcset', 'alt', 'title', 'width', 'height', 'loading'],
        td: ['colspan', 'rowspan'],
        th: ['colspan', 'rowspan', 'scope'],
      },
      allowedSchemes: ['http', 'https', 'mailto'],
      allowedSchemesByTag: {
        img: ['http', 'https', 'data'],
      },
      allowProtocolRelative: false,
      transformTags: {
        a: (tagName: string, attribs: { [key: string]: string }) => {
          const next: { [key: string]: string } = {};
          if (attribs.href) { next.href = attribs.href; }
          if (attribs.title) { next.title = attribs.title; }
          if (attribs.style) { next.style = attribs.style; }
          if (attribs.target === '_blank') {
            next.target = '_blank';
            next.rel = 'noopener noreferrer';
          }
          return { tagName: 'a', attribs: next };
        },
      },
      allowedStyles: {
        '*': {
          // No parentheses allowed, which rules out url() and expression().
          'font-family': [/^[a-z0-9 ,'"-]{1,120}$/i],
          'font-size': [/^\d{1,4}(?:\.\d{1,3})?(?:px|pt|em|rem|%)$/i],
          'background-color': [
            /^(?!transparent$|white$|#fff$|#ffffff$)(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%]{1,40}\)|[a-z]{3,24})$/i,
          ],
          'color': [
            /^(?!white$|#fff$|#ffffff$)(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%]{1,40}\)|[a-z]{3,24})$/i,
          ],
          'text-align': [/^left$/i, /^right$/i, /^center$/i, /^justify$/i],
          'font-weight': [/^bold$/i, /^[5-9]00$/],
          'font-style': [/^italic$/i],
          'margin-left': [/^(?:0|[1-9]\d{0,3}(?:\.\d+)?)px$/i],
        },
        blockquote: {
          // Chrome's execCommand('indent') output, needed only if pre-normalization failed.
          'margin': [/^0(?:px)?\s+0(?:px)?\s+0(?:px)?\s+(?:0|[1-9]\d{0,3}(?:\.\d+)?)px$/i],
          'border': [/^none$/i],
          'padding': [/^0(?:px)?$/i],
        },
      },
      selfClosing: ['img', 'br', 'hr'],
    });

    return this.cleanDOM(sanitized);
  }

  // --- Pre-normalization (before sanitize-html, which would drop this information) ---

  private preNormalizeLegacyFormatting(html: string): string {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (!doc || !doc.body) {
      return html;
    }

    this.normalizeLegacyFontTags(doc);
    this.normalizeStrikeThrough(doc);
    this.normalizeIndentationSources(doc);

    return doc.body.innerHTML;
  }

  /** `<font face size color>` -> `<span style="...">`. */
  private normalizeLegacyFontTags(doc: Document): void {
    const fonts = this.snapshot(doc.querySelectorAll('font'));
    for (let i = 0; i < fonts.length; i++) {
      const font = fonts[i];
      if (!font.parentNode) { continue; }

      const span = doc.createElement('span');

      const family = this.resolveFontFamily(font.getAttribute('face'), '');
      if (family) { span.style.setProperty('font-family', family); }

      const size = (font.getAttribute('size') || '').trim();
      if (LEGACY_FONT_SIZE_PX[size] !== undefined) {
        span.style.setProperty('font-size', LEGACY_FONT_SIZE_PX[size] + 'px');
      }

      const color = (font.getAttribute('color') || '').trim();
      if (/^(#[0-9a-f]{3,8}|[a-z]{3,24})$/i.test(color)) {
        span.style.setProperty('color', color);
      }

      while (font.firstChild) { span.appendChild(font.firstChild); }
      font.parentNode.replaceChild(span, font);
    }
  }

  /**
   * Browsers emit `<strike>`, `<s>` or a line-through span for the same command.
   * `text-decoration` is not allowlisted, so line-through becomes `<strike>`.
   */
  private normalizeStrikeThrough(doc: Document): void {
    const legacy = this.snapshot(doc.querySelectorAll('s, del'));
    for (let i = 0; i < legacy.length; i++) {
      const el = legacy[i];
      if (!el.parentNode) { continue; }
      const strike = doc.createElement('strike');
      while (el.firstChild) { strike.appendChild(el.firstChild); }
      el.parentNode.replaceChild(strike, el);
    }

    const styled = this.snapshot(doc.querySelectorAll('[style]'));
    for (let i = 0; i < styled.length; i++) {
      const el = styled[i];
      const decoration = (el.style.textDecoration || '').toLowerCase();
      el.style.removeProperty('text-decoration');
      el.style.removeProperty('text-decoration-line');
      if (decoration.indexOf('line-through') === -1 || !el.parentNode) {
        continue;
      }
      const strike = doc.createElement('strike');
      while (el.firstChild) { strike.appendChild(el.firstChild); }
      el.appendChild(strike);
    }
  }

  /** Converts pasted indentation (margin, padding-left, `ql-indent-N`) into `margin-left: Npx`. */
  private normalizeIndentationSources(doc: Document): void {
    const candidates = this.snapshot(doc.querySelectorAll('[style], [class]'));
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      const indent = this.readIndentSourcePx(el);

      // Drop every other indentation carrier so nothing is counted twice.
      el.style.removeProperty('margin');
      el.style.removeProperty('padding-left');
      el.style.removeProperty('padding');
      el.style.removeProperty('text-indent');

      if (indent > 0) {
        el.style.setProperty('margin-left', this.boundIndent(indent) + 'px');
      } else {
        el.style.removeProperty('margin-left');
      }

      if (!el.getAttribute('style')) { el.removeAttribute('style'); }
    }
  }

  private readIndentSourcePx(el: HTMLElement): number {
    const direct = this.toPixels(el.style.marginLeft);
    if (direct > 0) { return direct; }

    const shorthand = this.toPixels(this.marginShorthandLeft(el.style.margin));
    if (shorthand > 0) { return shorthand; }

    // Padding on a bordered or coloured box is decoration, not indentation.
    const paddingLeft = this.toPixels(el.style.paddingLeft);
    if (paddingLeft > 0 && !el.style.border && !el.style.backgroundColor) {
      return paddingLeft;
    }

    const quill = /(?:^|\s)ql-indent-([1-9]\d?)(?:\s|$)/.exec(el.getAttribute('class') || '');
    return quill ? Number(quill[1]) * PDF_INDENT_STEP_PX : 0;
  }

  private marginShorthandLeft(shorthand: string): string {
    const parts = (shorthand || '').trim().split(/\s+/);
    if (parts[0] === '') { return ''; }
    if (parts.length === 1) { return parts[0]; }
    if (parts.length === 2 || parts.length === 3) { return parts[1]; }
    return parts[3];
  }

  /** Returns 0 for unrecognized or non-positive lengths. */
  private toPixels(value: string): number {
    const match = /^(\d{1,5}(?:\.\d{1,3})?)(px|pt|em|rem|in|cm)$/i.exec((value || '').trim());
    if (!match) { return 0; }
    const amount = Number(match[1]);
    if (!isFinite(amount) || amount <= 0) { return 0; }

    switch (match[2].toLowerCase()) {
      case 'px': return amount;
      case 'pt': return amount * 4 / 3;
      case 'em': return amount * PDF_BODY_FONT_SIZE_PX;
      case 'rem': return amount * PDF_BODY_FONT_SIZE_PX;
      case 'in': return amount * 96;
      case 'cm': return amount * 96 / 2.54;
      default: return 0;
    }
  }

  private boundIndent(px: number): number {
    return Math.round(Math.max(0, Math.min(px, PDF_MAX_INDENT_PX)));
  }

  // --- DOM normalization ---

  /**
   * The root container is created after the DIV-to-P conversions so a second
   * pass sees the same shape, and typography runs last so the root is styled too.
   */
  private cleanDOM(html: string): string {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (!doc || !doc.body) { return ''; }

    this.fixBrokenListRoots(doc);
    this.foldDanglingWrapperListsKeepWrapper(doc);
    this.mergeEmptyListItemsIntoPrevious(doc);
    this.hoistSublistsOutOfLiForIText(doc);

    this.convertBlockquoteIndentationToParagraphs(doc);
    this.convertTextOnlyDivsToParagraphs(doc);

    this.removeUnsafeAnchors(doc);
    this.removeEmptyTags(doc);
    this.removeInvisibleStyles(doc);
    this.unwrapEmptySpans(doc);
    this.unwrapInlineWrappingBlock(doc);
    this.removeEmptyTables(doc);

    this.ensureSingleRootContainer(doc);
    this.trimEdgeBlankLines(doc);
    this.normalizeTypography(doc);
    this.canonicalizeStyleOrder(doc);

    return doc.body.innerHTML;
  }

  /** iText gets exactly one root `<div>`; loose top-level inline content goes into `<p>`s. */
  private ensureSingleRootContainer(doc: Document): void {
    const body = doc.body;
    if (!body) { return; }

    const hasContent = this.childNodesOf(body).some(node =>
      node.nodeType === 1 || (node.nodeType === 3 && this.textOf(node).length > 0));
    if (!hasContent) {
      while (body.firstChild) { body.removeChild(body.firstChild); }
      return;
    }

    this.wrapLooseInlineRuns(doc, body);

    if (
      body.childElementCount === 1 &&
      body.firstElementChild &&
      body.firstElementChild.tagName.toLowerCase() === 'div' &&
      !this.hasTopLevelText(body)
    ) {
      return;
    }

    const wrapper = doc.createElement('div');
    const children = this.childNodesOf(body);
    for (let i = 0; i < children.length; i++) { wrapper.appendChild(children[i]); }
    body.appendChild(wrapper);
  }

  private wrapLooseInlineRuns(doc: Document, host: HTMLElement): void {
    const runs: Node[][] = [];
    let run: Node[] | null = null;
    const children = this.childNodesOf(host);
    for (let i = 0; i < children.length; i++) {
      const node = children[i];
      if (node.nodeType === 1 && this.isBlockLevelTag((node as HTMLElement).tagName)) {
        run = null;
        continue;
      }
      if (node.nodeType !== 1 && node.nodeType !== 3) { continue; }
      if (!run) { run = []; runs.push(run); }
      run.push(node);
    }

    for (let r = 0; r < runs.length; r++) {
      const nodes = runs[r];
      const meaningful = nodes.some(node => node.nodeType === 1 || this.textOf(node).length > 0);
      if (!meaningful) { continue; }

      const paragraph = doc.createElement('p');
      host.insertBefore(paragraph, nodes[0]);
      for (let n = 0; n < nodes.length; n++) { paragraph.appendChild(nodes[n]); }
    }
  }

  private isBlockLevelTag(tagName: string): boolean {
    return /^(P|DIV|H1|H2|H3|H4|H5|H6|PRE|UL|OL|LI|TABLE|THEAD|TBODY|TFOOT|TR|TD|TH|BLOCKQUOTE|HR)$/
      .test(tagName);
  }

  private hasTopLevelText(body: HTMLElement): boolean {
    return this.childNodesOf(body).some(node => node.nodeType === 3 && this.textOf(node).length > 0);
  }

  /** A fixed property order keeps the serialized output byte-identical across passes. */
  private canonicalizeStyleOrder(doc: Document): void {
    const elements = this.snapshot(doc.querySelectorAll('[style]'));
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      const values: { [property: string]: string } = {};
      for (let s = 0; s < el.style.length; s++) {
        const property = el.style.item(s).toLowerCase();
        values[property] = el.style.getPropertyValue(property);
      }

      el.removeAttribute('style');
      for (let o = 0; o < STYLE_ORDER.length; o++) {
        if (values[STYLE_ORDER[o]] !== undefined) {
          el.style.setProperty(STYLE_ORDER[o], values[STYLE_ORDER[o]]);
        }
      }
      if (!el.getAttribute('style')) { el.removeAttribute('style'); }
    }
  }

  // --- Indentation ---

  /**
   * Chrome's execCommand('indent') nests a blockquote plus one div per extra
   * level, which iText 5 XML Worker handles poorly. Each one becomes a single
   * flat block with margin-left.
   */
  private convertBlockquoteIndentationToParagraphs(doc: Document): void {
    const blockquotes = this.snapshot(doc.querySelectorAll('blockquote'));

    // Deepest first, so an outer quote can absorb an already-normalized inner one.
    for (let i = blockquotes.length - 1; i >= 0; i--) {
      const blockquote = blockquotes[i];
      if (!blockquote.parentNode) { continue; }

      const chain = this.getSingleDivChain(blockquote);
      const containsNormalizedChild =
        blockquote.querySelector('[' + NORMALIZED_INDENT_ATTR + ']') !== null;

      let indentPx = this.readIndentPx(blockquote);
      if (indentPx <= 0) { indentPx = PDF_INDENT_STEP_PX; }
      for (let c = 0; c < chain.length; c++) {
        indentPx += this.readIndentPx(chain[c]);
      }

      // Every wrapper div after the first is one more level, unless a nested
      // normalized block already carries that indentation explicitly.
      if (!containsNormalizedChild && chain.length > 1) {
        indentPx += (chain.length - 1) * PDF_INDENT_STEP_PX;
      }

      const contentSource: HTMLElement =
        chain.length > 0 ? chain[chain.length - 1] : blockquote;

      const absorbTarget = this.singleNormalizedChild(contentSource);
      if (absorbTarget) {
        const merged = this.readIndentPx(absorbTarget) + indentPx;
        absorbTarget.style.marginLeft = this.boundIndent(merged) + 'px';
        blockquote.parentNode.replaceChild(absorbTarget, blockquote);
        continue;
      }

      const useDiv = this.containsBlockContent(contentSource);
      const replacement = doc.createElement(useDiv ? 'div' : 'p');

      this.copyPresentationStyles([blockquote].concat(chain), replacement);
      replacement.style.marginLeft = this.boundIndent(indentPx) + 'px';
      replacement.setAttribute(NORMALIZED_INDENT_ATTR, 'true');

      while (contentSource.firstChild) {
        replacement.appendChild(contentSource.firstChild);
      }

      blockquote.parentNode.replaceChild(replacement, blockquote);
    }

    const normalized = doc.querySelectorAll('[' + NORMALIZED_INDENT_ATTR + ']');
    for (let i = 0; i < normalized.length; i++) {
      normalized[i].removeAttribute(NORMALIZED_INDENT_ATTR);
    }
  }

  private singleNormalizedChild(container: HTMLElement): HTMLElement | null {
    let found: HTMLElement | null = null;
    for (let i = 0; i < container.childNodes.length; i++) {
      const node = container.childNodes[i];
      if (node.nodeType === 3) {
        if (this.textOf(node).length > 0) { return null; }
        continue;
      }
      if (node.nodeType !== 1) { continue; }
      if (found) { return null; }
      found = node as HTMLElement;
    }
    return found && found.hasAttribute(NORMALIZED_INDENT_ATTR) ? found : null;
  }

  /** iTextPDF 5 may ignore margin-left on a div, so text-only divs become paragraphs. */
  private convertTextOnlyDivsToParagraphs(doc: Document): void {
    const divs = this.snapshot(doc.querySelectorAll('div'));

    for (let i = 0; i < divs.length; i++) {
      const div = divs[i];
      if (!div.parentNode || this.containsBlockContent(div)) { continue; }

      const replacement = doc.createElement('p');
      this.copyPresentationStyles([div], replacement);

      const indentPx = this.readIndentPx(div);
      if (indentPx > 0) {
        replacement.style.marginLeft = this.boundIndent(indentPx) + 'px';
      }

      const align = div.getAttribute('align');
      if (align) { replacement.setAttribute('align', align); }

      while (div.firstChild) { replacement.appendChild(div.firstChild); }
      div.parentNode.replaceChild(replacement, div);
    }
  }

  private containsBlockContent(element: HTMLElement): boolean {
    return element.querySelector(BLOCK_CONTENT_SELECTOR) !== null;
  }

  /** Nested divs where each level holds exactly one div and no text. */
  private getSingleDivChain(container: HTMLElement): HTMLElement[] {
    const chain: HTMLElement[] = [];
    let current = container;

    while (current) {
      let onlyDiv: HTMLElement | null = null;
      let canCollapse = true;

      for (let i = 0; i < current.childNodes.length; i++) {
        const node = current.childNodes[i];
        if (node.nodeType === 3) {
          if (this.textOf(node).length > 0) { canCollapse = false; break; }
          continue;
        }
        if (node.nodeType !== 1) { continue; }

        const element = node as HTMLElement;
        if (element.tagName.toLowerCase() !== 'div' || onlyDiv) {
          canCollapse = false;
          break;
        }
        onlyDiv = element;
      }

      if (!canCollapse || !onlyDiv) { break; }
      chain.push(onlyDiv);
      current = onlyDiv;
    }

    return chain;
  }

  private readIndentPx(element: HTMLElement): number {
    const direct = /^(\d+(?:\.\d+)?)px$/i.exec((element.style.marginLeft || '').trim());
    if (direct) { return Number(direct[1]); }

    const shorthand = /^(\d+(?:\.\d+)?)px$/i.exec(
      this.marginShorthandLeft(element.style.margin),
    );
    return shorthand ? Number(shorthand[1]) : 0;
  }

  private copyPresentationStyles(sources: HTMLElement[], target: HTMLElement): void {
    for (let i = 0; i < sources.length; i++) {
      const sourceStyle = sources[i].style;
      for (let s = 0; s < sourceStyle.length; s++) {
        const property = sourceStyle.item(s).toLowerCase();
        if (PRESENTATION_STYLES.indexOf(property) === -1) { continue; }
        target.style.setProperty(
          property,
          sourceStyle.getPropertyValue(property),
          sourceStyle.getPropertyPriority(property),
        );
      }
    }
  }

  // --- Typography ---

  /** Browsers and iText resolve inheritance differently, so every text element gets explicit values. */
  private normalizeTypography(doc: Document): void {
    const body = doc.body;
    if (!body) { return; }
    for (let i = 0; i < body.children.length; i++) {
      this.applyTypography(
        body.children[i] as HTMLElement,
        PDF_DEFAULT_FONT_FAMILY,
        PDF_BODY_FONT_SIZE_PX,
      );
    }
  }

  private applyTypography(
    element: HTMLElement,
    inheritedFamily: string,
    inheritedSizePx: number,
  ): void {
    const tag = element.tagName.toLowerCase();
    const family = this.resolveFontFamily(element.style.fontFamily, inheritedFamily);

    const declaredSize = this.resolveFontSizePx(element.style.fontSize, inheritedSizePx);
    let sizePx: number;
    if (declaredSize !== null) {
      sizePx = declaredSize;
    } else if (PDF_HEADING_FONT_SIZE_PX[tag] !== undefined) {
      sizePx = PDF_HEADING_FONT_SIZE_PX[tag];
    } else {
      sizePx = inheritedSizePx;
    }

    if (TEXT_BEARING_TAGS.test(element.tagName)) {
      element.style.setProperty('font-family', family);
      element.style.setProperty('font-size', sizePx + 'px');
    }

    for (let i = 0; i < element.children.length; i++) {
      this.applyTypography(element.children[i] as HTMLElement, family, sizePx);
    }
  }

  /** First supported family in the declared font stack, otherwise `fallback`. */
  private resolveFontFamily(declared: string | null, fallback: string): string {
    if (!declared) { return fallback; }
    const candidates = declared.split(',');
    for (let i = 0; i < candidates.length; i++) {
      const name = candidates[i].replace(/["']/g, '').trim().toLowerCase();
      for (let s = 0; s < PDF_SUPPORTED_FONT_FAMILIES.length; s++) {
        if (PDF_SUPPORTED_FONT_FAMILIES[s].toLowerCase() === name) {
          return PDF_SUPPORTED_FONT_FAMILIES[s];
        }
      }
    }
    return fallback;
  }

  /** `em`/`%` are relative to the inherited size, `rem` to the body size; `null` when not recognized. */
  private resolveFontSizePx(declared: string, inheritedSizePx: number): number | null {
    const match = /^(\d{1,4}(?:\.\d{1,3})?)(px|pt|em|rem|%)$/i.exec((declared || '').trim());
    if (!match) { return null; }

    const amount = Number(match[1]);
    if (!isFinite(amount) || amount <= 0) { return null; }

    let px: number;
    switch (match[2].toLowerCase()) {
      case 'px': px = amount; break;
      case 'pt': px = amount * 4 / 3; break;
      case 'em': px = amount * inheritedSizePx; break;
      case 'rem': px = amount * PDF_BODY_FONT_SIZE_PX; break;
      case '%': px = amount / 100 * inheritedSizePx; break;
      default: return null;
    }

    return Math.round(
      Math.max(PDF_MIN_FONT_SIZE_PX, Math.min(px, PDF_MAX_FONT_SIZE_PX)),
    );
  }

  // --- List structure ---

  /** Wraps any `<li>` outside a UL/OL into a `<ul>`. */
  private fixBrokenListRoots(doc: Document): void {
    const lis = doc.querySelectorAll('li');
    for (let i = 0; i < lis.length; i++) {
      const li = lis[i];
      const parent = li.parentElement;
      if (this.isList(parent)) { continue; }

      let hasDirectListChild = false;
      for (let c = 0; c < li.children.length; c++) {
        if (this.isList(li.children[c])) { hasDirectListChild = true; break; }
      }
      if (hasDirectListChild) {
        // The inner list becomes the root; the wrapping <li> is dropped.
        if (parent) {
          while (li.firstChild) { parent.insertBefore(li.firstChild, li); }
          parent.removeChild(li);
        }
        continue;
      }

      if (parent) {
        const ul = doc.createElement('ul');
        parent.replaceChild(ul, li);
        ul.appendChild(li);
      }
    }
  }

  /**
   * A list holding one label-less `<li>` with a single sublist is a deeper
   * indent level; the wrapper keeps the sublist directly, with the sublist's tag.
   */
  private foldDanglingWrapperListsKeepWrapper(doc: Document): void {
    const lists = doc.querySelectorAll('ul, ol');
    for (let i = 0; i < lists.length; i++) {
      const list = lists[i] as HTMLElement;
      const inner = this.getSingleWrappedSublist(list);
      if (!inner) { continue; }
      const parent = list.parentElement;
      if (!parent) { continue; }

      const tag = inner.tagName.toLowerCase();
      if (list.tagName.toLowerCase() === tag) {
        while (list.firstChild) { list.removeChild(list.firstChild); }
        list.appendChild(inner);
      } else {
        const newWrapper = doc.createElement(tag);
        newWrapper.appendChild(inner);
        parent.replaceChild(newWrapper, list);
      }
    }
  }

  private getSingleWrappedSublist(wrapperList: HTMLElement): HTMLElement | null {
    if (wrapperList.children.length !== 1) { return null; }
    const li = wrapperList.children[0] as HTMLElement;
    if (!li || li.tagName.toLowerCase() !== 'li') { return null; }
    if (this.liHasMeaningfulContent(li)) { return null; }

    let found: HTMLElement | null = null;
    for (let i = 0; i < li.children.length; i++) {
      const child = li.children[i] as HTMLElement;
      if (this.isList(child)) {
        if (found) { return null; }
        found = child;
      }
    }
    return found;
  }

  private isList(el: Element | null): boolean {
    if (!el) { return false; }
    const tag = el.tagName.toLowerCase();
    return tag === 'ul' || tag === 'ol';
  }

  private liHasMeaningfulContent(li: HTMLElement): boolean {
    for (let i = 0; i < li.childNodes.length; i++) {
      const node = li.childNodes[i];
      if (node.nodeType === 3) {
        if (this.textOf(node).length > 0) { return true; }
      } else if (node.nodeType === 1) {
        const tag = (node as Element).tagName.toLowerCase();
        if (tag !== 'ul' && tag !== 'ol' && tag !== 'br') { return true; }
      }
    }
    return false;
  }

  /** Sublists of a label-less `<li>` move after the previous `<li>`, or to list level. */
  private mergeEmptyListItemsIntoPrevious(doc: Document): void {
    const lists = doc.querySelectorAll('ul, ol');
    for (let i = 0; i < lists.length; i++) {
      const list = lists[i] as HTMLElement;

      let li = list.firstElementChild as HTMLElement;
      while (li) {
        const next = li.nextElementSibling as HTMLElement;

        if (li.tagName.toLowerCase() === 'li' && !this.liHasMeaningfulContent(li)) {
          const subLists: HTMLElement[] = [];
          for (let k = 0; k < li.children.length; k++) {
            const child = li.children[k] as HTMLElement;
            if (this.isList(child)) { subLists.push(child); }
          }

          if (subLists.length > 0) {
            let prev = li.previousElementSibling as HTMLElement;
            while (prev && prev.tagName.toLowerCase() !== 'li') {
              prev = prev.previousElementSibling as HTMLElement;
            }

            if (prev) {
              let ref: ChildNode | null = prev.nextSibling;
              for (let s = 0; s < subLists.length; s++) {
                list.insertBefore(subLists[s], ref);
                ref = subLists[s].nextSibling;
              }
            } else {
              for (let s = 0; s < subLists.length; s++) {
                list.insertBefore(subLists[s], li);
              }
            }
            list.removeChild(li);
          }
        }
        li = next;
      }
    }
  }

  /** iText 5 needs sublists as siblings of `<li>`, not children. */
  private hoistSublistsOutOfLiForIText(doc: Document): void {
    const lists = doc.querySelectorAll('ul, ol');
    for (let i = 0; i < lists.length; i++) {
      const list = lists[i] as HTMLElement;
      const items = this.snapshot(list.children);

      for (let j = 0; j < items.length; j++) {
        const li = items[j];
        if (li.tagName.toLowerCase() !== 'li') { continue; }

        const sublists: HTMLElement[] = [];
        for (let c = 0; c < li.children.length; c++) {
          const sub = li.children[c] as HTMLElement;
          if (this.isList(sub)) { sublists.push(sub); }
        }
        if (sublists.length === 0) { continue; }

        const prev = sublists[0].previousSibling;
        if (prev && prev.nodeType === 1 &&
            (prev as Element).tagName.toLowerCase() === 'br') {
          li.removeChild(prev);
        }

        let insertRef: ChildNode | null = li.nextSibling;
        for (let s = 0; s < sublists.length; s++) {
          list.insertBefore(sublists[s], insertRef);
          insertRef = sublists[s].nextSibling;
        }
      }
    }
  }

  // --- Hygiene ---

  /** An anchor whose href failed scheme validation degrades to plain text. */
  private removeUnsafeAnchors(doc: Document): void {
    const anchors = this.snapshot(doc.querySelectorAll('a'));
    for (let i = 0; i < anchors.length; i++) {
      const anchor = anchors[i];
      const href = (anchor.getAttribute('href') || '').trim();
      if (/^(https?:|mailto:)/i.test(href)) { continue; }
      this.unwrap(anchor);
    }
  }

  /** Removes p/span/div holding nothing but whitespace, `&nbsp;` or `<br>`. */
  private removeEmptyTags(doc: Document): void {
    const tags = this.snapshot(doc.querySelectorAll('p, span, div'));
    // Innermost first, so a wrapper emptied by removing its children is seen as empty too.
    for (let i = tags.length - 1; i >= 0; i--) {
      const el = tags[i];
      if (!el.parentNode || !this.hasNoVisibleContent(el)) { continue; }

      if (el.tagName === 'SPAN') {
        // Unwrap rather than remove: a styled <span><br></span> is often the only thing marking a blank line.
        this.unwrap(el);
      } else if (this.rendersAsBlankLine(el)) {
        this.normalizeBlankLine(doc, el);
      } else {
        el.parentNode.removeChild(el);
      }
    }
  }

  private hasNoVisibleContent(el: HTMLElement): boolean {
    return (el.textContent || '').replace(/ /g, ' ').trim() === '' &&
      el.querySelector(':not(br):not(span)') === null;
  }

  /** `<p><br></p>` and `<p>&nbsp;</p>` are lines the user left blank; a bare `<p></p>` has no height. */
  private rendersAsBlankLine(el: HTMLElement): boolean {
    return el.querySelector('br') !== null || (el.textContent || '').indexOf(' ') !== -1;
  }

  private normalizeBlankLine(doc: Document, el: HTMLElement): void {
    while (el.firstChild) { el.removeChild(el.firstChild); }
    el.appendChild(doc.createElement('br'));
  }

  /** Blank lines are kept between paragraphs but not at the start or end of the content. */
  private trimEdgeBlankLines(doc: Document): void {
    const root = doc.body.firstElementChild;
    if (!root) { return; }

    while (root.firstElementChild && this.isBlankLine(root.firstElementChild)) {
      root.removeChild(root.firstElementChild);
    }
    while (root.lastElementChild && this.isBlankLine(root.lastElementChild)) {
      root.removeChild(root.lastElementChild);
    }
    if (!root.firstElementChild && (root.textContent || '').trim() === '') {
      doc.body.removeChild(root);
    }
  }

  private isBlankLine(el: Element): boolean {
    return el.tagName === 'P' && el.childNodes.length === 1 && el.firstChild!.nodeName === 'BR';
  }

  /**
   * Rebuilds each style attribute from the parsed CSSOM; splitting the raw
   * attribute on ':' would corrupt values that contain colons.
   */
  private removeInvisibleStyles(doc: Document): void {
    const elements = this.snapshot(doc.querySelectorAll('[style]'));
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      const declarations: string[][] = [];

      for (let s = 0; s < el.style.length; s++) {
        const property = el.style.item(s).toLowerCase();
        const accepted = this.acceptDeclaration(property, el.style.getPropertyValue(property).trim());
        if (accepted !== null) { declarations.push([property, accepted]); }
      }

      el.removeAttribute('style');
      for (let d = 0; d < declarations.length; d++) {
        el.style.setProperty(declarations[d][0], declarations[d][1]);
      }
      if (!el.getAttribute('style')) { el.removeAttribute('style'); }
    }
  }

  /** The normalized value to keep, or `null` to drop the declaration. */
  private acceptDeclaration(property: string, value: string): string | null {
    const lower = value.toLowerCase();

    switch (property) {
      case 'font-family': {
        const family = this.resolveFontFamily(value, '');
        return family ? family : null;
      }
      case 'font-size':
        return /^\d{1,4}(?:\.\d{1,3})?(px|pt|em|rem|%)$/i.test(value) ? value : null;
      case 'background-color':
      case 'color':
        return this.isWhiteColor(value) || this.isTransparentColor(value) ? null : value;
      case 'text-align':
        return ['left', 'center', 'right', 'justify'].indexOf(lower) >= 0 ? lower : null;
      case 'font-weight':
        return (lower === 'bold' || /^[5-9]00$/.test(lower)) ? 'bold' : null;
      case 'font-style':
        return lower === 'italic' ? 'italic' : null;
      case 'margin-left': {
        const indent = /^(\d+(?:\.\d+)?)px$/i.exec(lower);
        if (!indent) { return null; }
        const px = Number(indent[1]);
        return px > 0 && px <= PDF_MAX_INDENT_PX ? px + 'px' : null;
      }
      default:
        return null;
    }
  }

  /** Removes empty unstyled spans and unwraps unstyled spans with content. */
  private unwrapEmptySpans(doc: Document): void {
    const spans = this.snapshot(doc.querySelectorAll('span'));
    for (let i = 0; i < spans.length; i++) {
      const span = spans[i];
      const parent = span.parentNode;
      if (!parent || (span.getAttribute('style') || '').trim()) { continue; }

      const content = (span.textContent || '').replace(/[\u0000-\b]/g, '').trim();
      if (content) {
        this.unwrap(span);
      } else {
        parent.removeChild(span);
      }
    }
  }

  /** iText 5 cannot lay out a block nested inside an inline element. */
  private unwrapInlineWrappingBlock(doc: Document): void {
    for (let t = 0; t < INLINE_TAGS.length; t++) {
      const elements = this.snapshot(doc.querySelectorAll(INLINE_TAGS[t]));
      for (let e = 0; e < elements.length; e++) {
        if (elements[e].parentNode && this.findWrappedBlockTag(elements[e]) !== null) {
          this.unwrap(elements[e]);
        }
      }
    }
  }

  private findWrappedBlockTag(inline: Element): string | null {
    for (let b = 0; b < BLOCK_TAGS.length; b++) {
      if (inline.querySelector(BLOCK_TAGS[b])) { return BLOCK_TAGS[b]; }
    }
    return null;
  }

  private removeEmptyTables(doc: Document): void {
    const tables = this.snapshot(doc.querySelectorAll('table'));
    for (let i = 0; i < tables.length; i++) {
      const table = tables[i];
      if (!table.parentNode) { continue; }
      const cells = table.querySelectorAll('td, th');
      let hasContent = false;

      for (let c = 0; c < cells.length; c++) {
        const cell = cells[c];
        if (
          (cell.textContent || '').trim().length > 0 ||
          cell.querySelector('img, input, textarea, select, button, a, iframe, video, audio') !== null
        ) {
          hasContent = true;
          break;
        }
      }

      if (!hasContent) { table.parentNode.removeChild(table); }
    }
  }

  // --- Validation ---

  /** Reports, without modifying, what would break the PDF export. */
  validateEditorContentForPDF(html: string): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];
    const raw = typeof html === 'string' ? html : '';

    let doc: Document;
    try {
      doc = new DOMParser().parseFromString(raw, 'text/html');
    } catch (_error) {
      return { valid: false, errors: ['Content could not be parsed as HTML.'] };
    }
    if (!doc || !doc.body) {
      return { valid: false, errors: ['Content could not be parsed as HTML.'] };
    }

    if (doc.querySelector('blockquote')) {
      errors.push(
        'Legacy blockquote indentation detected. Reformat the content before exporting to PDF.',
      );
    }

    for (let t = 0; t < INLINE_TAGS.length; t++) {
      const nodes = doc.querySelectorAll(INLINE_TAGS[t]);
      for (let k = 0; k < nodes.length; k++) {
        const blockTag = this.findWrappedBlockTag(nodes[k]);
        if (blockTag !== null) {
          errors.push(
            'Block content (<' + blockTag + '>) is wrapped by <' +
            INLINE_TAGS[t] + '>. Remove the inline wrapper around blocks.',
          );
        }
      }
    }

    const styled = doc.querySelectorAll('[style]');
    for (let i = 0; i < styled.length; i++) {
      const style = (styled[i] as HTMLElement).style;

      if (style.display === 'none' || style.visibility === 'hidden') {
        errors.push(
          'Hidden content detected (display:none or visibility:hidden). Remove it before exporting to PDF.',
        );
      }

      if (style.opacity && parseFloat(style.opacity) === 0) {
        errors.push('Content with opacity:0 will be invisible in the PDF.');
      }

      const background = style.backgroundColor;
      if (
        style.color && this.isWhiteColor(style.color) &&
        (!background || this.isWhiteColor(background) || this.isTransparentColor(background))
      ) {
        errors.push(
          'White text on white/transparent background will be invisible in the PDF.',
        );
      }

      const indent = /^(\d+(?:\.\d+)?)px$/i.exec((style.marginLeft || '').trim());
      if (indent && Number(indent[1]) > PDF_MAX_INDENT_PX) {
        errors.push('Indentation exceeds the ' + PDF_MAX_INDENT_PX + 'px PDF limit.');
      }
    }

    return { valid: errors.length === 0, errors };
  }

  private isWhiteColor(value: string): boolean {
    const s = (value || '').toLowerCase().replace(/\s+/g, '');
    return s === 'white' || s === '#fff' || s === '#ffffff' ||
      s === 'rgb(255,255,255)' || s === 'rgba(255,255,255,1)';
  }

  private isTransparentColor(value: string): boolean {
    const s = (value || '').toLowerCase().replace(/\s+/g, '');
    return s === 'transparent' || /^rgba\([^)]*,0(?:\.0+)?\)$/.test(s);
  }

  // --- Helpers ---

  /** Detached copy, so DOM mutation during iteration cannot skip elements. */
  private snapshot(nodes: NodeListOf<Element> | HTMLCollection): HTMLElement[] {
    const list: HTMLElement[] = [];
    for (let i = 0; i < nodes.length; i++) {
      list.push(nodes[i] as HTMLElement);
    }
    return list;
  }

  private childNodesOf(node: Node): Node[] {
    const list: Node[] = [];
    for (let i = 0; i < node.childNodes.length; i++) {
      list.push(node.childNodes[i]);
    }
    return list;
  }

  /** Replaces an element with its children. */
  private unwrap(element: Element): void {
    const parent = element.parentNode;
    if (!parent) { return; }
    while (element.firstChild) { parent.insertBefore(element.firstChild, element); }
    parent.removeChild(element);
  }

  /** Trimmed text, with non-breaking spaces treated as spaces. */
  private textOf(node: Node): string {
    return (node.nodeValue || '').replace(/ /g, ' ').trim();
  }
}
