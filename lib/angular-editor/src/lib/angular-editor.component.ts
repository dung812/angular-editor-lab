import {
  AfterViewInit,
  Attribute,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  forwardRef,
  HostBinding,
  HostListener,
  Inject,
  Input,
  OnDestroy,
  OnInit,
  Output,
  Renderer2,
  SecurityContext,
  ViewChild
} from '@angular/core';
import {ControlValueAccessor, NG_VALUE_ACCESSOR} from '@angular/forms';
import {AngularEditorConfig, angularEditorConfig} from './config';
import {AngularEditorToolbarComponent} from './angular-editor-toolbar.component';
import {AngularEditorService} from './angular-editor.service';
import {DOCUMENT} from '@angular/common';
import {DomSanitizer} from '@angular/platform-browser';
import {isDefined} from './utils';
import {
  encodeSafeIndentationForSanitizer,
  restoreSafeIndentationAfterSanitizer,
} from './safe-indentation';

const EDITOR_DEFAULT_FONT_FAMILY = 'Arial';
const EDITOR_COMPACT_DEFAULT_FONT_SIZE_PX = '14px';
const EDITOR_LEGACY_FONT_SIZE_PX: { [size: string]: string } = {
  '1': '10px',
  '2': '13px',
  '3': '16px',
  '4': '18px',
  '5': '24px',
  '6': '32px',
  '7': '48px',
};

@Component({
  selector: 'angular-editor',
  templateUrl: './angular-editor.component.html',
  styleUrls: ['./angular-editor.component.scss'],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => AngularEditorComponent),
      multi: true
    },
    AngularEditorService
  ]
})
export class AngularEditorComponent implements OnInit, ControlValueAccessor, AfterViewInit, OnDestroy {

  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  modeVisual = true;
  showPlaceholder = false;
  disabled = false;
  focused = false;
  touched = false;
  changed = false;

  focusInstance: any;
  blurInstance: any;

  @Input() id = '';
  @Input() config: AngularEditorConfig = angularEditorConfig;
  @Input() placeholder = '';
  @Input() tabIndex: number | null;

  @Output() html = new EventEmitter<string>();

  @ViewChild('editor', {static: true}) textArea!: ElementRef;
  @ViewChild('editorWrapper', {static: true}) editorWrapper!: ElementRef;
  @ViewChild('editorToolbar', {static: false}) editorToolbar!: AngularEditorToolbarComponent;

  @Output() viewMode = new EventEmitter<boolean>();

  /** emits `blur` event when focused out from the textarea */
    // tslint:disable-next-line:no-output-native no-output-rename
  @Output('blur') blurEvent: EventEmitter<FocusEvent> = new EventEmitter<FocusEvent>();

  /** emits `focus` event when focused in to the textarea */
    // tslint:disable-next-line:no-output-rename no-output-native
  @Output('focus') focusEvent: EventEmitter<FocusEvent> = new EventEmitter<FocusEvent>();

  @HostBinding('attr.tabindex') tabindex = -1;

  @HostListener('focus')
  onFocus() {
    this.focus();
  }

  constructor(
    private r: Renderer2,
    private editorService: AngularEditorService,
    @Inject(DOCUMENT) private doc: any,
    private sanitizer: DomSanitizer,
    private cdRef: ChangeDetectorRef,
    @Attribute('tabindex') defaultTabIndex: string,
    @Attribute('autofocus') private autoFocus: any
  ) {
    const parsedTabIndex = Number(defaultTabIndex);
    this.tabIndex = (parsedTabIndex || parsedTabIndex === 0) ? parsedTabIndex : null;
  }

  ngOnInit() {
    this.config.toolbarPosition = this.config.toolbarPosition ? this.config.toolbarPosition : angularEditorConfig.toolbarPosition;
  }

  ngAfterViewInit() {
    if (isDefined(this.autoFocus)) {
      this.focus();
    }
  }

  /**
   * Executed command from editor header buttons
   * @param command string from triggerCommand
   * @param value optional value passed through to AngularEditorService
   */
  executeCommand(command: string, value?: string) {
    this.focus();
    if (command === 'focus') {
      return;
    }
    if (command === 'toggleEditorMode') {
      this.toggleEditorMode(this.modeVisual);
    } else if (command !== '') {
      if (command === 'clear') {
        this.editorService.removeSelectedElements(this.getCustomTags());
        this.onContentChange(this.textArea.nativeElement);
      } else if (command === 'default') {
        this.editorService.removeSelectedElements('h1,h2,h3,h4,h5,h6,p,pre');
        this.onContentChange(this.textArea.nativeElement);
      } else {
        let handledBySafeIndentation = false;
        if (command === 'indent' || command === 'outdent') {
          handledBySafeIndentation =
            this.editorService.executeSafeIndentationCommand(
              command,
              this.textArea.nativeElement,
            );
        }

        if (handledBySafeIndentation) {
          this.onContentChange(this.textArea.nativeElement);
        } else {
          this.editorService.executeCommand(command, value);
        }
      }
      this.exec();
    }
  }

  /**
   * focus event
   */
  onTextAreaFocus(event: FocusEvent): void {
    if (this.focused) {
      event.stopPropagation();
      return;
    }
    this.focused = true;
    this.focusEvent.emit(event);
    if (!this.touched || !this.changed) {
      this.editorService.executeInNextQueueIteration(() => {
        this.configure();
        this.touched = true;
      });
    }
  }

  /**
   * @description fires when cursor leaves textarea
   */
  public onTextAreaMouseOut(event: MouseEvent): void {
    this.editorService.saveSelection();
  }

  /**
   * blur event
   */
  onTextAreaBlur(event: FocusEvent) {
    /**
     * save selection if focussed out
     */
    this.editorService.executeInNextQueueIteration(this.editorService.saveSelection);

    if (typeof this.onTouched === 'function') {
      this.onTouched();
    }

    if (event.relatedTarget !== null) {
      const parent = (event.relatedTarget as HTMLElement).parentElement;
      if (parent && !parent.classList.contains('angular-editor-toolbar-set') && !parent.classList.contains('ae-picker')) {
        this.blurEvent.emit(event);
        this.focused = false;
      }
    }
  }

  /**
   *  focus the text area when the editor is focused
   */
  focus() {
    if (this.modeVisual) {
      this.textArea.nativeElement.focus();
    } else {
      const sourceText = this.doc.getElementById('sourceText' + this.id);
      sourceText.focus();
      this.focused = true;
    }
  }

  /**
   * Executed from the contenteditable section while the input property changes
   * @param element html element from contenteditable
   */
  onContentChange(element: HTMLElement): void {
    let html = '';
    if (this.modeVisual) {
      html = element.innerHTML;
    } else {
      html = element.innerText;
    }
    if ((!html || html === '<br>')) {
      html = '';
    }
    if (typeof this.onChange === 'function') {
      let changedHtml = html;
      if (this.config.sanitize || this.config.sanitize === undefined) {
        const encodedHtml = encodeSafeIndentationForSanitizer(html, this.doc);
        const sanitizedHtml = this.sanitizer.sanitize(
          SecurityContext.HTML,
          encodedHtml,
        ) || '';
        changedHtml = restoreSafeIndentationAfterSanitizer(
          sanitizedHtml,
          this.doc,
        );
      }
      this.onChange(changedHtml);
      if ((!html) !== this.showPlaceholder) {
        this.togglePlaceholder(this.showPlaceholder);
      }
    }
    this.changed = true;
  }

  /**
   * Set the function to be called
   * when the control receives a change event.
   *
   * @param fn a function
   */
  registerOnChange(fn: any): void {
    this.onChange = e => (e === '<br>' ? fn('') : fn(e)) ;
  }

  /**
   * Set the function to be called
   * when the control receives a touch event.
   *
   * @param fn a function
   */
  registerOnTouched(fn: any): void {
    this.onTouched = fn;
  }

  /**
   * Write a new value to the element.
   *
   * @param value value to be executed when there is a change in contenteditable
   */
  writeValue(value: any): void {

    if ((!value || value === '<br>' || value === '') !== this.showPlaceholder) {
      this.togglePlaceholder(this.showPlaceholder);
    }

    if (value === undefined || value === '' || value === '<br>') {
      value = null;
    }

    this.refreshView(value);
  }

  /**
   * refresh view/HTML of the editor
   *
   * @param value html string from the editor
   */
  refreshView(value: string): void {
    const normalizedValue = value === null ? '' : value;
    this.r.setProperty(this.textArea.nativeElement, 'innerHTML', normalizedValue);

    return;
  }

  /**
   * toggles placeholder based on input string
   *
   * @param value A HTML string from the editor
   */
  togglePlaceholder(value: boolean): void {
    if (!value) {
      this.r.addClass(this.editorWrapper.nativeElement, 'show-placeholder');
      this.showPlaceholder = true;

    } else {
      this.r.removeClass(this.editorWrapper.nativeElement, 'show-placeholder');
      this.showPlaceholder = false;
    }
  }

  /**
   * Implements disabled state for this element
   *
   * @param isDisabled Disabled flag
   */
  setDisabledState(isDisabled: boolean): void {
    const div = this.textArea.nativeElement;
    const action = isDisabled ? 'addClass' : 'removeClass';
    this.r[action](div, 'disabled');
    this.disabled = isDisabled;
  }

  /**
   * toggles editor mode based on bToSource bool
   *
   * @param bToSource A boolean value from the editor
   */
  toggleEditorMode(bToSource: boolean) {
    let oContent: any;
    const editableElement = this.textArea.nativeElement;

    if (bToSource) {
      oContent = this.r.createText(editableElement.innerHTML);
      this.r.setProperty(editableElement, 'innerHTML', '');
      this.r.setProperty(editableElement, 'contentEditable', false);

      const oPre = this.r.createElement('pre');
      this.r.setStyle(oPre, 'margin', '0');
      this.r.setStyle(oPre, 'outline', 'none');

      const oCode = this.r.createElement('code');
      this.r.setProperty(oCode, 'id', 'sourceText' + this.id);
      this.r.setStyle(oCode, 'display', 'block');
      this.r.setStyle(oCode, 'white-space', 'pre-wrap');
      this.r.setStyle(oCode, 'word-break', 'keep-all');
      this.r.setStyle(oCode, 'outline', 'none');
      this.r.setStyle(oCode, 'margin', '0');
      this.r.setStyle(oCode, 'background-color', '#fff5b9');
      this.r.setProperty(oCode, 'contentEditable', true);
      this.r.appendChild(oCode, oContent);
      this.focusInstance = this.r.listen(oCode, 'focus', (event) => this.onTextAreaFocus(event));
      this.blurInstance = this.r.listen(oCode, 'blur', (event) => this.onTextAreaBlur(event));
      this.r.appendChild(oPre, oCode);
      this.r.appendChild(editableElement, oPre);

      // ToDo move to service
      this.doc.execCommand('defaultParagraphSeparator', false, 'div');

      this.modeVisual = false;
      this.viewMode.emit(false);
      oCode.focus();
    } else {
      if (this.doc.querySelectorAll) {
        this.r.setProperty(editableElement, 'innerHTML', editableElement.innerText);
      } else {
        oContent = this.doc.createRange();
        oContent.selectNodeContents(editableElement.firstChild);
        this.r.setProperty(editableElement, 'innerHTML', oContent.toString());
      }
      this.r.setProperty(editableElement, 'contentEditable', true);
      this.modeVisual = true;
      this.viewMode.emit(true);
      this.onContentChange(editableElement);
      editableElement.focus();
    }
    this.editorToolbar.setEditorMode(!this.modeVisual);
  }

  /**
   * toggles editor buttons when cursor moved or positioning
   *
   * Send a node array from the contentEditable of the editor
   */
  exec() {
    this.editorToolbar.triggerButtons();

    let userSelection;
    if (this.doc.getSelection) {
      userSelection = this.doc.getSelection();
      this.editorService.executeInNextQueueIteration(this.editorService.saveSelection);
    }

    let a = userSelection.focusNode;
    const els: any[] = [];
    while (a && a.id !== 'editor') {
      els.unshift(a);
      a = a.parentNode;
    }
    this.editorToolbar.triggerBlocks(els);
  }

  private configure() {
    this.editorService.uploadUrl = this.config.uploadUrl ?? angularEditorConfig.uploadUrl ?? '';
    this.editorService.uploadWithCredentials =
      this.config.uploadWithCredentials ?? angularEditorConfig.uploadWithCredentials ?? false;
    if (this.config.defaultParagraphSeparator) {
      this.editorService.setDefaultParagraphSeparator(this.config.defaultParagraphSeparator);
    }
    if (this.config.defaultFontName) {
      this.editorService.setFontName(this.config.defaultFontName);
    }
    if (this.config.defaultFontSize) {
      this.editorService.setFontSize(this.config.defaultFontSize);
    }
  }

  getFonts() {
    const fonts = this.config.fonts || angularEditorConfig.fonts || [];
    return fonts.map(x => {
      return {label: x.name, value: x.name};
    });
  }

  /**
   * Keep the contenteditable baseline aligned with HtmlCleanerService.
   * execCommand('fontName'/'fontSize') only affects the active selection and
   * does not provide a reliable default for HTML loaded back into the editor.
   */
  getDefaultFontNameCss(): string {
    return this.config.defaultFontName || EDITOR_DEFAULT_FONT_FAMILY;
  }

  getDefaultFontSizeCss(): string {
    const configured = this.config.defaultFontSize || '3';
    if (configured === '3' || configured.toLowerCase() === '16px') {
      return EDITOR_COMPACT_DEFAULT_FONT_SIZE_PX;
    }

    const legacySize = EDITOR_LEGACY_FONT_SIZE_PX[configured];
    if (legacySize) return legacySize;

    const pixelSize = /^(\d+(?:\.\d+)?)px$/i.exec(configured);
    if (!pixelSize) return EDITOR_COMPACT_DEFAULT_FONT_SIZE_PX;

    const value = Number(pixelSize[1]);
    return value >= 6 && value <= 96
      ? value + 'px'
      : EDITOR_COMPACT_DEFAULT_FONT_SIZE_PX;
  }

  /** True when the default 16px content should be rendered as 14px in UI. */
  useCompactDefaultFontSize(): boolean {
    return this.getDefaultFontSizeCss() === EDITOR_COMPACT_DEFAULT_FONT_SIZE_PX;
  }

  getCustomTags() {
    const tags = ['span'];
    (this.config.customClasses || []).forEach(x => {
      if (x.tag !== undefined) {
        if (!tags.includes(x.tag)) {
          tags.push(x.tag);
        }
      }
    });
    return tags.join(',');
  }

  ngOnDestroy() {
    if (this.blurInstance) {
      this.blurInstance();
    }
    if (this.focusInstance) {
      this.focusInstance();
    }
  }

  filterStyles(html: string): string {
    html = html.replace('position: fixed;', '');
    return html;
  }
}
