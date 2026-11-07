# YouTube Comments Closed

YouTube comments start closed, giving the video its space back. Click YouTube's
comments button whenever you want to open them. For comments below a video, use
**Show comments**; **Hide comments** closes them again. Each new video starts
closed. Description, Ask, and Transcript panels remain available.

## Install

1. Open `chrome://extensions` in Chrome and enable **Developer mode**.
2. Click **Load unpacked** and select the repository's `extension` folder
   (or the `YouTube Comments Closed` folder from the installable ZIP).
3. Reload any YouTube tabs that were already open.

No other comment blocker is required. The toolbar icon explains the behavior.
The extension operates only on desktop `youtube.com` and `www.youtube.com`,
including desktop Shorts. It makes no network requests and uses no storage,
analytics, background worker, or additional Chrome API permissions.

## Development

The installable extension is entirely contained in `extension/`. Source files
are unbundled and require no build step. Run `npm ci`,
`npx playwright install chromium`, and `npm test` for the browser regression suite.
Tests load the real extension in an isolated Chromium profile against local
YouTube-shaped fixtures; they do not use your Chrome profile or account.

Run `npm run package` for the installable folder, desktop ZIP, and versioned
Web Store ZIP in `dist/`. Run `npm run icons` to regenerate all PNG sizes from
`store-assets/icon.svg`. Both the extension manifest and toolbar action reference
the packaged icons; the separate Store listing icon does not update installed
extension icons by itself.

YouTube can change its markup. The extension clicks the comments panel's scoped
native close control so YouTube restores the video width. It waits for lazy
controls and retries briefly. Native comment entry points stay visible, and
trusted clicks or keyboard activation keep comments open for the current video.

See [RELEASING.md](RELEASING.md) for tag-based publishing and its one-time
Chrome Web Store credential setup. Source code is hosted at
https://github.com/gnaservicesinc/YouTube-Comments-Closed.
