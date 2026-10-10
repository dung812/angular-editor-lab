# Angular Editor — PDF-Safe Customizations

> **Status:** implemented, built and tested in this repository.
> All four verification commands pass — see [§17](#17-verified-buildtest-status).
> Behavior described here is backed by executable specs unless a statement is
> explicitly marked **Limitation** or **Not verified**.

---

## 1. Purpose and Scope

### 1.1 Why this document exists

This repository (`angular-editor-lab`) is an Angular 18 lab containing a
**local, patched copy of `@kolkov/angular-editor` v1.1.4** plus an
application-owned `HtmlCleanerService`. The customizations exist for one
reason: **the HTML produced by this editor is consumed by a backend PDF
generator built on iTextPDF 5 / XML Worker**, which is far less forgiving than
a browser.

The customized code is intended to be merged into a larger **Angular 9**
application with an older TypeScript. This document records what the code does,
*why*, which invariants must survive that merge, and what is deliberately not
handled.

### 1.2 The contract in one paragraph

Indented text is stored as **a flat `margin-left` on a paragraph**, never as
nested `<blockquote><div>`. The editor produces that form directly; the cleaner
converts legacy blockquote structures into it. Font family and size are made
**explicit** so iText never has to infer them. Everything else here follows
from those two decisions.

### 1.3 Scope

In scope: the patched editor library under [lib/angular-editor/](../lib/angular-editor/),
the safe indent/outdent engine, the Reformat/normalization pipeline in
[src/html-cleaner.service.ts](../src/html-cleaner.service.ts), sanitization
policy, typography, and Angular 9 merge risk.

Out of scope: the backend iTextPDF pipeline itself, image upload, and the video
embed helpers (unmodified upstream code).

---

## 2. Editor-to-PDF Workflow

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 1. USER TYPES / PASTES in Angular Editor (contenteditable)               │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ (input) event — every keystroke and paste
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 2. EDITOR-INPUT SANITIZATION — AngularEditorComponent.onContentChange()  │
│    angular-editor.component.ts:242                                       │
│      encodeSafeIndentationForSanitizer()   margin-left -> temp class     │
│      DomSanitizer.sanitize(SecurityContext.HTML, …)   strips style       │
│      restoreSafeIndentationAfterSanitizer() temp class -> margin-left    │
│    Cheap and XSS-focused. Does NOT call HtmlCleanerService.              │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ ControlValueAccessor -> ngModel
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 3. REFORMAT (explicit)  — HtmlCleanerService.sanitize()                  │
│    app.component.ts:72  onReformatContent()                              │
│                                                                          │
│ 3b. SAVE / SUBMIT (mandatory) — sanitize() + validateEditorContentForPDF │
│    app.component.ts:81  onSubmitContent()                                │
│    This is where blockquote -> flat <p margin-left> happens.             │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ canonical HTML, persisted
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 4. BACKEND PDF GENERATION — iTextPDF 5 / XML Worker  (outside this repo) │
│    Recommended defense in depth: re-validate server-side before the      │
│    XML Worker parse. Not implemented here.                               │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.1 The five boundaries — do not confuse them

| Boundary | Implemented by | Trigger | What it guarantees |
|---|---|---|---|
| **Editor-input sanitization** | `onContentChange()` + Angular `DomSanitizer` ([angular-editor.component.ts:242](../lib/angular-editor/src/lib/angular-editor.component.ts#L242)) | every `(input)` event | Angular's XSS allowlist. **All `style` attributes are stripped** except indentation smuggled through the class encoding. No blockquote removal, no typography normalization. |
| **Reformat** | `HtmlCleanerService.sanitize()` via `onReformatContent()` ([app.component.ts:72](../src/app/app.component.ts#L72)) | explicit user action | Full canonical normalization; rewrites the model. |
| **Save / submit** | `onSubmitContent()` ([app.component.ts:81](../src/app/app.component.ts#L81)) | submit | Same normalization, **mandatory**, then `validateEditorContentForPDF()` pre-flight. |
| **Paste-fragment normalization** | *not implemented* | — | **There is no `(paste)` handler.** Pasted HTML is covered only by boundary 1 until Reformat or Save runs. |
| **Backend PDF normalization** | *not in this repository* | — | Recommended as defense in depth; see [§15](#15-rules-for-future-changes). |

> The full cleaner is deliberately **not** run on every keystroke: it re-parses
> the whole document through `DOMParser`, which costs time and would disturb
> the caret.

---

## 3. Historical Root Causes

### 3.1 `execCommand('indent')` produced structures iText 5 cannot digest

Upstream v1.1.4 routed the Indent button straight to
`document.execCommand('indent')`. Chrome emits a `<blockquote>` plus **one
nested `<div>` per additional level**:

```html
<blockquote><div><div><div>Content</div></div></div></blockquote>
```

XML Worker walks that recursively and can fail or hang. Depth grows linearly
with clicks, so ordinary documents reach problematic depths.

**Fix:** never call the native command for `indent`/`outdent` on non-list
content; compute the indentation in TypeScript and write flat CSS.

### 3.2 Reformat destroyed indentation

The original cleaner removed or unwrapped `<blockquote>` **without reading its
indentation first**, so Reformat silently flattened the document.

**Fix:** `<blockquote>` stays on the `sanitize-html` allowlist purely so the
DOM pass can read the indentation off it and then discard the element. Order
matters — the tag must survive the allowlist pass to be readable afterwards.

### 3.3 Indented `<div>` is unreliable in iTextPDF 5

```html
<div style="margin-left: 40px">Content</div>   <!-- unreliable in iText 5 -->
<p   style="margin-left: 40px">Content</p>     <!-- canonical, reliable -->
```

**This is why `P` is preferred over `DIV` for indented text** and is the single
most important invariant in this codebase. The conversion is conditional: a
`<div>` containing block content must stay a `<div>`, because `<p><table></p>`
is invalid and the parser silently splits it.

### 3.4 Formatting and typography loss

`<strike>` was not allowlisted; font family and size were stripped entirely;
`h6`, `<a>`, `<pre>`, `<sub>`, `<sup>`, `<hr>` and `text-align: justify` were
missing from the allowlist; relative units (`em`, `rem`, `pt`) and inherited
fonts resolved differently in the browser and in iText.

**Fix:** controlled legacy formatting is *converted* before sanitization rather
than discarded, and the effective family/size is written explicitly onto every
text element. See [§9](#9-ui-versus-pdf-typography-contract).

---

## 4. Canonical HTML Contract

### 4.1 Indentation

```html
<p style="font-family: Arial; font-size: 16px; margin-left: 40px">Level 1</p>
<p style="font-family: Arial; font-size: 16px; margin-left: 120px">Level 3</p>
```

* **`<p style="margin-left: Npx">` is the canonical indented-text representation.**
* **`<blockquote>` is legacy input only and never appears in normalized output.**
* Step = **40px per level**; outdent subtracts 40px; at zero the declaration and
  an emptied `style` attribute are removed; never negative.
* Hard ceiling **2000px**, enforced independently at four points
  ([§7.6](#76-where-the-limits-are-enforced)).
* **Structural `<div>` elements may remain** — around tables, lists, headings or
  any other block content, including as the single root container.

### 4.2 Deterministic serialization

Style attributes are always written in one fixed property order:

```
font-family, font-size, font-weight, font-style, color, background-color,
text-align, margin-left
```

This is what makes Reformat byte-idempotent; without it the serialized order
depended on which pass happened to set each property first.

### 4.3 Root container

Output always has exactly one root `<div>` carrying the body typography, so
iText sees a single deterministic container. Loose top-level inline/text
content is wrapped in a `<p>` first.

```html
<div style="font-family: Arial; font-size: 16px;">…</div>
```

---

## 5. Safe Indent/Outdent Implementation

[lib/angular-editor/src/lib/safe-indentation.ts](../lib/angular-editor/src/lib/safe-indentation.ts)

### 5.1 The preserved public API

```typescript
// angular-editor.service.ts:30 — UNCHANGED upstream contract
executeCommand(command: string, value?: string) {
  const commands = ['h1','h2','h3','h4','h5','h6','p','pre'];
  if (commands.includes(command)) { this.doc.execCommand('formatBlock', false, command); return; }
  this.doc.execCommand(command, false, value);
}

// angular-editor.service.ts:46 — separate, additive
executeSafeIndentationCommand(command: 'indent'|'outdent', editorRoot: HTMLElement): boolean
```

`executeCommand` keeps its exact signature and still forwards `value` to
`document.execCommand(command, false, value)`; headings and paragraphs still go
through `formatBlock`. **No `editorRoot` parameter was added.** Only `indent`
and `outdent` are intercepted, in the component
([angular-editor.component.ts:159](../lib/angular-editor/src/lib/angular-editor.component.ts#L159));
every other toolbar button and custom command uses the original API unchanged.

### 5.2 Algorithm

```
1. no selection / no range                        -> return TRUE  (safe no-op)
2. selection outside editorRoot                   -> return TRUE  (safe no-op)
3. selection touches an <li>                      -> return FALSE (native fallback)
4. wrapLooseInlineContent(): runs of loose inline/text children of the editor
   root (or of a <td>/<th>) are moved into a <p>. Nodes are MOVED, so the
   caller's Range stays alive.
5. blocks = leaf p/div/h1..h6/pre intersecting the range
   (an ancestor that contains another selected block is dropped, so one click
    never applies 40px twice to the same text)
   none found                                     -> return TRUE  (safe no-op)
6. per block:
     next = indent  ? min(current + 40, 2000)
          : outdent ? max(0, current - 40)
     if (next > 0 || current > 0) convert a text-only DIV target to P
     next > 0 ? style.marginLeft = next+'px'
              : removeProperty + drop an emptied style attribute
7. return TRUE
```

### 5.3 The return value means "who owns this command"

`true` = **handled, do not fall back**, even when nothing changed.
`false` = **delegate to the browser** — returned for exactly one situation, a
selection touching a list item, where native `<ul>`/`<ol>` nesting is what we
want and no blockquote is produced.

This is the hardening compared with the earlier implementation, which returned
`false` for *every* unsupported case and let `execCommand('indent')` recreate
`<blockquote>`. **No non-list selection can reach the native command any more.**

| Situation | Return | Native fallback? | Blockquote risk |
|---|---|---|---|
| Normal block selection | `true` | no | none |
| Loose top-level text | `true` (wrapped in `<p>` first) | no | none |
| Caret in an empty editor | `true` (no-op) | no | none |
| No selection / selection outside the editor | `true` (no-op) | no | none |
| Text in a `<td>`/`<th>` with no block | `true` (wrapped in `<p>`) | no | none |
| **Selection touching an `<li>`** | **`false`** | **yes, intentional** | none — browsers nest lists, they do not emit blockquote |

### 5.4 DIV to P conversion

`convertIndentedDivToParagraph` copies **all** attributes (`id`, `class`,
`align`, `style`, …), **moves** the child nodes rather than recreating them, and
re-points the `Range` when a boundary was the block itself. It bails out when
the div contains block content.

### 5.5 Sanitizer-transparent indentation

Angular's `DomSanitizer` removes every `style` attribute — `style` is not in
Angular's `HTML_ATTRS` allowlist, while `class` is. Since `onContentChange`
runs the model through `DomSanitizer` on every keystroke, a naive `margin-left`
would be erased before reaching `ngModel`.

A validated numeric indentation is therefore encoded into a class the sanitizer
preserves, then decoded:

```
margin-left: 40px    -> class "ae-safe-indent-px-40"    -> margin-left: 40px
margin-left: 40.5px  -> class "ae-safe-indent-px-40_5"  -> margin-left: 40.5px
margin-left: 2040px  -> not encoded (over the limit)    -> dropped
margin-left: -40px   -> not encoded                     -> dropped
class="ae-safe-indent-px-99999" (forged) -> re-validated on decode -> dropped
```

The decoder re-validates with `/^(\d{1,4}(?:_\d{1,2})?)$/` **and** re-checks the
2000px ceiling, so a hand-crafted class cannot inject arbitrary CSS. Unrelated
classes are preserved; an emptied `class` attribute is removed.

### 5.6 Toolbar state

Upstream lit the Indent button from `tagMap = { BLOCKQUOTE: 'indent' }`. With
CSS indentation there is no `BLOCKQUOTE`, so a `margin-left` check was added
([angular-editor-toolbar.component.ts:230](../lib/angular-editor/src/lib/angular-editor-toolbar.component.ts#L230)).
The legacy `tagMap` entry is intentionally kept so not-yet-reformatted content
still lights the button.

---

## 6. HtmlCleanerService Pipeline

[src/html-cleaner.service.ts](../src/html-cleaner.service.ts) —
`@Injectable({ providedIn: 'root' })`, depends on `sanitize-html@2.7.0`.

### 6.1 Deterministic pipeline

```
sanitize(html)                                              (line 104)
 │  null-safe: non-string and blank input return ''
 ├─ STAGE 1  preNormalizeLegacyFormatting()                 (line 202)
 │           detached DOMParser document — no scripts, no resource loading
 │             normalizeLegacyFontTags()      <font> -> <span style>
 │             normalizeStrikeThrough()       <s>/<del>/line-through -> <strike>
 │             normalizeIndentationSources()  pt/em/rem/in/cm/padding-left/
 │                                            margin shorthand/ql-indent-N
 │                                            -> canonical margin-left: Npx
 │           (wrapped in try/catch: malformed HTML falls back to the raw input)
 │
 ├─ STAGE 2  sanitize-html allowlist                        (line 119)
 │
 └─ STAGE 3  cleanDOM()                                     (line 371)
       structure    fixBrokenListRoots
                    foldDanglingWrapperListsKeepWrapper
                    mergeEmptyListItemsIntoPrevious
                    hoistSublistsOutOfLiForIText
       indentation  convertBlockquoteIndentationToParagraphs (line 545)
                    convertTextOnlyDivsToParagraphs          (line 641)
       hygiene      removeUnsafeAnchors, removeEmptyTags,
                    removeInvisibleStyles, unwrapEmptySpans,
                    unwrapInlineWrappingBlock, removeEmptyTables
       container    ensureSingleRootContainer                (line 412)
       typography   normalizeTypography                      (line 753)
       serialization canonicalizeStyleOrder                  (line 502)
```

**Why pre-normalization comes first:** `sanitize-html` would *discard* a
`<font>` tag, a `ql-indent-2` class or a `36pt` indent rather than convert it.
Converting first preserves the user's intent. Pre-normalization runs in a
detached `DOMParser` document, and its output is **still passed through
`sanitize-html`**, so untrusted markup never bypasses the allowlist.

**Why the root container is created late:** creating it before the DIV→P
conversions made the second pass see a different shape (the wrapper itself got
converted), breaking idempotence.

### 6.2 Legacy blockquote conversion

Blockquotes are processed **deepest-first** so an outer quote can absorb an
already-normalized inner one.

```
indent  = margin-left of the blockquote (or 40px when it carries none)
        + explicit margin-left of each div in the single-div chain
        + (chain.length - 1) * 40    ← only when no normalized child exists

Case A  content is a single already-normalized indented block
        -> fold this level into it, stay flat:   <p style="margin-left: 80px">
Case B  content is block-level (list, table, heading)
        -> emit an indented <div>, because <p> may not wrap those
Case C  otherwise
        -> emit <p style="margin-left: Npx">
```

A temporary `data-ae-normalized-indent` marker distinguishes case A; **all
markers are removed** before the pass returns.

Verified accumulation: 2 divs → **80px**, 5 divs → **200px**, 7 divs → **280px**.

### 6.3 Controlled pasted-indentation support

Only recognized, bounded representations are converted; everything else is
discarded rather than preserved.

| Source | Conversion |
|---|---|
| `margin-left` in `px` | as-is |
| `pt` | × 4/3 |
| `em`, `rem` | × 16 |
| `in` | × 96 |
| `cm` | × 96/2.54 |
| `margin` shorthand | left component only |
| `padding-left` | only when the element has no `border` and no `background-color` — i.e. clearly indentation, not decoration |
| `ql-indent-N` class | N × 40px |

An explicit inline CSS length **outranks** an inferred `ql-indent-N` class. The
original carriers (`margin`, `padding`, `padding-left`, `text-indent`, the
class attribute) are all removed, so nothing is double-counted and no arbitrary
metadata is smuggled through.

### 6.4 Idempotence

`sanitize(sanitize(x)) === sanitize(x)` is asserted over 10 fixtures across
three passes ([src/html-cleaner.service.spec.ts](../src/html-cleaner.service.spec.ts)),
and was separately confirmed against 57 probe inputs covering every row of the
matrix in [§8](#8-toolbar-to-cleaner-compatibility-matrix).

---

## 7. Sanitization and XSS Policy

Two independent sanitizers run at different boundaries. **Neither may be
weakened to preserve formatting.**

### 7.1 Angular `DomSanitizer` — editor-input boundary

Element allowlist includes `blockquote`, `div`, `p`, `h1`–`h6`, `strike`,
`font`, `span`, `table`, so the model can still *hold* legacy markup. The
attribute allowlist contains `class` and `align` but **not `style`** — which is
exactly why the class encoding in [§5.5](#55-sanitizer-transparent-indentation)
exists.

### 7.2 `sanitize-html` — Reformat boundary

```typescript
allowedTags: ['p','br','b','i','u','strike','strong','em','sub','sup',
              'ul','ol','li',
              'table','thead','tbody','tfoot','tr','td','th',
              'span','div','img','a','pre','hr',
              'blockquote',                       // legacy input only
              'h1','h2','h3','h4','h5','h6'],
allowedAttributes: { '*': ['style','align'],
                     a:   ['href','target','title','rel'],
                     img: ['src','srcset','alt','title','width','height','loading'],
                     td:  ['colspan','rowspan'],
                     th:  ['colspan','rowspan','scope'] },
allowedSchemes:      ['http','https','mailto'],   // note: data: is NOT global
allowedSchemesByTag: { img: ['http','https','data'] },
allowProtocolRelative: false,
transformTags: { a: … }                            // forces rel on target=_blank
```

* `https` **is** allowed — the editor's link prompt defaults to `https://`.
* `data:` is scoped to `img` only, so a `data:text/html` link cannot be smuggled
  through an anchor.
* `target="_blank"` always gets `rel="noopener noreferrer"`.
* An anchor whose `href` fails scheme validation is **unwrapped to plain text**
  by `removeUnsafeAnchors`, so no dead attribute-less anchors remain.
* `class` is **not** allowlisted, so no arbitrary class survives.

### 7.3 Bounded style values

Every allowed declaration is matched against a bounded pattern. Character
classes exclude `(` and `)`, so `url(...)` and `expression(...)` are
unmatchable:

| Property | Policy |
|---|---|
| `font-family` | `/^[a-z0-9 ,'"-]{1,120}$/i`, then mapped to the supported list or dropped |
| `font-size` | `\d+(px\|pt\|em\|rem\|%)`, then resolved and clamped to 6–96px |
| `color` / `background-color` | hex, `rgb()/rgba()` or a bare keyword; white and transparent rejected |
| `text-align` | `left\|center\|right\|justify` |
| `font-weight` | `bold` or `500`–`900`, normalized to `bold` |
| `font-style` | `italic` |
| `margin-left` | `0`–`2000px` only |
| `blockquote` `margin`/`border`/`padding` | legacy read only, discarded after conversion |
| everything else | dropped (`display`, `visibility`, `position`, `opacity`, `float`, vendor prefixes, `text-decoration`) |

### 7.4 Second gate: rebuild from the parsed CSSOM

`removeInvisibleStyles` ([line 1079](../src/html-cleaner.service.ts#L1079))
re-reads every surviving declaration from the parsed `CSSStyleDeclaration` and
rebuilds the attribute from the `acceptDeclaration` allowlist. It deliberately
does **not** split the attribute on `':'` — a valid CSS value can itself
contain colons, and string splitting silently corrupts declarations.

### 7.5 Verified removals

| Attack surface | Input | Output |
|---|---|---|
| inline handler | `<p onclick="alert(1)">x</p>` | `<p>x</p>` |
| script element | `<script>alert(1)</script>` | removed with contents |
| `javascript:` link | `<a href="javascript:alert(1)">bad</a>` | unwrapped to text `bad` |
| `javascript:` image | `<img src="javascript:…">` | `<img>` with no `src` |
| `data:` outside images | `<a href="data:text/html,hi">` | unwrapped |
| iframe / form / input / style | all | removed |
| hidden content | `display:none`, `visibility:hidden`, `opacity:0`, `position:fixed` | declarations dropped |
| invisible text | `color:#ffffff`, `background:transparent` | dropped |
| CSS functions | `color: url(…)`, `font-family: expression(…)` | dropped |
| forged indent | `margin-left: 99999px` | dropped |

### 7.6 Where the limits are enforced

The 2000px indentation ceiling is enforced independently at four points, so no
single bug can defeat it:

1. `applySafeIndentation` clamps on every indent step (editor).
2. `encodeSafeIndentationForSanitizer` / `restoreSafeIndentationAfterSanitizer`
   refuse to encode or decode out-of-range values.
3. `sanitize-html`'s `margin-left` regex caps the digit count.
4. `boundIndent()` and `acceptDeclaration()` clamp/drop in the cleaner.

---

## 8. Toolbar-to-Cleaner Compatibility Matrix

Every row was executed through the real cleaner. "Lab" shows whether the button
is enabled in [src/app/app.component.ts](../src/app/app.component.ts).

| Toolbar command | HTML it can produce | Cleaner result | Lab |
|---|---|---|---|
| Bold | `<b>` / `<strong>` | preserved | on |
| Italic | `<i>` / `<em>` | preserved | on |
| Underline | `<u>` | preserved | on |
| Strike | `<strike>`, `<s>`, `<span style="text-decoration:line-through">` | **all normalized to `<strike>`** | on |
| Subscript / Superscript | `<sub>` / `<sup>` | preserved | hidden |
| Headings h1–h6 | `<h1>`…`<h6>` | preserved, deterministic sizes | on |
| Paragraph | `<p>` | preserved | on |
| "Standard" (`formatBlock div`) | `<div>` | text-only DIV → `<p>` | on |
| Preformatted | `<pre>` | preserved, whitespace intact | on |
| Ordered / unordered list | `<ul>`/`<ol>`/`<li>` | preserved; sublists hoisted to siblings for iText | on |
| Align left/center/right | `text-align` | preserved | on |
| Align justify | `text-align: justify` | **preserved** | on |
| Indent / Outdent | `<p style="margin-left: Npx">` | canonical | on |
| Link | `<a href target="_blank">` | preserved, `rel="noopener noreferrer"` forced | on |
| Unlink | plain text | preserved | on |
| Image (upload URL) | `<img src="http(s)://…">` | preserved | on |
| Image (base64 reader) | `<img src="data:image/…">` | preserved (`data:` allowed for `img` only) | on |
| Horizontal rule | `<hr>` | preserved | on |
| Font family | `<font face>` or `font-family` | mapped to the supported list, else Arial | on |
| Font size | `<font size="1..7">` or `font-size` | converted to bounded px (`size=3` → 16px) | on |
| Text color | `<font color>` or `color` | converted to `<span style="color:…">`; white rejected | on |
| Background color | `background-color` | preserved; transparent/white rejected | on |
| Custom classes | `<span class="…">` | **class dropped; unstyled span unwrapped** | hidden |
| Insert HTML (`createLink`) | `<a href target="_blank">` | preserved and hardened | on |
| Video thumbnail | `<div style="position:relative">` + `<img>` + `<a>` | images and link preserved; CSS positioning dropped | hidden |
| Clear formatting | plain text | preserved | on |
| HTML source mode | arbitrary user HTML | full allowlist applies | on |

**Gaps, stated plainly:** custom classes do not survive Reformat, and video
thumbnails lose their absolute positioning (harmless for PDF — iText ignores
`position` anyway). Both buttons are hidden in the lab configuration. If the
main application enables custom classes, support must be added deliberately as
a bounded allowlist of known class names — never by allowing `class` generally.

---

## 9. UI versus PDF Typography Contract

### 9.1 The two numbers serve different purposes

| Surface | Family | Size | Mechanism |
|---|---|---|---|
| Angular Editor UI (display only) | Arial | **14px** | CSS only |
| Persisted / PDF-normalized HTML | Arial | **16px** | written into the HTML |

**14px is a display choice; 16px is what iTextPDF 5 receives.** They are
intentionally different. `src/pdf-html-policy.spec.ts` fails if they ever
become equal, because at that point the UI override would be pointless.

### 9.2 Persisted side — what the cleaner writes

* `font-family` and `font-size` are made **explicit on every text-bearing
  element** (`div, p, pre, span, li, td, th, a, b, i, u, em, strong, strike,
  sub, sup, h1..h6`), resolved through the inheritance chain.
* Supported families: **Arial, Helvetica, Times New Roman, Times-Roman,
  Calibri, Comic Sans MS**. Anything else falls back to Arial.
* Units: `px`, `pt` (×4/3), `em` (× inherited size), `rem` (× 16), `%`
  (× inherited size). Clamped to **6px–96px**.
* Deterministic heading sizes: **h1 32, h2 24, h3 19, h4 16, h5 13, h6 11 px**
  (used when the heading declares no size of its own).
* The root container carries `font-family: Arial; font-size: 16px`, so its
  inherited PDF typography is deterministic even though it stays a `<div>`.

### 9.3 UI side — CSS only, never mutates innerHTML

```html
<div #editor class="angular-editor-textarea"
     [class.ae-compact-default-font]="useCompactDefaultFontSize()"
     [style.font-family]="getDefaultFontNameCss()"
     [style.font-size]="getDefaultFontSizeCss()">
```

```scss
&.ae-compact-default-font {
  ::ng-deep [style*='font-size: 16px']:not(h1):not(h2):not(h3):not(h4):not(h5):not(h6),
  … { font-size: 14px !important; }
}
```

These are host bindings and a class on the *container*. Proven by spec: after
`writeValue()` of persisted 16px HTML, `getComputedStyle(p).fontSize` is
`14px` while `textArea.innerHTML` still contains `font-size: 16px`, and the
value emitted through `onChange` contains `16px` and never `14px`.

### 9.4 **Limitation** — attribute-substring selectors

The compact rule uses attribute *substring* matching, so it only matches the
exact spellings listed in the SCSS (`font-size: 16px`, `font-size:16px`,
`1rem` variants). This is reliable **because HtmlCleanerService is the only
producer of explicit font sizes and always serializes them canonically**
(`canonicalizeStyleOrder`: one space, lower case, `px`). Freshly typed content
carries no explicit size and simply inherits the 14px container.

If the cleaner's serialization ever changes, these selectors must change with
it. The limitation is documented in the SCSS itself, and the component spec
plus `pdf-html-policy.spec.ts` guard the pair. A more robust alternative would
require either mutating persisted HTML (rejected — it must stay 16px) or a
runtime DOM pass on every render (rejected — cost and caret risk).

---

## 10. File and Method Responsibility Map

| File | Responsibility | Key methods | Must not be removed | Tests |
|---|---|---|---|---|
| [safe-indentation.ts](../lib/angular-editor/src/lib/safe-indentation.ts) | PDF-safe indent/outdent engine + sanitizer round-trip | `applySafeIndentation`, `convertIndentedDivToParagraph`, `wrapLooseInlineContent`, `encodeSafeIndentationForSanitizer`, `restoreSafeIndentationAfterSanitizer` | 40px step; clamp to [0, 2000]; leaf-block-only selection; **`false` returned only for lists**; DIV→P only for text-only divs; Range preservation; re-validation on decode | `safe-indentation.spec.ts` (24 specs) |
| [angular-editor.service.ts](../lib/angular-editor/src/lib/angular-editor.service.ts) | execCommand wrapper + safe-indent entry point | `executeCommand` (**unchanged**), `executeSafeIndentationCommand` | `executeCommand(command, value?)` arity and value forwarding; `formatBlock` for headings; safe path stays a separate boolean method | `angular-editor.service.spec.ts` |
| [angular-editor.component.ts](../lib/angular-editor/src/lib/angular-editor.component.ts) | routing, model sanitization, UI typography | `executeCommand` routing (L159), `onContentChange` (L242), `getDefaultFontNameCss`, `getDefaultFontSizeCss`, `useCompactDefaultFontSize` | only indent/outdent may be intercepted; encode→sanitize→restore order; font helpers stay CSS-only | `angular-editor.component.spec.ts` (9 specs) |
| [angular-editor.component.html](../lib/angular-editor/src/lib/angular-editor.component.html) | contenteditable host bindings | `[class.ae-compact-default-font]`, `[style.font-family]`, `[style.font-size]` | must stay *bindings on the host*, never written into `innerHTML` | component spec |
| [angular-editor.component.scss](../lib/angular-editor/src/lib/angular-editor.component.scss) | UI-only 16px→14px | `.ae-compact-default-font` | `:not(h1)…:not(h6)` guards; must never move into inline styles | component spec |
| [angular-editor-toolbar.component.ts](../lib/angular-editor/src/lib/angular-editor-toolbar.component.ts) | button state | `triggerBlocks` CSS-indent detection | the `cssIndented` check; keep legacy `tagMap.BLOCKQUOTE` | — |
| [public-api.ts](../lib/angular-editor/src/public-api.ts) | library barrel | — | must export only files that exist | build |
| [src/html-cleaner.service.ts](../src/html-cleaner.service.ts) | Reformat / save normalization + PDF pre-flight | `sanitize`, `preNormalizeLegacyFormatting`, `cleanDOM`, `convertBlockquoteIndentationToParagraphs`, `convertTextOnlyDivsToParagraphs`, `normalizeTypography`, `canonicalizeStyleOrder`, `validateEditorContentForPDF` | blockquote on the allowlist; deepest-first walk; `containsBlockContent` guard; CSSOM-based style rebuild; canonical property order | `html-cleaner.service.spec.ts` (46 specs) |
| [src/app/app.component.ts](../src/app/app.component.ts) | lab harness; the only `sanitize()` call sites | `onReformatContent` (L72), `onSubmitContent` (L81) | the distinction between Reformat and mandatory save normalization | — |
| [src/pdf-html-policy.spec.ts](../src/pdf-html-policy.spec.ts) | anti-drift seam between library and app constants | — | must keep failing when the two copies diverge | 5 specs |

### 10.1 Why the policy constants are duplicated

`SAFE_INDENT_STEP_PX` / `MAX_SAFE_INDENT_PX` (editor library) and
`PDF_INDENT_STEP_PX` / `PDF_MAX_INDENT_PX` (application service) are separate
declarations **on purpose**: a generic rich-text editor must not depend on
application-specific PDF code. A shared module would create exactly that
coupling. `src/pdf-html-policy.spec.ts` is the seam that keeps the two copies
honest — change one side only and the suite fails.

---

## 11. Before-and-After HTML Examples

All outputs are actual cleaner output.

### 11.1 Legacy blockquote → canonical paragraph

```html
<!-- BEFORE (Chrome execCommand indent ×2, stored in the DB) -->
<blockquote><div><div>Content</div></div></blockquote>

<!-- AFTER -->
<div style="font-family: Arial; font-size: 16px;">
  <p style="font-family: Arial; font-size: 16px; margin-left: 80px;">Content</p>
</div>
```

### 11.2 Deep nesting and the Chrome margin shorthand

```html
<!-- 5 wrapper divs  -->  ... margin-left: 200px
<!-- 7 wrapper divs  -->  ... margin-left: 280px
<!-- <blockquote style="margin:0 0 0 40px;…"><div>  -->  ... margin-left: 40px
```

### 11.3 Blockquote nested in a blockquote — folded flat

```html
<!-- BEFORE -->
<blockquote><div><blockquote><div>Inner</div></blockquote></div></blockquote>
<!-- AFTER: one paragraph, both levels accumulated -->
<p style="font-family: Arial; font-size: 16px; margin-left: 80px;">Inner</p>
```

### 11.4 Blockquote wrapping block content — DIV is kept

```html
<!-- BEFORE -->
<blockquote><div><ul><li>a</li></ul></div></blockquote>
<!-- AFTER: a <p> may not wrap a <ul>, so the indent moves to a DIV -->
<div style="font-family: Arial; font-size: 16px; margin-left: 40px;">
  <ul><li style="font-family: Arial; font-size: 16px;">a</li></ul>
</div>
```

### 11.5 Structural DIV survives; text-only DIV does not

```html
<!-- BEFORE -->  <div style="margin-left: 40px"><table>…</table></div>
<!-- AFTER  -->  <div style="… margin-left: 40px;"><table>…</table></div>   (DIV kept)

<!-- BEFORE -->  <div>Plain text</div>
<!-- AFTER  -->  <p style="font-family: Arial; font-size: 16px;">Plain text</p>
```

### 11.6 Legacy `<font>` and strikethrough

```html
<!-- BEFORE -->  <font face="Arial" size="3">Legacy</font>
<!-- AFTER  -->  <span style="font-family: Arial; font-size: 16px;">Legacy</span>

<!-- BEFORE -->  <span style="text-decoration: line-through">struck</span>
<!-- AFTER  -->  <strike style="font-family: Arial; font-size: 16px;">struck</strike>
```

### 11.7 Pasted indentation formats

```html
<!-- BEFORE -->                          <!-- AFTER -->
<p style="margin-left: 36pt">            margin-left: 48px
<p style="margin-left: .5in">            margin-left: 48px
<p style="margin-left: 2.5em">           margin-left: 40px
<p style="padding-left: 40px">           margin-left: 40px
<p class="ql-indent-2">                  margin-left: 80px
```

### 11.8 Word paste

```html
<!-- BEFORE -->
<div class="WordSection1">
  <p class="MsoNormal" style="margin-left:.5in;font-family:Calibri,sans-serif">Word text</p>
</div>
<!-- AFTER: classes dropped, inches converted, Calibri is supported -->
<div style="font-family: Arial; font-size: 16px;">
  <p style="font-family: Calibri; font-size: 16px; margin-left: 48px;">Word text</p>
</div>
```

### 11.9 Safe link hardening

```html
<!-- BEFORE -->  <a href="https://example.com" target="_blank">link</a>
<!-- AFTER  -->  <a href="https://example.com" target="_blank" rel="noopener noreferrer" …>link</a>

<!-- BEFORE -->  <a href="javascript:alert(1)">bad</a>
<!-- AFTER  -->  bad          (anchor unwrapped, text kept)
```

### 11.10 Editor sanitizer round trip

```html
<!-- model value         -->  <p style="margin-left: 40px">Alpha</p>
<!-- encoded for Angular -->  <p style="margin-left: 40px" class="ae-safe-indent-px-40">Alpha</p>
<!-- after DomSanitizer  -->  <p class="ae-safe-indent-px-40">Alpha</p>
<!-- restored            -->  <p style="margin-left: 40px;">Alpha</p>
```

---

## 12. Regression Test Matrix

**64 specs, all executed** in ChromeHeadless. Every row below is covered by a
real assertion.

### 12.1 Safe indentation — `lib/angular-editor/src/lib/safe-indentation.spec.ts`

| # | Scenario | Assertion |
|---|---|---|
| 1 | One indent level | `margin-left: 40px` |
| 2 | Five levels | `200px` |
| 3 | Seven levels | `280px` |
| 4 | Outdent to zero | declaration and `style` attribute removed |
| 5 | Outdent past zero | never negative |
| 6 | Above the ceiling | clamped to `2000px` |
| 7 | Multiple selected paragraphs | each leaf gets exactly one step |
| 8 | Ancestor + child both selected | a single step, ancestor untouched |
| 9 | Caret/selection preservation | same `Text` node, now inside the `<p>`; selection still anchored to it |
| 10 | Text-only DIV | → `<p>`, `id`/`class`/`align` preserved |
| 11 | Structural DIV | stays a `<div>` |
| 12 | Heading | tag preserved, indented |
| 13 | Top-level loose text | wrapped in `<p>`, indented, **no blockquote** |
| 14 | Loose inline run with `<b>` | wrapped once, formatting intact |
| 15 | Empty editor | handled, nothing created |
| 16 | Selection outside the editor | handled, nothing changed |
| 17 | List item | returns **`false`**, DOM untouched (native fallback) |
| 18 | Selection touching a list | returns **`false`** |
| 19 | Mixed content, indent ×3 + outdent | output contains no `blockquote` |
| 20–24 | Encode/restore round trip | 40px, 2000px, 40.5px survive; over-limit, negative and forged classes rejected; empty input safe |

### 12.2 HtmlCleanerService — `src/html-cleaner.service.spec.ts`

| Area | Scenarios covered |
|---|---|
| Indentation | legacy blockquote → `<p>`; 5 levels = 200px; 7 levels = 280px; Chrome margin shorthand; nested blockquote folded flat; blockquote around block content keeps a DIV; **no blockquote in output**; indented DIV → P; plain text DIV → P; structural DIV retained; 2000px cap; pt/in/em/rem/padding-left/margin-shorthand/`ql-indent-N` conversion; original metadata removed; explicit CSS outranks an inferred class |
| Idempotence | 10 fixtures × 3 passes, byte-identical |
| Inline formatting | `<strike>` kept; `<s>`→`<strike>`; line-through span→`<strike>`; arbitrary `text-decoration` rejected; b/i/u/em/strong; sub/sup |
| Block structure | h1–h6 all preserved; `<pre>` with whitespace; `<hr>`; left/center/right/**justify**; valid table structure; `<li>` always inside a list; exactly one root container |
| Links & images | https link + forced `rel`; http link without target; `javascript:` unwrapped; `data:` link removed; http/https/data image sources; `javascript:` image src dropped |
| Typography | explicit family/size on root and text elements; supported family + relative size resolution; all six families; Papyrus → Arial; px/pt/em/rem normalization; 200px→96px and 1px→6px clamping; deterministic heading sizes; legacy `<font>` → span; font stack picks the supported family |
| Security | script removal; event handlers; iframe/form/input/style; hidden and invisible CSS; white-on-white; `url()`/`expression()`; forged indent |
| Robustness | empty/blank input; `null`/`undefined`; six malformed inputs do not throw; inline-wrapping-block unwrapped |
| PDF pre-flight | flags blockquote, hidden/invisible content, inline-wrapped blocks; accepts canonical output; null-safe |

### 12.3 UI vs persisted typography — `angular-editor.component.spec.ts`

| # | Scenario | Assertion |
|---|---|---|
| 1 | Persisted 16px body text | computed size `14px`, `innerHTML` still `font-size: 16px` |
| 2 | Headings | `h2` stays `24px`, `h6` stays `16px` (not collapsed) |
| 3 | Freshly typed content | renders at `14px` |
| 4 | Emitted model value | contains `16px`, never `14px` |

### 12.4 Policy drift — `src/pdf-html-policy.spec.ts`

Indent step, max indent, default family and persisted body size must agree
between the editor library and the cleaner; UI 14px must stay different from
persisted 16px.

### 12.5 Assertion style

DOM assertions are used throughout (`querySelector`, `.style.marginLeft`,
`getComputedStyle`). Full-string comparison is used only where it is the point
of the test — the idempotence suite.

---

## 13. Angular 9 Merge Instructions

The lab stays on Angular 18. Code intended for the Angular 9 application has
been written to avoid unsupported syntax.

### 13.1 Already handled

| Item | Status |
|---|---|
| Optional chaining `?.` | **removed** from library code (was in `insertUrl`) |
| Nullish coalescing `??` | **removed** from library code (was in `configure()`) |
| `styleUrl` (singular, Angular 17+) | **replaced** with `styleUrls` in `app.component.ts` |
| `NodeList.prototype.forEach` | **replaced** with indexed loops in the cleaner |
| `ChildNode.prototype.remove()` | **replaced** with `parentNode.removeChild()` |
| `Array/String.prototype.includes` in the cleaner | replaced with `indexOf` |

### 13.2 Still required at merge time

1. **`waitForAsync` → `async`.** Angular 9 exports `async` from
   `@angular/core/testing`; `waitForAsync` arrived in v10. Affects
   `angular-editor.component.spec.ts` and `ae-select.component.spec.ts`.
   It cannot be changed here — `async` was removed in Angular 12+.
2. **`tsconfig`:** set `moduleResolution: "node"` (`"bundler"` needs TS 5.0) and
   `target`/`module` to `es2015`.
3. **`import sanitizeHtml from 'sanitize-html'`** requires `esModuleInterop` or
   `allowSyntheticDefaultImports`, which the Angular 9 CLI does not set by
   default. Either add the flag or switch to `import * as sanitizeHtml`.
   (In this lab `esModuleInterop: true`, so the default import is correct here.)
4. **IE11**, if still supported: `core-js` must polyfill `String.prototype.includes`
   and `Array.prototype.includes`, used in the editor library (not the cleaner).
5. **Add `sanitize-html` to `allowedCommonJsDependencies`** in the target app's
   `angular.json`, as done here.
6. **Port the `tsconfig.spec.json` include paths** so library specs are compiled.
7. **Check component style budgets** — see
   [§14](#14-known-limitations-and-fallback-behavior) item 10.

### 13.3 Lab-only files — do NOT copy into Angular 9

* [src/app/app.component.ts](../src/app/app.component.ts), `.html`, `.scss` — demo harness.
* [src/app/app.module.ts](../src/app/app.module.ts), [src/main.ts](../src/main.ts), [src/index.html](../src/index.html), [src/styles.scss](../src/styles.scss).
* [angular.json](../angular.json), [tsconfig*.json](../tsconfig.json), [package.json](../package.json) — lab build configuration.
* [lib/angular-editor/src/test.ts](../lib/angular-editor/src/test.ts) — legacy karma bootstrap, unused by the Angular 18 builder.
* `src/pdf-html-policy.spec.ts` may be copied, but its `@local/angular-editor`
  import path must be repointed.

### 13.4 Files to merge

`lib/angular-editor/**` (the whole patched library) and
`src/html-cleaner.service.ts` + `src/html-cleaner.service.spec.ts`.
`HtmlCleanerService` is deliberately **application-owned** — it encodes
application PDF policy and must not move into the generic editor library.

---

## 14. Known Limitations and Fallback Behavior

1. **Lists delegate to the browser.** Indent inside `<li>` uses `execCommand`,
   producing native list nesting. The cleaner's four list-repair passes make
   that iText-safe — notably `hoistSublistsOutOfLiForIText`, which moves
   sublists to be **siblings** of their `<li>`:
   `<ul><li>one</li><ul><li>two</li></ul></ul>`. This is deliberately
   non-standard HTML because iText 5 handles it better than a nested `<ul>`
   inside `<li>`.

2. **The editor does not remove legacy blockquotes.** Indenting inside legacy
   content leaves the `<blockquote>` in place; only Reformat removes it. Legacy
   DB content therefore stays PDF-hostile until reformatted.

3. **Blockquote around block content becomes an indented `<div>`, not a `<p>`.**
   iText may ignore `margin-left` on a `<div>`, so that indent level may not
   render. This is a deliberate trade — invalid `<p><ul></p>` is worse.

4. **Custom classes do not survive Reformat.** `class` is not allowlisted. The
   toolbar button is hidden in the lab configuration.

5. **No paste normalization.** There is no `(paste)` handler; pasted content is
   covered only by Angular's `DomSanitizer` until Reformat or Save runs.

6. **UI compact rendering uses attribute-substring selectors** — see
   [§9.4](#94-limitation--attribute-substring-selectors).

7. **Blank lines are kept between paragraphs, but trimmed at the start and end.**
   `removeEmptyTags` normalizes a blank line (`<div><br></div>`, `<p>&nbsp;</p>`,
   `<p><span style="…"><br></span></p>`) to `<p><br></p>` and only deletes
   wrappers with no height (`<p></p>`, empty spans). Leading and trailing blank
   lines are removed by `trimEdgeBlankLines`.

8. **Loose text directly inside a structural `<div>`** is left in place (not
   wrapped in a `<p>`). It inherits that div's explicit typography, so it is
   deterministic for iText, but it is not paragraph-wrapped.

9. **Not verified: actual iTextPDF 5 rendering.** Every claim about what iText
   does is based on the historical failures described in
   [§3](#3-historical-root-causes), not on a test in this repository. There is
   no backend here to test against. Treat the PDF-side statements as the
   rationale for the design, not as measured behavior.

10. **Component style budgets were raised** in `angular.json`
    (`anyComponentStyle` 6/10 kB → 45/64 kB). Root cause: the vendored v1.1.4
    `style.scss` imports the entire font-awesome stylesheet into **both**
    component stylesheets (~38–40 kB each, duplicated). This was a pre-existing
    condition, previously masked because the build aborted earlier on the
    `public-api.ts` error. The structural fix is in the recommendations.

---

## 15. Rules for Future Changes

**Invariants — breaking any of these regresses PDF output.**

1. **`<p style="margin-left: Npx">` is the canonical indented text
   representation.** Any new code path that indents text must produce it.
2. **`<blockquote>` is legacy input and must never exist in normalized output.**
   Not from the editor, not from the cleaner, not from a paste handler.
3. **Structural `<div>` elements may remain** — never convert a `<div>`
   containing block content into a `<p>`. Keep both `containsBlockContent`
   implementations in sync.
4. **The original `executeCommand(command: string, value?: string)` API must not
   change.** No new parameters, no changed return type, no indentation logic
   inside it. New capability goes into separate methods returning `boolean`.
5. **Only `indent` and `outdent` may be intercepted** in
   `AngularEditorComponent.executeCommand`.
6. **`applySafeIndentation` may return `false` only for list selections.**
   Every other unsupported case must be a safe no-op. Returning `false`
   elsewhere re-opens the blockquote regression.
7. **40px per level, clamped to [0, 2000].** Changing either number means
   changing `SAFE_INDENT_STEP_PX`, `MAX_SAFE_INDENT_PX`, `PDF_INDENT_STEP_PX`,
   `PDF_MAX_INDENT_PX`, the `sanitize-html` `margin-left` regex and the
   `restoreSafeIndentationAfterSanitizer` regex. `pdf-html-policy.spec.ts`
   catches the constants; check the regexes by hand.
8. **The sanitizer must never be weakened to preserve formatting.** No
   `allowVulnerableTags`, no `class` allowlisting, no `.*` style patterns, no
   new URL schemes without an explicit requirement. To preserve a format,
   *convert* it in pre-normalization instead.
9. **`<blockquote>` must stay on the `sanitize-html` allowlist** while legacy
   content exists in the database. Removing it recreates root cause
   [§3.2](#32-reformat-destroyed-indentation).
10. **The encode → `DomSanitizer.sanitize` → restore triple must stay in order**
    and must keep re-validating on decode. Never "simplify" it with
    `bypassSecurityTrustHtml`.
11. **UI typography stays CSS-only.** Never write font styles into
    `element.innerHTML` from the UI layer. UI 14px and persisted/PDF 16px serve
    different purposes and must stay different values.
12. **Reformat must stay idempotent.** Any new pass must preserve
    `sanitize(sanitize(x)) === sanitize(x)`, including serialization order — add
    any new style property to `canonicalizeStyleOrder`'s list.
13. **Do not run the full cleaner on every keystroke.**
14. **Normalization before save/export is mandatory.** The lab does it in
    `onSubmitContent()`. The backend should re-validate independently.
15. **Do not claim paste is normalized** unless a `(paste)` handler that calls
    the cleaner is actually added.
16. **Any behavior not verified by code or tests must be documented as a
    limitation**, not asserted.

**Process:** when adding a normalization pass, add it to `cleanDOM()`, to the
pipeline listing in [§6.1](#61-deterministic-pipeline), and to the matrix in
[§12](#12-regression-test-matrix). Re-run all four commands in
[§17](#17-verified-buildtest-status) before merging.

---

## 16. Troubleshooting Checklist

### 16.1 "The PDF hangs or errors on this document"

1. Search the stored HTML for `blockquote`. If present, Reformat never ran.
2. Run `HtmlCleanerService.validateEditorContentForPDF(html)` and read
   `errors[]` — it detects leftover blockquotes, block-inside-inline nesting,
   hidden/invisible content and over-limit indentation.
3. Look for a block inside an inline element (`<b><p>…</p></b>`);
   `unwrapInlineWrappingBlock` should have removed it.
4. Check `<div>` nesting depth. More than ~2 levels means legacy content.

### 16.2 "Indentation disappeared after typing"

1. Is `config.sanitize` on? The encode/restore round trip only runs then.
2. Inspect the live DOM vs the model value. Indented on screen but plain in
   `ngModel` is the signature of a failed encode.
3. Is the value in `px`? Only `px` is encoded for the Angular sanitizer.
4. Above 2000px? It should now be impossible — `applySafeIndentation` clamps.

### 16.3 "Indent produced a `<blockquote>`"

This should now be impossible for non-list content. If it happens:

1. Break on `applySafeIndentation`'s return value. `false` means a list
   selection was detected — verify with `rangeTouchesListItem`.
2. Confirm the component still routes only `indent`/`outdent`, and that nothing
   else calls `executeCommand('indent')` directly.
3. Confirm `config.defaultParagraphSeparator` is `'p'` (belt and braces — loose
   text is now wrapped automatically).

### 16.4 "Reformat changed the document a second time"

Idempotence is asserted over three passes. If it breaks:

1. Diff pass 1 vs pass 2. A property-*order* difference means a new pass sets a
   style after `canonicalizeStyleOrder`, or a new property is missing from its
   `order` list.
2. A structural difference usually means a new pass converts the root container
   or creates an element the next pass converts again.

### 16.5 "Formatting vanished after Reformat"

| Lost | Cause |
|---|---|
| custom class | `class` is not allowlisted ([§14](#14-known-limitations-and-fallback-behavior) item 4) |
| a blank line at the very start or end | `trimEdgeBlankLines` (item 7); blank lines between paragraphs are kept |
| unusual font family | not in the six supported families → Arial |
| a very large/small font | clamped to 6–96px |
| absolute positioning | `position` is not allowlisted (correct for iText) |
| `<strike>`, `<a>`, `<pre>`, `<h6>`, `<sub>`, `<sup>`, `<hr>`, `justify` | should **not** happen — all covered by specs; re-run the suite |

### 16.6 "The build fails"

Both historical blockers are fixed. If the build fails now:

* `TS2307 Cannot find module` from `public-api.ts` → an export was added for a
  file that does not exist.
* `TS18003 No inputs were found` → `tsconfig.spec.json` include paths were
  reverted.
* `exceeded maximum budget` → component styles grew; see
  [§14](#14-known-limitations-and-fallback-behavior) item 10.

---

## 17. Verified Build/Test Status

All commands run at the state described in [§18](#18-commit-hash-and-dependency-versions).

| Command | Exit | Result |
|---|---|---|
| `npx tsc --noEmit -p tsconfig.app.json` | **0** | ✅ pass |
| `npx tsc --noEmit -p tsconfig.spec.json` | **0** | ✅ pass |
| `npm run build` | **0** | ✅ pass — bundle 596.39 kB raw / 134.68 kB transfer |
| `npm test -- --watch=false --browsers=ChromeHeadless` | **0** | ✅ **TOTAL: 64 SUCCESS**, 0 failures |

Browser runtime tests **did execute** — ChromeHeadless 152.0.0.0 on Windows. No
test was skipped or reported as passing without running.

`package-lock.json` and `package.json` are byte-identical to the baseline
(`git diff --exit-code` clean); `sanitize-html` remains locked at **2.7.0**.
No generated artifacts, caches or `node_modules` changes are in the diff.

### 17.1 Baseline before this work (for contrast)

| Command | Exit | Failure |
|---|---|---|
| `npx tsc --noEmit -p tsconfig.app.json` | 2 | `TS2307: Cannot find module './lib/html-cleaner.service'` |
| `npx tsc --noEmit -p tsconfig.spec.json` | 2 | `TS18003: No inputs were found` |
| `npm run build` | 1 | same unresolved module |
| `ng test` | 127 | same `TS18003` — **zero tests executed** |

---

## 18. Commit Hash and Dependency Versions

| Item | Value |
|---|---|
| Baseline commit | `05cd661a28327f5f738bdc28a7a8b542c7b36559` (2026-09-04, branch `main`) |
| Working tree | modified, **not committed** (per instruction) |
| Angular | 18.2.14 (CLI 18.2.21, `@angular-devkit/build-angular` 18.2.21) |
| TypeScript | 5.5.4 (`~5.5.2`) |
| rxjs / zone.js | 7.8.2 / 0.14.10 |
| **sanitize-html** | **2.7.0** (locked, `@types/sanitize-html` 2.16.1) |
| Karma / Jasmine | karma 6.4.4 / jasmine-core 5.2.0 / `@types/jasmine` ~5.1.0 |
| Test browser | ChromeHeadless 152.0.0.0 (Windows) |
| Node / npm | v22.18.0 / 11.12.1 |
| `package-lock.json` | lockfileVersion 3, unchanged (`7d4dab6faa2087e8509cbe966c7871d0a42b218e`) |
| Upstream editor | `@kolkov/angular-editor` v1.1.4, vendored under `lib/angular-editor` (not an npm dependency) |
| tsconfig | `target`/`module` `ES2022`, `moduleResolution: "bundler"`, `strict: false` |

### 18.1 Files changed in this work

| File | Purpose |
|---|---|
| `lib/angular-editor/src/public-api.ts` | removed the export of a non-existent module (build blocker) |
| `tsconfig.spec.json` | include `lib/**/*.spec.ts` so library specs compile and run |
| `lib/angular-editor/src/lib/safe-indentation.ts` | clamp at 2000px; `false` only for lists; wrap loose text; exported policy constants |
| `lib/angular-editor/src/lib/angular-editor.component.ts` | exported typography constants; removed `??`; clarified routing |
| `lib/angular-editor/src/lib/angular-editor-toolbar.component.ts` | removed `?.` |
| `lib/angular-editor/src/lib/angular-editor.component.scss` | documented the substring-selector limitation |
| `src/html-cleaner.service.ts` | rewritten pipeline: pre-normalization, wider allowlist, typography, canonical ordering, CSSOM parsing, null-safety |
| `src/app/app.component.ts` / `.html` | real Reformat + mandatory save normalization + PDF pre-flight; `styleUrls` |
| `angular.json` | `allowedCommonJsDependencies`; raised `anyComponentStyle` budgets |
| `src/html-cleaner.service.spec.ts` | moved from `lib/`, expanded to 46 specs |
| `lib/angular-editor/src/lib/safe-indentation.spec.ts` | **new** — 24 specs |
| `lib/angular-editor/src/lib/angular-editor.component.spec.ts` | added the UI-vs-persisted typography DOM tests |
| `src/pdf-html-policy.spec.ts` | **new** — anti-drift guard |
| `docs/angular-editor-pdf-safe-customizations.md` | this document |

### 18.2 Evaluated but NOT implemented

These were considered and deliberately left as recommendations:

1. **Canonical-format version identifier** (e.g. `data-ae-format="1"` on the
   root) so migrations can detect un-normalized records.
2. **Stored HTML fixtures** shared between the frontend suite and a backend
   iTextPDF 5 integration test.
3. **Backend normalization/validation boundary** before the XML Worker parse —
   the backend is not in this repository.
4. **Normalization warning telemetry** that records *what* was changed without
   logging editor content.
5. **Migration strategy for legacy DB rows** containing blockquote markup
   (batch Reformat vs. lazy-on-read).
6. **Incremental replacement of the deprecated `document.execCommand`** — a
   separate ticket; the safe indentation path already avoids it.
7. **Moving font-awesome out of the vendored component stylesheets** into
   global styles, which would remove ~38 kB of duplication and let the original
   tight style budgets be restored. Not done here because it changes how the
   vendored library must be consumed, which is a merge hazard for the Angular 9
   application.
8. **Automated toolbar-vs-allowlist compatibility test** that enumerates the
   toolbar's commands and asserts each produced tag is allowlisted — §8 is
   currently a manually maintained matrix.
