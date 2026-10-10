import {
  applySafeIndentation,
  encodeSafeIndentationForSanitizer,
  restoreSafeIndentationAfterSanitizer,
  MAX_SAFE_INDENT_PX,
  SAFE_INDENT_STEP_PX,
} from './safe-indentation';

describe('safe indentation', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    host.setAttribute('contenteditable', 'true');
    document.body.appendChild(host);
  });

  afterEach(() => {
    const selection = window.getSelection();
    if (selection) { selection.removeAllRanges(); }
    if (host.parentNode) { host.parentNode.removeChild(host); }
  });

  function seed(html: string): void {
    host.innerHTML = html;
  }

  function textNodes(): Text[] {
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, null);
    const found: Text[] = [];
    let node = walker.nextNode();
    while (node) {
      found.push(node as Text);
      node = walker.nextNode();
    }
    return found;
  }

  function findText(needle: string): Text {
    const nodes = textNodes();
    for (let i = 0; i < nodes.length; i++) {
      if ((nodes[i].nodeValue || '').indexOf(needle) >= 0) { return nodes[i]; }
    }
    throw new Error('text not found: ' + needle);
  }

  /** Select from the first occurrence of `from` to the end of `to`. */
  function select(from: string, to: string): void {
    const start = findText(from);
    const end = findText(to);
    const range = document.createRange();
    range.setStart(start, 0);
    range.setEnd(end, (end.nodeValue || '').length);
    const selection = window.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  /** Place a collapsed caret inside the text node containing `needle`. */
  function caret(needle: string, offset = 1): Text {
    const node = findText(needle);
    const range = document.createRange();
    range.setStart(node, Math.min(offset, (node.nodeValue || '').length));
    range.collapse(true);
    const selection = window.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(range);
    return node;
  }

  function indent(times = 1): boolean {
    let handled = true;
    for (let i = 0; i < times; i++) {
      handled = applySafeIndentation(document, host, 'indent');
    }
    return handled;
  }

  function outdent(times = 1): boolean {
    let handled = true;
    for (let i = 0; i < times; i++) {
      handled = applySafeIndentation(document, host, 'outdent');
    }
    return handled;
  }

  // ---------------------------------------------------------------- levels

  it('adds one 40px level per indent', () => {
    seed('<p>Alpha</p>');
    caret('Alpha');

    expect(indent()).toBe(true);
    expect((host.querySelector('p') as HTMLElement).style.marginLeft).toBe('40px');
  });

  it('accumulates five levels to 200px', () => {
    seed('<p>Alpha</p>');
    caret('Alpha');
    indent(5);

    expect((host.querySelector('p') as HTMLElement).style.marginLeft).toBe('200px');
  });

  it('accumulates seven levels to 280px', () => {
    seed('<p>Alpha</p>');
    caret('Alpha');
    indent(7);

    expect((host.querySelector('p') as HTMLElement).style.marginLeft).toBe('280px');
  });

  it('outdents back to zero and drops the style attribute', () => {
    seed('<p>Alpha</p>');
    caret('Alpha');
    indent(2);
    outdent(2);

    const paragraph = host.querySelector('p') as HTMLElement;
    expect(paragraph.style.marginLeft).toBe('');
    expect(paragraph.hasAttribute('style')).toBe(false);
  });

  it('never produces a negative indentation', () => {
    seed('<p>Alpha</p>');
    caret('Alpha');
    outdent(3);

    expect((host.querySelector('p') as HTMLElement).style.marginLeft).toBe('');
  });

  it('clamps indentation at the safe maximum', () => {
    seed('<p>Alpha</p>');
    caret('Alpha');
    indent(Math.ceil(MAX_SAFE_INDENT_PX / SAFE_INDENT_STEP_PX) + 5);

    expect((host.querySelector('p') as HTMLElement).style.marginLeft)
      .toBe(MAX_SAFE_INDENT_PX + 'px');
  });

  // ------------------------------------------------------------- selection

  it('indents every leaf block in a multi-paragraph selection exactly once', () => {
    seed('<p>Alpha</p><p>Beta</p><p>Gamma</p>');
    select('Alpha', 'Gamma');
    indent();

    const paragraphs = host.querySelectorAll('p');
    expect(paragraphs.length).toBe(3);
    for (let i = 0; i < paragraphs.length; i++) {
      expect((paragraphs[i] as HTMLElement).style.marginLeft).toBe('40px');
    }
  });

  it('applies a single step when an ancestor block is also selected', () => {
    seed('<div><p>Alpha</p></div>');
    select('Alpha', 'Alpha');
    indent();

    expect((host.querySelector('p') as HTMLElement).style.marginLeft).toBe('40px');
    expect((host.querySelector('div') as HTMLElement).style.marginLeft).toBe('');
  });

  it('preserves the caret and the original text node across DIV to P conversion', () => {
    seed('<div>Alpha</div>');
    const textNode = caret('Alpha', 2);

    indent();

    const paragraph = host.querySelector('p') as HTMLElement;
    expect(paragraph).not.toBeNull();
    // The very same text node was moved, not recreated.
    expect(textNode.parentNode).toBe(paragraph);
    expect(host.contains(textNode)).toBe(true);

    const selection = window.getSelection() as Selection;
    expect(selection.rangeCount).toBe(1);
    expect(selection.getRangeAt(0).startContainer).toBe(textNode);
  });

  // ------------------------------------------------------------ conversion

  it('converts a text-only DIV into a paragraph and keeps its attributes', () => {
    seed('<div id="x" class="k" align="center">Alpha</div>');
    caret('Alpha');
    indent();

    const paragraph = host.querySelector('p') as HTMLElement;
    expect(paragraph).not.toBeNull();
    expect(host.querySelector('div')).toBeNull();
    expect(paragraph.getAttribute('id')).toBe('x');
    expect(paragraph.getAttribute('class')).toBe('k');
    expect(paragraph.getAttribute('align')).toBe('center');
    expect(paragraph.style.marginLeft).toBe('40px');
  });

  it('keeps a structural DIV as a DIV', () => {
    seed('<div><table><tbody><tr><td>Alpha</td></tr></tbody></table></div>');
    caret('Alpha');
    indent();

    const div = host.querySelector('div') as HTMLElement;
    expect(div).not.toBeNull();
    expect(div.querySelector('table')).not.toBeNull();
    expect(div.style.marginLeft).toBe('40px');
  });

  it('keeps a heading tag while indenting it', () => {
    seed('<h2>Alpha</h2>');
    caret('Alpha');
    indent();

    const heading = host.querySelector('h2') as HTMLElement;
    expect(heading.style.marginLeft).toBe('40px');
  });

  // --------------------------------------------------------- loose content

  it('wraps loose top-level text in a paragraph instead of falling back', () => {
    seed('Alpha');
    caret('Alpha');

    expect(indent()).toBe(true);

    const paragraph = host.querySelector('p') as HTMLElement;
    expect(paragraph).not.toBeNull();
    expect(paragraph.textContent).toBe('Alpha');
    expect(paragraph.style.marginLeft).toBe('40px');
    expect(host.querySelector('blockquote')).toBeNull();
  });

  it('wraps a loose inline run without splitting its formatting', () => {
    seed('Alpha <b>Beta</b> Gamma');
    select('Alpha', 'Gamma');

    expect(indent()).toBe(true);

    const paragraph = host.querySelector('p') as HTMLElement;
    expect(paragraph).not.toBeNull();
    expect(paragraph.querySelector('b')).not.toBeNull();
    expect(paragraph.style.marginLeft).toBe('40px');
    expect(host.querySelectorAll('p').length).toBe(1);
  });

  it('reports handled for an empty editor and changes nothing', () => {
    seed('');
    const range = document.createRange();
    range.setStart(host, 0);
    range.collapse(true);
    const selection = window.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(range);

    expect(indent()).toBe(true);
    expect(host.querySelector('blockquote')).toBeNull();
  });

  it('reports handled when the selection is outside the editor', () => {
    seed('<p>Alpha</p>');
    const outside = document.createElement('p');
    outside.textContent = 'Outside';
    document.body.appendChild(outside);
    try {
      const range = document.createRange();
      range.selectNodeContents(outside);
      const selection = window.getSelection() as Selection;
      selection.removeAllRanges();
      selection.addRange(range);

      expect(indent()).toBe(true);
      expect((host.querySelector('p') as HTMLElement).style.marginLeft).toBe('');
      expect(outside.style.marginLeft).toBe('');
    } finally {
      document.body.removeChild(outside);
    }
  });

  // ------------------------------------------------------------- fallbacks

  it('delegates list indentation to the browser', () => {
    seed('<ul><li>Alpha</li></ul>');
    caret('Alpha');

    expect(applySafeIndentation(document, host, 'indent')).toBe(false);
    // Nothing was touched: the browser owns this case.
    expect((host.querySelector('li') as HTMLElement).style.marginLeft).toBe('');
  });

  it('delegates when a selection merely touches a list item', () => {
    seed('<p>Alpha</p><ul><li>Beta</li></ul>');
    select('Alpha', 'Beta');

    expect(applySafeIndentation(document, host, 'outdent')).toBe(false);
  });

  it('never produces a blockquote for normal text content', () => {
    seed('<p>Alpha</p><div>Beta</div><h3>Gamma</h3>');
    select('Alpha', 'Gamma');
    indent(3);
    outdent(1);

    expect(host.querySelector('blockquote')).toBeNull();
    expect(host.innerHTML.indexOf('blockquote')).toBe(-1);
  });

  // --------------------------------------------------- sanitizer round trip

  it('encodes and restores a validated indentation through style stripping', () => {
    const encoded = encodeSafeIndentationForSanitizer(
      '<p style="margin-left: 40px">Alpha</p>', document,
    );
    expect(encoded).toContain('ae-safe-indent-px-40');

    // Simulate Angular's DomSanitizer, which removes every style attribute.
    const stripped = encoded.replace(/ style="[^"]*"/g, '');
    const restored = restoreSafeIndentationAfterSanitizer(stripped, document);

    expect(restored).toContain('margin-left: 40px');
    expect(restored).not.toContain('ae-safe-indent-px');
  });

  it('preserves unrelated classes while restoring indentation', () => {
    const encoded = encodeSafeIndentationForSanitizer(
      '<p class="keep" style="margin-left: 80px">Alpha</p>', document,
    );
    const stripped = encoded.replace(/ style="[^"]*"/g, '');
    const restored = restoreSafeIndentationAfterSanitizer(stripped, document);

    expect(restored).toContain('class="keep"');
    expect(restored).toContain('margin-left: 80px');
  });

  it('refuses to restore an out-of-range or negative indentation', () => {
    const tooLarge = encodeSafeIndentationForSanitizer(
      '<p style="margin-left: ' + (MAX_SAFE_INDENT_PX + 40) + 'px">Alpha</p>', document,
    );
    expect(tooLarge).not.toContain('ae-safe-indent-px');

    const negative = encodeSafeIndentationForSanitizer(
      '<p style="margin-left: -40px">Alpha</p>', document,
    );
    expect(negative).not.toContain('ae-safe-indent-px');

    const forged = restoreSafeIndentationAfterSanitizer(
      '<p class="ae-safe-indent-px-99999">Alpha</p>', document,
    );
    expect(forged).not.toContain('margin-left');
  });

  it('tolerates empty input in the round-trip helpers', () => {
    expect(encodeSafeIndentationForSanitizer('', document)).toBe('');
    expect(restoreSafeIndentationAfterSanitizer('', document)).toBe('');
  });
});
