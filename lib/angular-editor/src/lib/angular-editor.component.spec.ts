import {waitForAsync, ComponentFixture, TestBed} from '@angular/core/testing';

import {AngularEditorComponent} from './angular-editor.component';
import {AngularEditorToolbarComponent} from './angular-editor-toolbar.component';
import {FormsModule} from '@angular/forms';
import {HttpClientModule} from '@angular/common/http';
import {AeSelectComponent} from './ae-select/ae-select.component';
import {AngularEditorModule} from './angular-editor.module';
import {angularEditorConfig} from './config';

describe('AngularEditorComponent', () => {
  let component: AngularEditorComponent;
  let fixture: ComponentFixture<AngularEditorComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [ FormsModule, HttpClientModule],
      declarations: [AngularEditorComponent, AngularEditorToolbarComponent, AeSelectComponent]
    })
      .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(AngularEditorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('maps the configured legacy font size to the editor CSS baseline', () => {
    component.config = Object.assign({}, angularEditorConfig, {
      defaultFontName: 'Arial',
      defaultFontSize: '3',
    });

    expect(component.getDefaultFontNameCss()).toBe('Arial');
    expect(component.getDefaultFontSizeCss()).toBe('14px');
    expect(component.useCompactDefaultFontSize()).toBe(true);
  });

  it('falls back to the shared editor typography defaults', () => {
    component.config = Object.assign({}, angularEditorConfig, {
      defaultFontName: '',
      defaultFontSize: 'invalid',
    });

    expect(component.getDefaultFontNameCss()).toBe('Arial');
    expect(component.getDefaultFontSizeCss()).toBe('14px');
    expect(component.useCompactDefaultFontSize()).toBe(true);
  });
});
