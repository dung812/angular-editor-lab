import { HtmlCleanerService } from './../html-cleaner.service';
import { Component } from '@angular/core';
import { AngularEditorConfig } from '@local/angular-editor';

/**
 * Lab harness demonstrating the four distinct normalization boundaries.
 *
 * 1. Editor-input sanitization  - AngularEditorComponent.onContentChange(),
 *    runs on every keystroke via Angular's DomSanitizer. Cheap, XSS-focused;
 *    it does NOT remove blockquotes or normalize typography.
 * 2. Reformat                   - onReformatContent() below. Explicit, user
 *    triggered, rewrites the model with canonical PDF-safe HTML.
 * 3. Save / submit              - onSubmitContent() below. Normalization is
 *    mandatory here so nothing un-normalized can reach storage.
 * 4. Backend PDF normalization  - not part of this repository. See the
 *    "defense in depth" note in the docs.
 *
 * Paste is deliberately NOT wired to the cleaner: there is no paste handler,
 * so pasted fragments are only covered by (1) until Reformat or Save runs.
 * Running the full cleaner on every keystroke would re-parse the whole
 * document and disturb the caret.
 */
@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent {
  constructor(private htmlCleanerService: HtmlCleanerService) {}

  htmlContent = '<p>Angular Editor v1.1.4 local source</p>';

  /** Problems reported by the PDF pre-flight check after the last submit. */
  pdfValidationErrors: string[] = [];

  editorConfig: AngularEditorConfig = {
    editable: true,
    spellcheck: true,
    height: '250px',
    minHeight: '150px',
    maxHeight: 'auto',
    width: 'auto',
    minWidth: '0',
    translate: 'no',
    enableToolbar: true,
    showToolbar: true,
    placeholder: 'Enter notes here...',
    // Guarantees every line has a block element, so safe indentation always
    // has a target and never needs to wrap loose text.
    defaultParagraphSeparator: 'p',
    defaultFontName: 'Arial',
    defaultFontSize: '3',
    sanitize: true,
    toolbarPosition: 'top',
    outline: true,
    toolbarHiddenButtons: [
      [
        'subscript',
        'superscript'
      ],
      [
        'customClasses',
        'insertVideo'
      ]
    ]
  };

  /**
   * Explicit Reformat: rewrite the editor model with canonical PDF-safe HTML.
   * This is the only place blockquote-to-paragraph conversion happens.
   */
  onReformatContent(): void {
    this.htmlContent = this.htmlCleanerService.sanitize(this.htmlContent || '');
    this.pdfValidationErrors = [];
  }

  /**
   * Save/submit boundary: normalization is mandatory, then the result is
   * validated before it would be handed to the PDF backend.
   */
  onSubmitContent(): void {
    const normalized = this.htmlCleanerService.sanitize(this.htmlContent || '');
    this.htmlContent = normalized;

    const validation = this.htmlCleanerService.validateEditorContentForPDF(normalized);
    this.pdfValidationErrors = validation.errors;
  }
}
