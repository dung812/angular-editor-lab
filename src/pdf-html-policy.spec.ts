import {
  EDITOR_COMPACT_DEFAULT_FONT_SIZE_PX,
  EDITOR_DEFAULT_FONT_FAMILY,
  EDITOR_PERSISTED_BODY_FONT_SIZE_PX,
  MAX_SAFE_INDENT_PX,
  SAFE_INDENT_STEP_PX,
} from '@local/angular-editor';
import {
  PDF_BODY_FONT_SIZE_PX,
  PDF_DEFAULT_FONT_FAMILY,
  PDF_INDENT_STEP_PX,
  PDF_MAX_INDENT_PX,
  PDF_SUPPORTED_FONT_FAMILIES,
} from './html-cleaner.service';

/**
 * The editor library and HtmlCleanerService intentionally keep *separate*
 * copies of the shared PDF policy numbers: a generic rich-text editor must not
 * depend on application-specific PDF code. These tests are the seam that keeps
 * the two copies honest — if someone changes one side only, this fails.
 */
describe('PDF-safe HTML policy (editor library vs. HtmlCleanerService)', () => {
  it('agrees on the indentation step', () => {
    expect(SAFE_INDENT_STEP_PX).toBe(PDF_INDENT_STEP_PX);
    expect(SAFE_INDENT_STEP_PX).toBe(40);
  });

  it('agrees on the maximum indentation', () => {
    expect(MAX_SAFE_INDENT_PX).toBe(PDF_MAX_INDENT_PX);
    expect(MAX_SAFE_INDENT_PX).toBe(2000);
  });

  it('agrees on the default font family', () => {
    expect(EDITOR_DEFAULT_FONT_FAMILY).toBe(PDF_DEFAULT_FONT_FAMILY);
    expect(PDF_SUPPORTED_FONT_FAMILIES.indexOf(PDF_DEFAULT_FONT_FAMILY))
      .toBeGreaterThanOrEqual(0);
  });

  it('agrees that the persisted body size is 16px', () => {
    expect(EDITOR_PERSISTED_BODY_FONT_SIZE_PX).toBe(PDF_BODY_FONT_SIZE_PX + 'px');
    expect(PDF_BODY_FONT_SIZE_PX).toBe(16);
  });

  it('keeps the editor UI size deliberately different from the persisted size', () => {
    // 14px is a *display* choice; 16px is what iTextPDF 5 receives. If these
    // ever become equal the UI-only override in the SCSS is pointless and
    // should be removed rather than silently kept.
    expect(EDITOR_COMPACT_DEFAULT_FONT_SIZE_PX).toBe('14px');
    expect(EDITOR_COMPACT_DEFAULT_FONT_SIZE_PX)
      .not.toBe(EDITOR_PERSISTED_BODY_FONT_SIZE_PX);
  });
});
