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
