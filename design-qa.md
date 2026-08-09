# Design QA

- Source visual truth: a locally supplied reference screenshot (not committed)
- Implementation capture: a local 390 × 686 browser capture (not committed)
- Combined comparison: a local side-by-side image (not committed)
- Viewport: 390 × 686 CSS px
- Source pixels: 588 × 1280; app-owned region cropped to 588 × 1030 and normalized to 390 × 686
- Implementation pixels: 390 × 686 at device scale factor 1
- State: connected mobile terminal with the shortcut bar and command composer visible. Terminal content differs intentionally because the implementation uses an isolated test session.

## Full-view comparison evidence

The normalized side-by-side comparison confirms that the top bar, terminal, shortcut bar, and composer retain the same hierarchy and density at the mobile viewport. The implementation keeps the top bar and composer within the 390 px viewport. The shortcut bar is intentionally horizontally scrollable; each shortcut retains its full intrinsic width.

## Focused region comparison evidence

The persistent bottom controls were checked separately because they are the requested interaction surface. `Claude · 自動`, `Codex · 自動`, and `Enter` have matching `clientWidth` and `scrollWidth`, so their labels are not clipped. `Enter` ends at 352.95 px and is fully visible in the initial 390 px viewport. The top bar and composer each report equal client and scroll widths of 390 px.

## Required fidelity surfaces

- Fonts and typography: terminal and controls preserve the existing monospace typography, sizes, line heights, and truncation behavior.
- Spacing and layout rhythm: the fixed top bar, terminal body, shortcut bar, and composer remain aligned with no page-level horizontal overflow.
- Colors and visual tokens: the existing dark green palette, borders, active state, and connection indicator are unchanged.
- Image quality and asset fidelity: this screen contains no app-owned raster imagery; the supplied screenshot's device and browser chrome are outside the implementation surface.
- Copy and content: `Enter` is explicit, while the existing `zh-TW` copy remains readable and localized.

## Interaction verification

- Clicking the `Enter` shortcut submitted a waiting terminal prompt.
- Clicking `執行` with an empty composer submitted Enter.
- Vertical wheel input moved tmux scrollback from `[0/92]` to `[5/92]`; the touch handler dispatches the same wheel path after classifying a vertical one-finger gesture.
- Horizontal panning remains available for fixed 80-column mode through `touch-action: pan-x`.
- Switching from `zh-TW` to `en-US` and back completed successfully.
- No uncaught page or automation errors surfaced during these interactions. The in-app browser does not expose a historical console-message stream.

## Findings

No actionable P0, P1, or P2 issues remain for the requested Enter and scroll interactions.

## Comparison history

- Initial issue: the mobile UI had no explicit Enter shortcut and an empty `執行` action did nothing.
- Fix: added a visible `Enter` shortcut and made empty `執行` send `\r`.
- Initial issue: vertical swipes were reserved by the browser and could not reach tmux scrollback.
- Fix: classified one-finger terminal gestures and translated vertical movement into xterm wheel events while preserving horizontal panning.
- Post-fix evidence: the 390 px browser capture shows the new shortcut without clipped labels, and the isolated terminal session confirmed both Enter paths and scrollback movement.

## Follow-up polish

None required for this change.

final result: passed
