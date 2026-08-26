import {inject, TestBed} from '@angular/core/testing';

import {AngularEditorService} from './angular-editor.service';
import {HttpClientModule} from '@angular/common/http';
import {DOCUMENT} from '@angular/common';

describe('AngularEditorService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ HttpClientModule ],
      providers: [AngularEditorService]
    });
  });

  it('should be created', inject([AngularEditorService], (service: AngularEditorService) => {
    expect(service).toBeTruthy();
  }));

  it('keeps command values compatible with the original API', inject(
    [AngularEditorService, DOCUMENT],
    (service: AngularEditorService, doc: Document) => {
      spyOn(doc, 'execCommand');

      service.executeCommand('insertHTML', '<strong>content</strong>');

      expect(doc.execCommand).toHaveBeenCalledWith(
        'insertHTML',
        false,
        '<strong>content</strong>',
      );
    },
  ));

  it('keeps formatBlock behavior compatible with the original API', inject(
    [AngularEditorService, DOCUMENT],
    (service: AngularEditorService, doc: Document) => {
      spyOn(doc, 'execCommand');

      service.executeCommand('h2', 'ignored-value');

      expect(doc.execCommand).toHaveBeenCalledWith('formatBlock', false, 'h2');
    },
  ));
});
