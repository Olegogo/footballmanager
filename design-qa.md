**Source visual truth**

- Reference screenshot: `/var/folders/k8/lnn01fy54g10_kxzrblpjmpw0000gn/T/TemporaryItems/NSIRD_screencaptureui_bgqHhX/Screenshot 2026-09-01 at 22.00.56.png`.
- Source pixels: 1602 × 182. The screenshot contains two adjacent mobile toolbar examples at approximately @2x density; normalized comparison size is about 801 × 91 CSS px.
- Intended state: black, centered benchmark pill shown over the profile toolbar while a numeric self-profile stat changes.

**Implementation evidence**

- Local route: `http://127.0.0.1:3102/?chatId=-1001`.
- Browser-rendered implementation screenshot: `/private/tmp/profile-benchmark-toast-final.png`.
- Implementation pixels and CSS viewport: 390 × 844 at device scale factor 1.
- State: self-profile editor, central midfielder selected, pace incremented; the local dataset intentionally exercises the translated `Пока мало данных` fallback.
- Primary interactions tested: open self-assessment, select a position, increment the pace stat repeatedly, confirm the value updates, and confirm the toast refreshes after each press.
- Behavioral branches tested in the Node test suite: `Ниже среднего`, `Топ 35%`, similar-position grouping, viewer exclusion, unrated fallback exclusion, and insufficient peer data.
- Browser console errors and warnings: none.

**Full-view comparison evidence**

- The implementation preserves the existing card editor, toolbar controls, fixed save/cancel actions, and 390 px mobile layout without horizontal overflow.
- The source only specifies the toolbar/toast region, so the rest of the profile editor was checked for regressions rather than source fidelity.

**Focused region comparison evidence**

- The source and implementation were opened together in one comparison input.
- Final toast geometry: x=108.56, y=24, width=172.88, height=38 CSS px for `Пока мало данных`.
- Final visual tokens: `#000` background, white text, 15 px/800 type, fully rounded pill, no visible border. Position and height align with the normalized reference toolbar examples.

**Findings**

- No actionable P0/P1/P2 differences remain.
- Fonts and typography: the existing app font stack is preserved; the toast uses the compact bold optical weight and single-line truncation behavior shown in the reference.
- Spacing and layout rhythm: the pill is centered at y=24 with a 38 px height, matching the normalized source proportions and leaving both toolbar buttons unobstructed.
- Colors and visual tokens: the benchmark variant uses pure black and white as in the source while other app toasts retain their existing semantic styling.
- Image quality and asset fidelity: the change introduces no image or icon assets; existing toolbar icons and card imagery remain unchanged.
- Copy and content: Russian and English labels cover top percentile, below average, average, above average, and insufficient-data states.
- Accessibility: the existing toast now exposes `role=status` and `aria-live=polite`; repeated benchmark updates remain non-blocking.

**Comparison history**

- Pass 1 found a P2 density mismatch: the benchmark toast was 45.2 px high at y=20, visibly larger and higher than the normalized reference.
- Fix: reduced benchmark-only padding and type size, and moved the pill to y=24 without changing general-purpose toast styling.
- Pass 2 evidence: `/private/tmp/profile-benchmark-toast-final.png`; final height is 38 px at y=24, with no overlap or clipping.

**Implementation Checklist**

- [x] Compare against other meaningful player cards from a similar positional group.
- [x] Exclude the viewer and fallback-only 50-point cards from the sample.
- [x] Update the benchmark after every profile-stat stepper press.
- [x] Match the black pill reference without restyling unrelated toasts.
- [x] Localize all visible benchmark states in Russian and English.
- [x] Verify logic, interaction, responsive layout, accessibility, and console output.

**Follow-up Polish**

- None required for this scoped reference.

final result: passed

---

## Unrated profile callout — 2026-09-03

**Evidence**

- Source visual truth: `/Users/alfa/Downloads/Group 2136142384.png`.
- Source pixels: 371 × 847; the callout occupies approximately 339 × 73 px.
- Browser-rendered implementation: `/private/tmp/profile-callout-implementation.png`.
- Implementation capture: 371 px CSS viewport at device scale factor 1; full-page output is 371 × 883 px.
- State: own profile, no career rating, previously completed self-profile, Russian locale.
- Primary interaction tested: `Редактировать` opens `#selfProfileForm`.
- Browser console errors and warnings: none.

**Full-view and focused comparison evidence**

- The source and implementation captures were opened together in one comparison input.
- The focused callout preserves the reference hierarchy: warm yellow 72 px surface, two-line 14 px message, and a white 128 × 40 px capsule action.
- Focused-region evidence: `/private/tmp/profile-callout-crop.png`.

**Findings**

- No actionable P0/P1/P2 differences remain for the scoped callout.
- Fonts and typography: existing app font stack retained; message and action use 14 px bold weights and the reference two-line wrapping.
- Spacing and layout rhythm: 72 px height, 22 px radius, asymmetric 24/17 px horizontal padding, 12 px gap, and responsive compression below 360 px.
- Colors and visual tokens: inferred source palette mapped to `#f0cb69`, `#4b3b18`, white, and `#17120a`.
- Image quality and asset fidelity: no new raster or icon asset is required for this UI-only component; existing player imagery remains untouched.
- Copy and content: `Рейтинг появится после первой игры`; context-sensitive action is shortened to `Заполнить` or `Редактировать`.

**Comparison history**

- Pass 1 found a P2 visual mismatch: the existing callout was a translucent dark 48 px panel with a gold-gradient compact button.
- Fix: matched the reference yellow fill, 72 px height, 22 px radius, text treatment, and white capsule button.
- Pass 2 found no remaining actionable P0/P1/P2 differences in the scoped component.

**Implementation Checklist**

- [x] Match callout geometry and colors.
- [x] Match button geometry and short labels.
- [x] Preserve both filled and unfilled profile states.
- [x] Verify narrow-screen fallback.
- [x] Verify the primary action and browser console.

**Follow-up Polish**

- Recheck optical color matching on a physical phone display after production deploy.

final result: passed
