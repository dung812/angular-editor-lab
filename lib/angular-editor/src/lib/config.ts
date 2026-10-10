
import {UploadResponse} from './angular-editor.service';
import {HttpEvent, HttpEventType} from '@angular/common/http';
import {Observable} from 'rxjs';
import {environment} from '../../environments/environment';
export interface CustomClass {
  name: string;
  class: string;
  tag?: string;
}

export interface Font {
  name: string;
  class: string;
}

export interface AngularEditorConfig {
  editable?: boolean;
  spellcheck?: boolean;
  height?: 'auto' | string;
  minHeight?: '0' | string;
  maxHeight?: 'auto' | string;
  width?: 'auto' | string;
  minWidth?: '0' | string;
  translate?: 'yes' | 'now' | string;
  enableToolbar?: boolean;
  showToolbar?: boolean;
  placeholder?: string;
  defaultParagraphSeparator?: string;
  defaultFontName?: string;
  defaultFontSize?: '1' | '2' | '3' | '4' | '5' | '6' | '7' | string;
  uploadUrl?: string;
  upload?: (file: File) => Observable<HttpEvent<UploadResponse>>;
  uploadWithCredentials?: boolean;
  fonts?: Font[];
  customClasses?: CustomClass[];
  sanitize?: boolean;
  toolbarPosition?: 'top' | 'bottom';
  outline?: boolean;
  toolbarHiddenButtons?: string[][];
  rawPaste?: boolean;
  previewMode?: boolean;
  urlPreviewMode?: string;
  sectionName?:string;
  clwId?: string;
  isFetchForFirstTimePreviewMode?: boolean;
}

export const angularEditorConfig: AngularEditorConfig = {
  editable: true,
  spellcheck: true,
  height: 'auto',
  minHeight: '0',
  maxHeight: 'auto',
  width: 'auto',
  minWidth: '0',
  translate: 'yes',
  enableToolbar: true,
  showToolbar: true,
  placeholder: 'Enter text here...',
  defaultParagraphSeparator: '',
  defaultFontName: '',
  defaultFontSize: '',
  fonts: [
    {class: 'arial', name: 'Arial'},
    {class: 'times-new-roman', name: 'Times New Roman'},
    {class: 'calibri', name: 'Calibri'},
    {class: 'comic-sans-ms', name: 'Comic Sans MS'}
  ],
  uploadUrl: 'v1/image',
  uploadWithCredentials: false,
  sanitize: true,
  toolbarPosition: 'top',
  outline: true,
  previewMode: false,
  urlPreviewMode: '',
  sectionName: '',
  clwId: '',
  // isFetchForFirstTimePreviewMode: true
  /*toolbarHiddenButtons: [
    ['bold', 'italic', 'underline', 'strikeThrough', 'superscript', 'subscript'],
    ['heading', 'fontName', 'fontSize', 'color'],
    ['justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull', 'indent', 'outdent'],
    ['cut', 'copy', 'delete', 'removeFormat', 'undo', 'redo'],
    ['paragraph', 'blockquote', 'removeBlockquote', 'horizontalLine', 'orderedList', 'unorderedList'],
    ['link', 'unlink', 'image', 'video']
  ]*/
};

export const httpUrlConfig = {
  POST_IMAGE_URL: environment.apiUrl + 'clw/upload-binary',
  GET_IMAGE_URL: (urlPreviewMode, sectionName) => `${environment.apiUrl}${sectionName}/${urlPreviewMode}?isPreview=true`,
  GET_ORIGINAL_DESCRIPTION: (urlPreviewMode, sectionName) => `${environment.apiUrl}${sectionName}/${urlPreviewMode}`,
  GET_TESTING_IMAGE_URL: (urlPreviewMode, sectionName, clw) => `${environment.apiUrl}clw/${clw}/sections/${sectionName}?path=${urlPreviewMode}&isPreview=true`,
  GET_TESTING_ORIGINAL_DESCRIPTION: (urlPreviewMode, sectionName, clw) => `${environment.apiUrl}clw/${clw}/sections/${sectionName}?path=${urlPreviewMode}`,
}
