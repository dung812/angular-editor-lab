import {
  HtmlCleanerService,
  PDF_BODY_FONT_SIZE_PX,
  PDF_MAX_FONT_SIZE_PX,
  PDF_MAX_INDENT_PX,
  PDF_MIN_FONT_SIZE_PX,
} from './html-cleaner.service';

describe('HtmlCleanerService', () => {
  let service: HtmlCleanerService;

  beforeEach(() => {
    service = new HtmlCleanerService();
  });

  function parse(html: string): Document {
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function clean(html: string): Document {
    return parse(service.sanitize(html));
  }

  function root(doc: Document): HTMLElement {
    return doc.body.firstElementChild as HTMLElement;
  }

  function fontFamily(element: HTMLElement): string {
    return element.style.fontFamily.replace(/["']/g, '');
  }

  // =====================================================================
  // Indentation
  // =====================================================================

  describe('indentation', () => {
    it('converts a legacy nested blockquote into a flat paragraph', () => {
      const doc = clean('<blockquote><div><div>Content</div></div></blockquote>');
      const paragraph = doc.querySelector('p') as HTMLElement;

      expect(paragraph).not.toBeNull();
      expect(paragraph.style.marginLeft).toBe('80px');
      expect(paragraph.textContent).toBe('Content');
    });

    it('accumulates five legacy levels to 200px', () => {
      const doc = clean(
        '<blockquote><div><div><div><div><div>Deep</div>' +
        '</div></div></div></div></blockquote>',
      );

      expect((doc.querySelector('p') as HTMLElement).style.marginLeft).toBe('200px');
    });

    it('accumulates seven legacy levels to 280px', () => {
      const doc = clean(
        '<blockquote><div><div><div><div><div><div><div>Deep7</div>' +
        '</div></div></div></div></div></div></blockquote>',
      );

      expect((doc.querySelector('p') as HTMLElement).style.marginLeft).toBe('280px');
    });

    it('reads the Chrome margin shorthand off a legacy blockquote', () => {
      const doc = clean(
        '<blockquote style="margin:0 0 0 40px;border:none;padding:0">' +
        '<div>Content</div></blockquote>',
      );

      expect((doc.querySelector('p') as HTMLElement).style.marginLeft).toBe('40px');
    });

    it('folds a blockquote nested in a blockquote into one paragraph', () => {
      const doc = clean(
        '<blockquote><div><blockquote><div>Inner</div></blockquote></div></blockquote>',
      );
      const paragraphs = doc.querySelectorAll('p');

      expect(paragraphs.length).toBe(1);
      expect((paragraphs[0] as HTMLElement).style.marginLeft).toBe('80px');
    });

    it('keeps a DIV container when a blockquote wraps block content', () => {
      const doc = clean('<blockquote><div><ul><li>a</li></ul></div></blockquote>');
      const container = root(doc);

      // A <p> may not wrap a <ul>; the indentation moves to a DIV instead.
      expect(container.tagName).toBe('DIV');
      expect(container.style.marginLeft).toBe('40px');
      expect(container.querySelector('ul')).not.toBeNull();
      expect(doc.querySelector('p')).toBeNull();
    });

    it('never emits a blockquote', () => {
      const outputs = [
        service.sanitize('<blockquote><div>a</div></blockquote>'),
        service.sanitize('<blockquote><div><div>b</div></div></blockquote>'),
        service.sanitize('<blockquote><div><ul><li>c</li></ul></div></blockquote>'),
      ];

      for (let i = 0; i < outputs.length; i++) {
        expect(outputs[i].indexOf('blockquote')).toBe(-1);
      }
    });

    it('converts an indented text-only DIV into a paragraph', () => {
      const doc = clean('<div style="margin-left: 40px">Indented</div>');
      const paragraph = doc.querySelector('p') as HTMLElement;

      expect(paragraph.style.marginLeft).toBe('40px');
      expect(paragraph.textContent).toBe('Indented');
    });

    it('converts a plain text-only DIV into a paragraph', () => {
      const doc = clean('<div>Plain text</div>');

      expect((doc.querySelector('p') as HTMLElement).textContent).toBe('Plain text');
    });

    it('retains a structural DIV that contains a table', () => {
      const doc = clean(
        '<div style="margin-left: 40px"><table><tbody><tr><td>Cell</td>' +
        '</tr></tbody></table></div>',
      );
      const container = root(doc);

      expect(container.tagName).toBe('DIV');
      expect(container.style.marginLeft).toBe('40px');
      expect(container.querySelector('table')).not.toBeNull();
    });

    it('limits indentation to the PDF maximum', () => {
      const doc = clean('<div style="margin-left: 5000px">x</div>');

      expect((doc.querySelector('p') as HTMLElement).style.marginLeft)
        .toBe(PDF_MAX_INDENT_PX + 'px');
    });

    it('converts recognized pasted indentation units to pixels', () => {
      const cases: Array<[string, string]> = [
        ['<p style="margin-left: 36pt">x</p>', '48px'],
        ['<p style="margin-left: .5in">x</p>', '48px'],
        ['<p style="margin-left: 2.5em">x</p>', '40px'],
        ['<p style="margin-left: 2rem">x</p>', '32px'],
        ['<p style="padding-left: 40px">x</p>', '40px'],
        ['<p style="margin: 0 0 0 80px">x</p>', '80px'],
        ['<p class="ql-indent-2">x</p>', '80px'],
      ];

      for (let i = 0; i < cases.length; i++) {
        const doc = clean(cases[i][0]);
        expect((doc.querySelector('p') as HTMLElement).style.marginLeft)
          .toBe(cases[i][1]);
      }
    });

    it('does not keep the original indentation metadata', () => {
      const output = service.sanitize('<p class="ql-indent-2" style="padding-left: 40px">x</p>');

      expect(output.indexOf('ql-indent')).toBe(-1);
      expect(output.indexOf('class=')).toBe(-1);
      expect(output.indexOf('padding')).toBe(-1);
      expect(output).toContain('margin-left');
    });

    it('prefers an explicit CSS length over an inferred editor class', () => {
      // An inline declaration is authoritative; `ql-indent-N` is only an
      // inference from a foreign editor's class vocabulary.
      const explicit = clean('<p class="ql-indent-2" style="padding-left: 40px">x</p>');
      const classOnly = clean('<p class="ql-indent-2">x</p>');

      expect((explicit.querySelector('p') as HTMLElement).style.marginLeft).toBe('40px');
      expect((classOnly.querySelector('p') as HTMLElement).style.marginLeft).toBe('80px');
    });
  });

  // =====================================================================
  // Idempotence
  // =====================================================================

  describe('idempotence', () => {
    const fixtures = [
      '<blockquote><div><div>Content</div></div></blockquote>',
      '<blockquote><div><ul><li>a</li></ul></div></blockquote>',
      '<div>Additional note:</div><div style="margin-left: 80px">Indented text</div>',
      '<p style="margin-left:40px">one</p><p style="margin-left:80px">two</p>',
      '<font face="Arial" size="3">Legacy</font>',
      '<img src="https://example.com/a.png" alt="a">',
      '<div><table><tbody><tr><td>Cell</td></tr></tbody></table></div>',
      '<h1>a</h1><h6>f</h6>',
      '<p><a href="https://example.com" target="_blank">link</a></p>',
      '<div><p>unclosed<span>x</div></p></span>',
    ];

    it('produces byte-identical output on repeated Reformat', () => {
      for (let i = 0; i < fixtures.length; i++) {
        const first = service.sanitize(fixtures[i]);
        const second = service.sanitize(first);
        const third = service.sanitize(second);

        expect(second).toBe(first);
        expect(third).toBe(second);
      }
    });
  });

  // =====================================================================
  // Inline formatting
  // =====================================================================

  describe('inline formatting', () => {
    it('preserves strike formatting', () => {
      expect(clean('<p><strike>struck</strike></p>').querySelector('strike'))
        .not.toBeNull();
    });

    it('normalizes <s> to <strike>', () => {
      const doc = clean('<p><s>struck</s></p>');

      expect(doc.querySelector('strike')).not.toBeNull();
      expect((doc.querySelector('strike') as HTMLElement).textContent).toBe('struck');
    });

    it('normalizes a line-through span to <strike>', () => {
      const doc = clean('<p><span style="text-decoration: line-through">struck</span></p>');

      expect(doc.querySelector('strike')).not.toBeNull();
    });

    it('does not allow arbitrary text-decoration through', () => {
      const output = service.sanitize('<p><span style="text-decoration: blink">x</span></p>');

      expect(output.indexOf('text-decoration')).toBe(-1);
    });

    it('preserves bold, italic and underline', () => {
      const doc = clean('<p><b>b</b><i>i</i><u>u</u><em>e</em><strong>s</strong></p>');

      expect(doc.querySelector('b')).not.toBeNull();
      expect(doc.querySelector('i')).not.toBeNull();
      expect(doc.querySelector('u')).not.toBeNull();
      expect(doc.querySelector('em')).not.toBeNull();
      expect(doc.querySelector('strong')).not.toBeNull();
    });

    it('preserves subscript and superscript', () => {
      const doc = clean('<p>x<sub>1</sub><sup>2</sup></p>');

      expect(doc.querySelector('sub')).not.toBeNull();
      expect(doc.querySelector('sup')).not.toBeNull();
    });
  });

  // =====================================================================
  // Block structure
  // =====================================================================

  describe('block structure', () => {
    it('preserves every heading level h1 to h6', () => {
      const doc = clean('<h1>a</h1><h2>b</h2><h3>c</h3><h4>d</h4><h5>e</h5><h6>f</h6>');

      for (let level = 1; level <= 6; level++) {
        expect(doc.querySelector('h' + level)).not.toBeNull();
      }
    });

    it('preserves preformatted content', () => {
      const doc = clean('<pre>  code  </pre>');
      const pre = doc.querySelector('pre') as HTMLElement;

      expect(pre).not.toBeNull();
      expect(pre.textContent).toBe('  code  ');
    });

    it('preserves a horizontal rule', () => {
      expect(clean('<p>a</p><hr><p>b</p>').querySelector('hr')).not.toBeNull();
    });

    it('preserves every alignment including justify', () => {
      const doc = clean(
        '<p style="text-align: justify">j</p><p style="text-align: center">c</p>' +
        '<p style="text-align: right">r</p><p style="text-align: left">l</p>',
      );
      const paragraphs = doc.querySelectorAll('p');

      expect((paragraphs[0] as HTMLElement).style.textAlign).toBe('justify');
      expect((paragraphs[1] as HTMLElement).style.textAlign).toBe('center');
      expect((paragraphs[2] as HTMLElement).style.textAlign).toBe('right');
      expect((paragraphs[3] as HTMLElement).style.textAlign).toBe('left');
    });

    it('keeps a valid table structure', () => {
      const doc = clean('<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>');

      expect(doc.querySelectorAll('table').length).toBe(1);
      expect(doc.querySelectorAll('td').length).toBe(2);
      expect((doc.querySelector('td') as HTMLElement).parentElement!.tagName).toBe('TR');
    });

    it('keeps list items inside a list', () => {
      const doc = clean('<ul><li>one<ul><li>two</li></ul></li></ul>');
      const items = doc.querySelectorAll('li');

      expect(items.length).toBe(2);
      for (let i = 0; i < items.length; i++) {
        const parent = items[i].parentElement as HTMLElement;
        expect(parent.tagName === 'UL' || parent.tagName === 'OL').toBe(true);
      }
    });

    it('always produces exactly one root container', () => {
      const doc = clean('<p>a</p><p>b</p><h2>c</h2>');

      expect(doc.body.childElementCount).toBe(1);
      expect(root(doc).tagName).toBe('DIV');
    });
  });

  // =====================================================================
  // Links and images
  // =====================================================================

  describe('links and images', () => {
    it('keeps an https link and hardens target=_blank', () => {
      const anchor = clean(
        '<p><a href="https://example.com" target="_blank">link</a></p>',
      ).querySelector('a') as HTMLAnchorElement;

      expect(anchor).not.toBeNull();
      expect(anchor.getAttribute('href')).toBe('https://example.com');
      expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('keeps an http link without inventing a target', () => {
      const anchor = clean('<p><a href="http://example.com">link</a></p>')
        .querySelector('a') as HTMLAnchorElement;

      expect(anchor.getAttribute('href')).toBe('http://example.com');
      expect(anchor.hasAttribute('target')).toBe(false);
    });

    it('removes a javascript: link but keeps its text', () => {
      const doc = clean('<p><a href="javascript:alert(1)">bad</a></p>');

      expect(doc.querySelector('a')).toBeNull();
      expect(doc.body.textContent).toContain('bad');
      expect(doc.body.innerHTML.indexOf('javascript')).toBe(-1);
    });

    it('removes a data: link outside of images', () => {
      const doc = clean('<p><a href="data:text/html,hi">x</a></p>');

      expect(doc.querySelector('a')).toBeNull();
      expect(doc.body.innerHTML.indexOf('data:')).toBe(-1);
    });

    it('keeps http, https and data image sources', () => {
      const https = clean('<img src="https://example.com/a.png" alt="a">');
      const data = clean('<img src="data:image/png;base64,iVBOR" alt="a">');

      expect((https.querySelector('img') as HTMLImageElement).getAttribute('src'))
        .toBe('https://example.com/a.png');
      expect((data.querySelector('img') as HTMLImageElement).getAttribute('src'))
        .toBe('data:image/png;base64,iVBOR');
    });

    it('drops a javascript: image source', () => {
      const image = clean('<img src="javascript:alert(1)">').querySelector('img');

      expect(image).not.toBeNull();
      expect((image as HTMLImageElement).hasAttribute('src')).toBe(false);
    });
  });

  // =====================================================================
  // Typography
  // =====================================================================

  describe('typography', () => {
    it('makes family and size explicit on the root and on text elements', () => {
      const doc = clean(
        '<div>Additional note:</div>' +
        '<h6 style="margin-left: 40px">' +
        '<span style="background-color: transparent; font-size: 1rem">' +
        'LabView360 should be used in place of iSite.' +
        '</span></h6>',
      );
      const container = root(doc);
      const paragraph = container.querySelector('p') as HTMLElement;
      const heading = container.querySelector('h6') as HTMLElement;
      const span = heading.querySelector('span') as HTMLElement;

      expect(container.tagName).toBe('DIV');
      expect(paragraph.textContent).toBe('Additional note:');
      expect(heading.style.marginLeft).toBe('40px');
      expect(span.style.backgroundColor).toBe('');
      expect(fontFamily(container)).toBe('Arial');
      expect(fontFamily(paragraph)).toBe('Arial');
      expect(fontFamily(heading)).toBe('Arial');
      expect(fontFamily(span)).toBe('Arial');
      expect(container.style.fontSize).toBe(PDF_BODY_FONT_SIZE_PX + 'px');
      expect(paragraph.style.fontSize).toBe(PDF_BODY_FONT_SIZE_PX + 'px');
      expect(span.style.fontSize).toBe(PDF_BODY_FONT_SIZE_PX + 'px');
    });

    it('preserves a supported selected font and resolves relative sizes', () => {
      const doc = clean(
        '<div><div style="font-family: Times New Roman">' +
        '<span style="font-size: 1.25em">Text</span>' +
        '</div></div>',
      );
      const paragraph = doc.querySelector('p') as HTMLElement;
      const span = paragraph.querySelector('span') as HTMLElement;

      expect(fontFamily(paragraph)).toBe('Times New Roman');
      expect(fontFamily(span)).toBe('Times New Roman');
      expect(span.style.fontSize).toBe('20px');
    });

    it('keeps every supported font family', () => {
      const families = [
        'Arial', 'Helvetica', 'Times New Roman', 'Times-Roman',
        'Calibri', 'Comic Sans MS',
      ];

      for (let i = 0; i < families.length; i++) {
        const doc = clean('<p style="font-family: ' + families[i] + '">t</p>');
        expect(fontFamily(doc.querySelector('p') as HTMLElement)).toBe(families[i]);
      }
    });

    it('falls back to Arial for an unsupported family', () => {
      const output = service.sanitize(
        '<div style="font-family: Papyrus"><span style="font-size: 200px">Text</span></div>',
      );
      const doc = parse(output);

      expect(fontFamily(root(doc))).toBe('Arial');
      expect(fontFamily(doc.querySelector('span') as HTMLElement)).toBe('Arial');
      expect(output.indexOf('Papyrus')).toBe(-1);
    });

    it('normalizes px, pt, em and rem sizes to bounded pixels', () => {
      const doc = clean(
        '<p style="font-size: 18px">a</p><p style="font-size: 12pt">b</p>' +
        '<p style="font-size: 1.25em">c</p><p style="font-size: 1rem">d</p>',
      );
      const paragraphs = doc.querySelectorAll('p');

      expect((paragraphs[0] as HTMLElement).style.fontSize).toBe('18px');
      expect((paragraphs[1] as HTMLElement).style.fontSize).toBe('16px');
      expect((paragraphs[2] as HTMLElement).style.fontSize).toBe('20px');
      expect((paragraphs[3] as HTMLElement).style.fontSize).toBe('16px');
    });

    it('clamps sizes outside the supported range', () => {
      const large = clean('<p style="font-size: 200px">x</p>');
      const tiny = clean('<p style="font-size: 1px">x</p>');

      expect((large.querySelector('p') as HTMLElement).style.fontSize)
        .toBe(PDF_MAX_FONT_SIZE_PX + 'px');
      expect((tiny.querySelector('p') as HTMLElement).style.fontSize)
        .toBe(PDF_MIN_FONT_SIZE_PX + 'px');
    });

    it('applies deterministic heading sizes', () => {
      const doc = clean('<h1>a</h1><h2>b</h2><h3>c</h3><h4>d</h4><h5>e</h5><h6>f</h6>');
      const expected = ['32px', '24px', '19px', '16px', '13px', '11px'];

      for (let level = 1; level <= 6; level++) {
        const heading = doc.querySelector('h' + level) as HTMLElement;
        expect(heading.style.fontSize).toBe(expected[level - 1]);
      }
    });

    it('normalizes a legacy font tag into a styled span', () => {
      const doc = clean('<font face="Arial" size="3">Legacy content</font>');
      const span = doc.querySelector('span') as HTMLElement;

      expect(doc.querySelector('font')).toBeNull();
      expect(fontFamily(span)).toBe('Arial');
      expect(span.style.fontSize).toBe('16px');
    });

    it('keeps a supported font from a pasted font stack', () => {
      const doc = clean(
        '<div class="WordSection1"><p style="font-family:Calibri,sans-serif">' +
        'Word text</p></div>',
      );

      expect(fontFamily(doc.querySelector('p') as HTMLElement)).toBe('Calibri');
    });
  });

  // =====================================================================
  // Security
  // =====================================================================

  describe('security', () => {
    it('removes script elements and their contents', () => {
      const output = service.sanitize('<p>a</p><script>alert(1)</script>');

      expect(output.indexOf('script')).toBe(-1);
      expect(output.indexOf('alert')).toBe(-1);
    });

    it('removes event handler attributes', () => {
      const output = service.sanitize(
        '<p onclick="alert(1)" onmouseover="x()">text</p>',
      );

      expect(output.indexOf('onclick')).toBe(-1);
      expect(output.indexOf('onmouseover')).toBe(-1);
      expect(output).toContain('text');
    });

    it('removes iframes, forms and style elements', () => {
      const output = service.sanitize(
        '<iframe src="https://evil"></iframe><form><input></form>' +
        '<style>body{display:none}</style><p>kept</p>',
      );

      expect(output.indexOf('iframe')).toBe(-1);
      expect(output.indexOf('<form')).toBe(-1);
      expect(output.indexOf('<input')).toBe(-1);
      expect(output.indexOf('<style')).toBe(-1);
      expect(output).toContain('kept');
    });

    it('removes hidden and invisible CSS', () => {
      const output = service.sanitize(
        '<p style="display: none">a</p>' +
        '<p style="visibility: hidden">b</p>' +
        '<p style="opacity: 0">c</p>' +
        '<p style="position: fixed; top: 0">d</p>',
      );

      expect(output.indexOf('display')).toBe(-1);
      expect(output.indexOf('visibility')).toBe(-1);
      expect(output.indexOf('opacity')).toBe(-1);
      expect(output.indexOf('position')).toBe(-1);
    });

    it('removes invisible white text and transparent backgrounds', () => {
      const output = service.sanitize(
        '<p style="color: #ffffff">a</p>' +
        '<p style="background-color: transparent">b</p>',
      );

      expect(output.indexOf('#ffffff')).toBe(-1);
      expect(output.indexOf('transparent')).toBe(-1);
    });

    it('rejects CSS function values in color and font declarations', () => {
      const output = service.sanitize(
        '<p style="color: url(https://evil/x)">a</p>' +
        '<p style="font-family: expression(alert(1))">b</p>' +
        '<p style="background-color: url(javascript:alert(1))">c</p>',
      );

      expect(output.indexOf('url(')).toBe(-1);
      expect(output.indexOf('expression')).toBe(-1);
    });

    it('rejects a forged out-of-range indentation', () => {
      const output = service.sanitize('<p style="margin-left: 99999px">x</p>');

      expect(output.indexOf('99999')).toBe(-1);
    });
  });

  // =====================================================================
  // Robustness
  // =====================================================================

  describe('robustness', () => {
    it('returns an empty string for empty and blank input', () => {
      expect(service.sanitize('')).toBe('');
      expect(service.sanitize('   \n  ')).toBe('');
    });

    it('tolerates null-like input despite the string signature', () => {
      expect(service.sanitize(null as unknown as string)).toBe('');
      expect(service.sanitize(undefined as unknown as string)).toBe('');
    });

    it('does not throw on malformed external HTML', () => {
      const malformed = [
        '<div><p>unclosed<span>x</div></p></span><<>>',
        '<table><tr><div>bad</div></tr>',
        '<li>orphan</li>',
        '<b><p>block in inline</p></b>',
        '<p style="margin-left:">empty value</p>',
        '<p style=">>>">broken style</p>',
      ];

      for (let i = 0; i < malformed.length; i++) {
        const input = malformed[i];
        expect(() => service.sanitize(input)).not.toThrow();
      }
    });

    it('unwraps an inline element that wraps block content', () => {
      const doc = clean('<b><p>block</p></b>');
      const paragraph = doc.querySelector('p') as HTMLElement;

      expect(paragraph).not.toBeNull();
      expect(paragraph.closest('b')).toBeNull();
    });
  });

  // =====================================================================
  // PDF pre-flight validation
  // =====================================================================

  describe('validateEditorContentForPDF', () => {
    it('flags legacy blockquote content', () => {
      const result = service.validateEditorContentForPDF('<blockquote>x</blockquote>');

      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toContain('blockquote');
    });

    it('accepts canonical cleaner output', () => {
      const canonical = service.sanitize(
        '<blockquote><div><div>Content</div></div></blockquote>',
      );

      expect(service.validateEditorContentForPDF(canonical).valid).toBe(true);
    });

    it('flags hidden and invisible content', () => {
      expect(
        service.validateEditorContentForPDF('<p style="display:none">x</p>').valid,
      ).toBe(false);
      expect(
        service.validateEditorContentForPDF('<p style="color:#fff">x</p>').valid,
      ).toBe(false);
      expect(
        service.validateEditorContentForPDF('<p style="opacity:0">x</p>').valid,
      ).toBe(false);
    });

    it('flags block content wrapped by an inline element', () => {
      const result = service.validateEditorContentForPDF('<b><p>x</p></b>');

      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toContain('inline wrapper');
    });

    it('tolerates null-like input', () => {
      expect(() => service.validateEditorContentForPDF(null as unknown as string))
        .not.toThrow();
    });
  });
});
