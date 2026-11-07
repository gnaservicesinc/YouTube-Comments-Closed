# Releasing YouTube Comments Closed

The GitHub workflow tests every pull request and main-branch push. A `v*` tag
also builds a versioned Web Store ZIP and, after the one-time credential setup
below, submits it to the existing Store item for review and automatic publication
on approval. Google controls review timing; a successful upload is not a live release.

## One-time setup

Use the publisher account that owns item `ecmhkbgdoeeicpohpleinhgmdfliedak`.
Follow Google's [Chrome Web Store API setup](https://developer.chrome.com/docs/webstore/using-api)
to enable the API, create an OAuth client, and obtain a refresh token for scope
`https://www.googleapis.com/auth/chromewebstore`. Keep the OAuth consent app in
production for ongoing releases; Google's external testing-mode refresh tokens
normally expire after seven days. Never paste credentials into an issue or commit.

In this repository's (`https://github.com/gnaservicesinc/YouTube-Comments-Closed`)
**Settings → Secrets and variables → Actions**, add:

| Type | Name | Value |
| --- | --- | --- |
| Secret | `CWS_SERVICE_ACCOUNT_JSON` | Google Cloud service-account JSON key (same as `PVT-RD`) |
| Variable | `CWS_PUBLISHER_ID` | Publisher ID (`6738fee0-cfcd-45fe-ae53-e1a0af32b9de`, also set as workflow fallback) |

*(Alternatively, OAuth refresh-token secrets `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, and `CWS_REFRESH_TOKEN` are also supported.)*

The publisher ID is different from the extension ID. The workflow fixes the
extension ID to the existing item. No publishing credentials were present when
this workflow was added. Until setup is complete, tags still produce tested ZIP
artifacts and skip the automatic submission job. Version 1.1.0 is being submitted
through the dashboard separately.

## Release a version

1. Update the version in `extension/manifest.json`, `package.json`,
   `package-lock.json`, and the toolbar popup footer.
2. Run `npm ci`, `npx playwright install chromium`, `npm test`, and `npm run package`.
3. Commit and push the changes to `main`, then tag that commit:

```sh
git tag -a v1.1.1 -m 'Release 1.1.1'
git push origin v1.1.1
```

The tag must exactly match the manifest and package version. The workflow stops
on test failures, version mismatches, upload failures, or submission warnings.
It never cancels another pending Store submission or changes listing/privacy fields.
Inspect the Actions run and Store dashboard to confirm **Pending review** or
**Published**. Do not move an existing release tag; fix the problem in a new version.

For a manual upload, use `dist/youtube-comments-closed-VERSION-webstore.zip`.
Upload it to the existing item's Package tab, save any listing changes, then
submit for review with automatic publication enabled.
