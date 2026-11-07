# Chrome Web Store — YouTube Comments Closed 1.1.4

Prepared for existing item `ecmhkbgdoeeicpohpleinhgmdfliedak`
(repository: https://github.com/gnaservicesinc/YouTube-Comments-Closed).
See RELEASING.md for release operations.

## Package and artwork

Upload `dist/youtube-comments-closed-1.1.4-webstore.zip` to the existing item.
The ZIP has `manifest.json` at its root and includes native-size icons for both
the manifest and toolbar action, plus a small explanatory popup. Use
`store-assets/store-icon-128.png` for the Store listing icon. The original
artwork sources are preserved; the new icon has an editable SVG source.

## Short description

YouTube comments start closed. Click to open them whenever you want, with more room for the video by default.

## Detailed description

```text
YouTube Comments Closed keeps comments out of the way until you choose to read them.

Comments start closed when you open a video or move to the next one. The extension uses YouTube's own close control so the video regains its space.

Want to read or write comments? Click YouTube's comments button. For comments below a video, click Show comments; click Hide comments to close them again. Your choice lasts for the current video. The next video starts closed again.

Description, Ask, and Transcript panels remain usable. Desktop Shorts are supported. No other comment blocker is required.

Install the extension and reload any YouTube tabs that were already open. Click the toolbar icon for a quick explanation.

The extension works locally on desktop youtube.com and www.youtube.com. It collects no data, stores no comment text or browsing history, and sends nothing off your device. There are no accounts, analytics, tracking, or advertising. YouTube layout changes may require an update.

This is an independent extension and is not affiliated with YouTube or Google.
```

## Privacy practices

Single purpose:

```text
Keep YouTube comments closed by default while allowing users to open them deliberately, and restore video space using YouTube's native close control.
```

Host access justification:

```text
Access to youtube.com and www.youtube.com is required to close comments by default and reveal them when the user clicks a comments control. Interface checks happen locally. The extension does not collect, store, or transmit page information or browsing history.
```

No additional Chrome API permissions are requested. Select **No remote code**,
leave all data-type checkboxes unchecked, and retain the three data-use
certifications. No privacy policy is published; keep the policy URL blank.
Do not change publisher contact information, distribution, or audience settings
as part of this update.

## Reviewer test instructions

```text
No account or credentials are required.
1. Reload a desktop YouTube watch page after installation. Inline comments should start hidden behind Show comments. Automatically expanded comments side panels should close and release their reserved space.
2. Click Show comments. Inline comments should appear; Hide comments should close them again.
3. Click YouTube's native comments button, including on desktop Shorts. Comments should open, remain visible and interactive, and allow normal reading or writing.
4. Switch tabs and return. Explicitly opened comments should stay open for the same video.
5. Navigate to another video without reloading the whole site. Its comments should start closed again.
6. Description, Ask, and Transcript panels should remain available.
7. The Chrome toolbar should show a navy video icon with a cyan X. Click it for a brief explanation.
```

## Changes

- 1.1.4: eliminate initial page-load Side Rail layout jitter (`#columns::after`
  and `.dismissible-panels-transitioning`) when panels start closed; add the
  panel mode setting to both the extension Settings page (`options.html`) and
  YouTube's `/account` settings page in addition to the toolbar popup; display
  the live manifest version dynamically.
- 1.1.3: close all three YouTube Side Rail default panels (Comments,
  Description, and Ask) on video load so the sidebar never shrinks the video by
  default; support `yt-video-title-header-view-model` close buttons in Side Rail
  Description panels and `PAyouchat` Ask panels; recover cleanly when clicking a
  Side Rail toggle button before its close handler hydrates; add a toolbar popup
  setting to choose between always starting with all three panels closed
  (default) or remembering your opened panel across videos.
- 1.1.1: support modern YouTube ViewModel comment controls (Watch Side Rail
  `yt-side-rail-view-model`, Shorts `reel-action-bar-view-model`, player quick
  actions, and comment teaser) so clicking the comment button always opens
  comments and toggles cleanly; sync inline Show/Hide comments with Side Rail
  panels; update repository URL to
  `https://github.com/gnaservicesinc/YouTube-Comments-Closed`.
- 1.1.0: comments closed by default with deliberate opening; inline Show/Hide
  control; reliable document-start observer; sharper icons at 16/24/32/48/128px;
  explicit toolbar icon and popup; tag-based GitHub release workflow.
- 1.0.1: icon package prepared locally, never uploaded.
- 1.0.0: published version with forced comment closure and no bundled icon.
