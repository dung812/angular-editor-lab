import { HtmlCleanerService } from './html-cleaner.service';

describe('HtmlCleanerService PDF typography normalization', () => {
  let service: HtmlCleanerService;

  beforeEach(() => {
    service = new HtmlCleanerService();
  });

  function parse(html: string): Document {
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function fontFamily(element: HTMLElement): string {
    return element.style.fontFamily.replace(/["']/g, '');
  }

  it('normalizes text divs and makes the font explicit for iTextPDF 5', () => {
    const cleaned = service.sanitize(
      '<div>Additional note:</div>' +
      '<h6 style="margin-left: 40px">' +
      '<span style="background-color: transparent; font-size: 1rem">' +
      'LabView360 should be used in place of iSite.' +
      '</span></h6>',
    );
    const doc = parse(cleaned);
    const root = doc.body.firstElementChild as HTMLElement;
    const paragraph = root.querySelector('p') as HTMLElement;
    const heading = root.querySelector('h6') as HTMLElement;
    const span = heading.querySelector('span') as HTMLElement;

    expect(root.tagName).toBe('DIV');
    expect(paragraph.textContent).toBe('Additional note:');
    expect(heading.style.marginLeft).toBe('40px');
    expect(span.style.backgroundColor).toBe('');
    expect(fontFamily(root)).toBe('Arial');
    expect(fontFamily(paragraph)).toBe('Arial');
    expect(fontFamily(heading)).toBe('Arial');
    expect(fontFamily(span)).toBe('Arial');
    expect(root.style.fontSize).toBe('16px');
    expect(paragraph.style.fontSize).toBe('16px');
    expect(span.style.fontSize).toBe('16px');
  });

  it('preserves a supported selected font and resolves relative font sizes', () => {
    const cleaned = service.sanitize(
      '<div><div style="font-family: Times New Roman">' +
      '<span style="font-size: 1.25em">Text</span>' +
      '</div></div>',
    );
    const doc = parse(cleaned);
    const paragraph = doc.querySelector('p') as HTMLElement;
    const span = paragraph.querySelector('span') as HTMLElement;

    expect(fontFamily(paragraph)).toBe('Times New Roman');
    expect(fontFamily(span)).toBe('Times New Roman');
    expect(span.style.fontSize).toBe('20px');
  });

  it('uses deterministic sizes for inherited body text', () => {
    const cleaned = service.sanitize(
      '<div><p>First line</p>' +
      '<p style="margin-left: 40px"><span style="font-size: 1rem">' +
      'Second line</span></p></div>',
    );
    const doc = parse(cleaned);
    const paragraphs = doc.querySelectorAll('p');
    const span = paragraphs[1].querySelector('span') as HTMLElement;

    expect((paragraphs[0] as HTMLElement).style.fontSize).toBe('16px');
    expect((paragraphs[1] as HTMLElement).style.fontSize).toBe('16px');
    expect(span.style.fontSize).toBe('16px');
  });

  it('falls back to the PDF default font for unsupported typography', () => {
    const cleaned = service.sanitize(
      '<div style="font-family: Papyrus">' +
      '<span style="font-size: 200px">Text</span>' +
      '</div>',
    );
    const doc = parse(cleaned);
    const root = doc.body.firstElementChild as HTMLElement;

    expect(fontFamily(root)).toBe('Arial');
    expect(cleaned).not.toContain('Papyrus');
    expect(cleaned).not.toContain('200px');
  });

  it('keeps structural divs around block content', () => {
    const cleaned = service.sanitize(
      '<div><table><tbody><tr><td>Cell</td></tr></tbody></table></div>',
    );
    const doc = parse(cleaned);
    const root = doc.body.firstElementChild as HTMLElement;

    expect(root.tagName).toBe('DIV');
    expect(root.querySelector('table')).not.toBeNull();
    expect(fontFamily(root.querySelector('td') as HTMLElement)).toBe('Arial');
  });

  it('preserves strike formatting through sanitization', () => {
    const cleaned = service.sanitize(
      '<p><strike>Additional note:</strike></p>',
    );

    expect(parse(cleaned).querySelector('strike')).not.toBeNull();
  });

  it('normalizes legacy font tags', () => {
    const cleaned = service.sanitize(
      '<font face="Arial" size="3">Legacy content</font>',
    );
    const span = parse(cleaned).querySelector('span') as HTMLElement;

    expect(fontFamily(span)).toBe('Arial');
    expect(span.style.fontSize).toBe('16px');
  });

  it('is idempotent', () => {
    const input =
      '<div>Additional note:</div>' +
      '<div style="margin-left: 80px">Indented text</div>';
    const firstPass = service.sanitize(input);
    const secondPass = service.sanitize(firstPass);

    expect(secondPass).toBe(firstPass);
  });
});
