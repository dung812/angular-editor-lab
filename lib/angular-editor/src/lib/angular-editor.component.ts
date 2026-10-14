import {DOCUMENT} from '@angular/common';
import {
  AfterViewInit,
  Attribute,
  ChangeDetectorRef,
  Component,
  ContentChild,
  ElementRef,
  EventEmitter,
  forwardRef,
  HostBinding,
  HostListener,
  Inject,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  Renderer2,
  SecurityContext,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import {ControlValueAccessor, NG_VALUE_ACCESSOR} from '@angular/forms';
import {DomSanitizer} from '@angular/platform-browser';
import {AngularEditorToolbarComponent} from './angular-editor-toolbar.component';
import {AngularEditorService} from './angular-editor.service';
import {AngularEditorConfig, angularEditorConfig, httpUrlConfig} from './config';
import {isDefined} from './utils';
import {HttpClient} from '@angular/common/http';
import {ToastrService} from 'ngx-toastr';
import {EMPTY, Observable, Subject, concat, of, timer} from 'rxjs';
import {catchError, map, mergeMap, switchMap, takeUntil, timeout} from 'rxjs/operators';

import {
  ATTACHMENT_LOADING_CLASS,
  countAttachmentTokens,
  createAttachmentToken,
  EditorContentResponse,
  extractEditorContents,
  findPreviewOf,
  findRawOf,
  isRenderedAttachmentContent,
  markAttachmentTokens,
  stripEditorOnlyMarkup,
  UPLOAD_PLACEHOLDER_ATTR,
  withAttachmentPlaceholders,
} from './attachment-preview';
import {
  encodeSafeIndentationForSanitizer,
  restoreSafeIndentationAfterSanitizer,
} from './safe-indentation';
import { HtmlCleanerService } from 'src/html-cleaner.service';
import { Utils } from 'src/utils/utils';

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
const SERVER_PREVIEW_RETRY_DELAYS_MS = [1000, 2000, 4000];
const RAW_CONTENT_TIMEOUT_MS = 15000;
const TESTING_SECTIONS = ['testing', 'third-party-requirements', 'general-specimen-transportation'];

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
export class AngularEditorComponent implements OnInit, OnChanges, ControlValueAccessor, AfterViewInit, OnDestroy {
  private contentEditableDiv: HTMLElement;
  @ViewChild('editor', {static: false}) editor!: ElementRef;
  @ViewChild('previewPane', {static: true}) previewPane!: ElementRef;
  editorContent: string = '';
  isPreviewMode = false;
  isLoadingContent = false;
  pendingUploads = 0;
  /** Editable content with attachment tokens; `null` while only the server-rendered form is known. */
  private rawValue: string | null = '';
  private renderedValue = '';
  private hasModelBinding = false;
  private readonly previewRequests = new Subject<string | null>();
  private readonly rawContentRequests = new Subject<boolean>();
  private readonly destroy$ = new Subject<void>();
  private onChange: (value: string) => void;
  private onTouched: () => void;

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
  @Input() urlPreviewMode = '';
  @Input() placeholder = '';
  @Input() tabIndex: number | null;
  /** The consumer is still preparing the record (e.g. creating it); editing stays locked until it is false. */
  @Input() busy = false;

  @Output() html;
  /** Emits `true` on entering preview mode and `false` on entering edit mode. */
  @Output() previewModeChange = new EventEmitter<boolean>();

  @ViewChild('editor', {static: true}) textArea!: ElementRef;
  @ViewChild('editorWrapper', {static: true}) editorWrapper!: ElementRef;
  @ViewChild('editorToolbar', {static: false}) editorToolbar!: AngularEditorToolbarComponent;
  @ContentChild("customButtons") customButtonsTemplateRef?: ElementRef;
  executeCommandFn = this.executeCommand.bind(this);

  @Output() viewMode = new EventEmitter<boolean>();

  /** emits `blur` event when focused out from the textarea */
    // tslint:disable-next-line:no-output-native no-output-rename
  @Output('blur') blurEvent: EventEmitter<FocusEvent> = new EventEmitter<FocusEvent>();

  @Output() onFormatContent = new EventEmitter<any>();

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
    @Attribute('autofocus') private autoFocus: any,
    private http: HttpClient,
    private htmlCleanerService: HtmlCleanerService,
    private toastrService: ToastrService
  ) {
    const parsedTabIndex = Number(defaultTabIndex);
    this.tabIndex = (parsedTabIndex || parsedTabIndex === 0) ? parsedTabIndex : null;
  }

  ngOnInit() {
    this.config.toolbarPosition = this.config.toolbarPosition ? this.config.toolbarPosition : angularEditorConfig.toolbarPosition;
    if(this.config.previewMode) {
      this.config.editable = false;
    }
    this.isPreviewMode = !!this.config.previewMode;

    this.previewRequests.pipe(
      switchMap(raw => raw === null ? EMPTY : this.buildPreview(raw)),
      takeUntil(this.destroy$),
    ).subscribe(html => this.showPreviewHtml(html));

    this.rawContentRequests.pipe(
      switchMap(load => load ? this.fetchRawContent() : EMPTY),
      takeUntil(this.destroy$),
    ).subscribe(raw => this.onRawContentLoaded(raw));
  }

  ngOnChanges(changes: SimpleChanges) {
    const urlChange = changes['urlPreviewMode'];
    if (urlChange && !urlChange.firstChange) {
      this.refreshPreviewSource();
    }
  }

  ngAfterViewInit() {
    if (isDefined(this.autoFocus)) {
      this.focus();
    }
    this.refreshPreviewSource();
  }

  isContentEditable(): boolean {
    return this.config.previewMode
      ? !this.isPreviewMode && !this.isContentLocked
      : this.config.editable;
  }

  get isContentLocked(): boolean {
    return !this.isPreviewMode && (this.isLoadingContent || this.busy);
  }

  private refreshPreviewSource(): void {
    if (!this.hasModelBinding && this.urlPreviewMode) {
      this.loadUnboundContent();
    } else {
      this.renderPreview();
    }
  }

  /** Editors without ngModel/formControl have no other source for their content. */
  private loadUnboundContent(): void {
    this.http.get<EditorContentResponse>(this.originalContentUrl())
      .pipe(takeUntil(this.destroy$))
      .subscribe(response => {
        const contents = extractEditorContents(response);
        if (contents.length > 0 && !this.changed) {
          this.applyRawValue(contents[0]);
        }
      });
  }

  /**
   * Some list endpoints return content with attachment tokens already
   * rendered into <img>. That form is only shown; editing waits for the raw
   * content. Values arriving in edit mode come from the edit surface itself
   * (e.g. Reformat), so they are raw.
   */
  private applyModelValue(value: string): void {
    const awaitingRaw = this.isPreviewMode || this.isLoadingContent;
    if (awaitingRaw && isRenderedAttachmentContent(value)) {
      this.rawValue = null;
      this.renderedValue = value;
      this.refreshView('');
      this.renderPreview();
      return;
    }
    if (!awaitingRaw && value === this.rawValue) {
      // Rewriting identical content would reset the caret and drop upload placeholders.
      return;
    }
    this.cancelRawContentLoad();
    this.applyRawValue(value);
  }

  private applyRawValue(value: string): void {
    this.rawValue = value;
    this.refreshView(value);
    this.renderPreview();
  }

  private togglePreviewMode(): void {
    if (this.isPreviewMode) {
      this.enterEditMode();
    } else {
      this.enterPreviewMode();
    }
  }

  private enterEditMode(): void {
    this.isPreviewMode = false;
    this.previewRequests.next(null);
    if (this.rawValue === null) {
      this.isLoadingContent = true;
      this.rawContentRequests.next(true);
    }
    this.previewModeChange.emit(false);
  }

  private enterPreviewMode(): void {
    if (this.pendingUploads > 0) {
      this.toastrService.warning('Please wait until the image upload finishes.');
      return;
    }
    this.isPreviewMode = true;
    this.cancelRawContentLoad();
    // Consumers persist the note on a focusout without relatedTarget, so this blur doubles as the save trigger.
    this.editor.nativeElement.blur();
    this.renderPreview();
    this.previewModeChange.emit(true);
  }

  private cancelRawContentLoad(): void {
    if (this.isLoadingContent) {
      this.isLoadingContent = false;
      this.rawContentRequests.next(false);
    }
  }

  private fetchRawContent(): Observable<string | null> {
    return this.http.get<EditorContentResponse>(this.originalContentUrl()).pipe(
      timeout(RAW_CONTENT_TIMEOUT_MS),
      map(response => findRawOf(this.renderedValue, extractEditorContents(response))),
      catchError(() => of(null)),
    );
  }

  private onRawContentLoaded(raw: string | null): void {
    this.isLoadingContent = false;
    if (raw === null) {
      this.isPreviewMode = true;
      this.renderPreview();
      this.previewModeChange.emit(true);
      this.toastrService.error('Could not load the content for editing. Please try again.');
      return;
    }
    this.applyRawValue(raw);
  }

  private renderPreview(): void {
    if (!this.isPreviewMode) {
      return;
    }
    if (this.rawValue === null) {
      this.previewRequests.next(null);
      this.showPreviewHtml(this.renderedValue);
    } else {
      this.previewRequests.next(this.rawValue);
    }
  }

  private showPreviewHtml(html: string): void {
    this.r.setProperty(this.previewPane.nativeElement, 'innerHTML', html);
  }

  /**
   * The local content is the only source of text. The server is consulted
   * only to turn attachment tokens into images; until it returns a matching
   * render, tokens show a loading placeholder.
   */
  private buildPreview(raw: string): Observable<string> {
    if (!this.urlPreviewMode || countAttachmentTokens(raw) === 0) {
      return of(raw);
    }
    return concat(of(withAttachmentPlaceholders(raw)), this.fetchServerPreviewMatching(raw));
  }

  private fetchServerPreviewMatching(raw: string, attempt = 0): Observable<string> {
    return this.http.get<EditorContentResponse>(this.serverPreviewUrl()).pipe(
      map(response => findPreviewOf(raw, extractEditorContents(response))),
      catchError(() => of(null)),
      mergeMap(preview => {
        if (preview !== null) {
          return of(preview);
        }
        if (attempt >= SERVER_PREVIEW_RETRY_DELAYS_MS.length) {
          return of(raw);
        }
        return timer(SERVER_PREVIEW_RETRY_DELAYS_MS[attempt]).pipe(
          mergeMap(() => this.fetchServerPreviewMatching(raw, attempt + 1)),
        );
      }),
    );
  }

  private serverPreviewUrl(): string {
    return this.isTestingSection()
      ? httpUrlConfig.GET_TESTING_IMAGE_URL(this.urlPreviewMode, this.config.sectionName, this.config.clwId)
      : httpUrlConfig.GET_IMAGE_URL(this.urlPreviewMode, this.config.sectionName);
  }

  private originalContentUrl(): string {
    return this.isTestingSection()
      ? httpUrlConfig.GET_TESTING_ORIGINAL_DESCRIPTION(this.urlPreviewMode, this.config.sectionName, this.config.clwId)
      : httpUrlConfig.GET_ORIGINAL_DESCRIPTION(this.urlPreviewMode, this.config.sectionName);
  }

  private isTestingSection(): boolean {
    return TESTING_SECTIONS.indexOf(this.config.sectionName) !== -1;
  }

  ngAfterViewChecked() {
    // Safely wait for the editor DOM to be fully rendered
    if(this.editor) {
      const editorRoot = (this.editor as any).editor;
      if(editorRoot && editorRoot.editorContainer) {
        const editable = editorRoot.editorContainer.querySelector('[contenteditable]');
        if(editable && !this.contentEditableDiv) {
          this.contentEditableDiv = editable;
        }
      }
    }
  }

  insertMarkdown(markdown: string) {
    if(!this.textArea) {
      console.warn('TextArea is not available.');
      return;
    }

    const textAreaElement = this.textArea.nativeElement;

    // Check if the element is content-editable or a regular textarea
    if(textAreaElement.isContentEditable) {
      textAreaElement.focus();
      // Handle contentEditable div (live editor body)
      const selection = window.getSelection();
      if(!selection || selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      range.deleteContents();

      const span = createAttachmentToken(this.doc, markdown);
      range.insertNode(span);

      // Move the cursor after the inserted text
      range.setStartAfter(span);
      range.setEndAfter(span);
      selection.removeAllRanges();
      selection.addRange(range);
      this.onContentChange(textAreaElement);

      textAreaElement.focus();
    } else if (textAreaElement instanceof HTMLTextAreaElement) {
      // Handle regular textarea
      const cursorPos = textAreaElement.selectionStart;
      const text = textAreaElement.value;
      textAreaElement.value = text.slice(0, cursorPos) + markdown + text.slice(cursorPos);
      textAreaElement.selectionStart = cursorPos + markdown.length;
      textAreaElement.selectionEnd = textAreaElement.selectionStart;
    }

    textAreaElement.blur();
  }

  updateImage(file: File) {
    const reader = new FileReader();
    reader.onload = (e: ProgressEvent<FileReader>) => {
      const imageUrl = e.target.result as string;
      document.execCommand('insertImage', false, imageUrl);
    };
    reader.readAsDataURL(file);
  }

  /**
   * The placeholder is inserted at the caret right away, so the token lands
   * where the image was pasted even if the user keeps typing during the upload.
   */
  uploadImageForPreviewMode(file: any): void {
    const placeholder = this.insertUploadPlaceholder();
    this.pendingUploads++;

    const reader = new FileReader();
    reader.onload = () => {
      const pureBase64 = (reader.result as string).replace(/^data:image\/\w+;base64,/, '');
      const payload = {
        'imageData': pureBase64,
        'imageType': 'image/png',
      };

      this.http.post<{fileName: string}>(httpUrlConfig.POST_IMAGE_URL, payload)
        .pipe(takeUntil(this.destroy$))
        .subscribe(
          res => this.completeUpload(placeholder, `![attachment:${res.fileName}]`),
          () => this.completeUpload(placeholder, null),
        );
    };
    reader.onerror = () => this.completeUpload(placeholder, null);
    reader.readAsDataURL(file);
  }

  private insertUploadPlaceholder(): HTMLElement {
    const editorElement: HTMLElement = this.textArea.nativeElement;
    const placeholder: HTMLElement = this.doc.createElement('span');
    placeholder.setAttribute(UPLOAD_PLACEHOLDER_ATTR, 'true');
    placeholder.setAttribute('contenteditable', 'false');
    placeholder.className = ATTACHMENT_LOADING_CLASS;
    placeholder.textContent = 'Uploading image…';

    const selection: Selection | null = this.doc.getSelection();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    if (selection && range && editorElement.contains(range.commonAncestorContainer)) {
      range.deleteContents();
      range.insertNode(placeholder);
      range.setStartAfter(placeholder);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      editorElement.appendChild(placeholder);
    }
    // The upload placeholder never reaches the model, so onContentChange is not involved here.
    this.syncPlaceholder(false);
    return placeholder;
  }

  private completeUpload(placeholder: HTMLElement, markdown: string | null): void {
    this.pendingUploads--;
    if (markdown === null) {
      this.toastrService.error('Image upload failed. Please try again.');
    }
    const editorElement: HTMLElement = this.textArea.nativeElement;
    if (!editorElement.contains(placeholder)) {
      // The user deleted the placeholder, which cancels this image.
      return;
    }

    const parent = placeholder.parentNode!;
    if (markdown !== null) {
      // Insert-then-remove (not replaceChild) so a caret sitting after the placeholder ends up after the token.
      parent.insertBefore(createAttachmentToken(this.doc, markdown), placeholder);
    }
    parent.removeChild(placeholder);
    this.onContentChange(editorElement);
    this.requestSave();
  }

  /**
   * Consumers persist on a focusout without relatedTarget. Dispatching one
   * keeps the user's focus where it is, unlike the focus()/blur() pair.
   */
  private requestSave(): void {
    const editorElement: HTMLElement = this.textArea.nativeElement;
    if (this.doc.activeElement === editorElement) {
      // The user is still typing here; their own focusout will save.
      return;
    }
    editorElement.dispatchEvent(new FocusEvent('focusout', {bubbles: true, relatedTarget: null}));
  }

  compressImage(file: File, quality: number, callback: (blob: Blob) => void): void {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => {
      img.src = e.target.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        let { width, height } = img;
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if(blob) {
              callback(blob);
            }
          },
          'image/jpeg',
          quality
        );
      };
    };
    reader.readAsDataURL(file);
  }

  onPaste(event: ClipboardEvent) {
    if (!event.clipboardData) {
      return;
    }

    if (this.config.previewMode) {
      const items = Array.from(event.clipboardData.items);
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          event.preventDefault();
          this.uploadImageForPreviewMode(file);
          return;
        }
      }
    }

    else {
      const items = Array.from(event.clipboardData.items);
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          const EXCEED_MAX_SIZE_IMAGE = 219000;

          if(file && file.size > EXCEED_MAX_SIZE_IMAGE) {
            event.preventDefault();
            this.compressImage(file, 0.7, (compressedBlob) => {
              const compressedFile = new File([compressedBlob], file.name, {
                type: compressedBlob.type,
              });
              this.updateImage(compressedFile);
            });
            return;
          }
        }
      }
    }

    this.sanitizeContent();

    if (this.config.rawPaste) {
      event.preventDefault();
      const text = event.clipboardData.getData('text/plain');
      document.execCommand('insertHTML', false, text);
      return text;
    }
  }

  /**
   * Executed command from editor header buttons
   * @param command string from triggerCommand
   * @param value
   */
  executeCommand(command: string, value?: string) {
    if (this.isContentLocked && command !== 'preview') {
      return;
    }
    if (this.pendingUploads > 0 && command === 'sanitize-html') {
      // Reformat rewrites the content and would discard the upload placeholder.
      this.toastrService.warning('Please wait until the image upload finishes.');
      return;
    }

    this.focus();

    if (command === 'preview') {
      this.togglePreviewMode();
    }

    if(command === 'validate') {
      const result = this.htmlCleanerService.validateEditorContentForPDF(this.currentContent());
      if(!result.valid) {
        const message = 'Validation failed. Your content contains formatting issues that will impact the PDF export. Please select Reformat Content to fix the issues.';
        this.toastrService.warning(message);
      } else {
        this.toastrService.success('Your content has passed validation and is ready to be exported to PDF');
      }
    }

    if(command === 'sanitize-html') {
      this.onFormatContent.emit(stripEditorOnlyMarkup(this.editor.nativeElement.innerHTML));
    }

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
      if (!parent.classList.contains('angular-editor-toolbar-set') && !parent.classList.contains('ae-picker')) {
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

  sanitizeContent(): void {
    // Use setTimeout to wait for the browser's paste to complete
    setTimeout(() => {
      const editorElement = this.editor.nativeElement;
      const fullHtml = editorElement.innerHTML;
      const sanitizedHtml = Utils.sanitizeIfInvalid(fullHtml, fullHtml, this.htmlCleanerService);
      editorElement.innerHtml = sanitizedHtml;

      // Restore the cursor to the end of the editor
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(editorElement);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);

      this.onContentChange(editorElement);
    }, 0);
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
    this.rawValue = this.toModelValue(stripEditorOnlyMarkup(html));
    if (typeof this.onChange === 'function') {
      this.onChange(this.rawValue);
      this.syncPlaceholder(!html);
    }
    this.changed = true;
  }

  private currentContent(): string {
    return this.rawValue === null
      ? this.renderedValue
      : stripEditorOnlyMarkup(this.editor.nativeElement.innerHTML);
  }

  private toModelValue(html: string): string {
    const shouldSanitize = this.config.sanitize || this.config.sanitize === undefined;
    if (!shouldSanitize) {
      return html;
    }
    const encodedHtml = encodeSafeIndentationForSanitizer(html, this.doc);
    const sanitizedHtml = this.sanitizer.sanitize(SecurityContext.HTML, encodedHtml) || '';
    return restoreSafeIndentationAfterSanitizer(sanitizedHtml, this.doc);
  }

  /**
   * Set the function to be called
   * when the control receives a change event.
   *
   * @param fn a function
   */
  registerOnChange(fn: any): void {
    this.hasModelBinding = true;
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

    this.syncPlaceholder(!value || value === '<br>');

    if (value === undefined || value === '' || value === '<br>') {
      value = null;
    }

    this.applyModelValue(value === null ? '' : value);
  }

  /**
   * refresh view/HTML of the editor
   *
   * @param value html string from the editor
   */
  refreshView(value: string): void {
    const normalizedValue = value === null ? '' : value;
    this.r.setProperty(this.textArea.nativeElement, 'innerHTML', normalizedValue);
    markAttachmentTokens(this.textArea.nativeElement);

    return;
  }

  private syncPlaceholder(isEmpty: boolean): void {
    if (isEmpty !== this.showPlaceholder) {
      this.togglePlaceholder(this.showPlaceholder);
    }
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
      oContent = this.r.createText(stripEditorOnlyMarkup(editableElement.innerHTML));
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
      markAttachmentTokens(editableElement);
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
    const els = [];
    while (a && a.id !== 'editor') {
      els.unshift(a);
      a = a.parentNode;
    }
    this.editorToolbar.triggerBlocks(els);
  }

  private configure() {
    this.editorService.uploadUrl = this.config.uploadUrl;
    this.editorService.uploadWithCredentials = this.config.uploadWithCredentials;
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
    const fonts = this.config.fonts ? this.config.fonts : angularEditorConfig.fonts;
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
    this.config.customClasses.forEach(x => {
      if (x.tag !== undefined) {
        if (!tags.includes(x.tag)) {
          tags.push(x.tag);
        }
      }
    });
    return tags.join(',');
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
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
