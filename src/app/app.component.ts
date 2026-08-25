import { HtmlCleanerService } from './../html-cleaner.service';
import { Component } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { AngularEditorConfig } from '@local/angular-editor';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  constructor(private htmlCleanerService: HtmlCleanerService) {}
  htmlContent = '<p>Angular Editor v1.1.4 local source</p>';

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

  onSubmit() {
    console.log("this.htmlContent: ", this.htmlContent)

    const htmlCleaner = this.htmlCleanerService.sanitize(JSON.parse(JSON.stringify(this.htmlContent)));
    console.log("this.htmlContent: ", htmlCleaner)
  }

}
