import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { COMMENTS, EXPANDED, HIDDEN, SHORTS_COMMENTS, openFixture } from './fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let context;
let profile;

before(async () => {
  profile = await mkdtemp(path.join(tmpdir(), 'youtube-comments-extension-test-'));
  const extension = path.join(root, 'extension');
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1400, height: 950 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
});

after(async () => {
  await context?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
});

async function closed(page, key = 'comments') {
  await page.waitForFunction(({ key, hidden }) => {
    const panel = document.querySelector('[data-test-key="' + key + '"]');
    return panel?.getAttribute('visibility') === hidden && window.closeCalls.some(call => call.key === key && call.expanded);
  }, { key, hidden: HIDDEN });
}

async function restored(page) {
  const state = await page.evaluate(() => ({
    width: document.querySelector('#player').getBoundingClientRect().width,
    commentsOpen: document.querySelector('ytd-watch-flexy').hasAttribute('comments-open'),
    syntheticEvents: window.syntheticEvents,
    calls: window.closeCalls,
  }));
  assert.equal(state.width, 1150, 'the native close must restore the full player width');
  assert.equal(state.commentsOpen, false);
  assert.deepEqual(state.syntheticEvents, [], 'only the scoped native close button should be clicked');
  assert.ok(state.calls.every(call => call.expanded), 'a hidden panel must never be toggled open');
}

test('MV3 isolated content script closes an expanded comments panel and restores the player', async t => {
  const page = await openFixture(context, t);
  await closed(page);
  await restored(page);
  assert.deepEqual(await page.evaluate(() => window.closeCalls), [{ key: 'comments', expanded: true }]);
});

test('native close still runs when a legacy blocker gives the panel display:none', async t => {
  const page = await openFixture(context, t, { panels: [{ legacyHidden: true }] });
  await closed(page);
  assert.equal(await page.locator('[data-test-key="comments"]').evaluate(panel => getComputedStyle(panel).display), 'none');
  await restored(page);
});

test('already hidden panels are never clicked, even after unrelated DOM mutations', async t => {
  const page = await openFixture(context, t, { panels: [{ visibility: HIDDEN }] });
  await page.evaluate(() => {
    document.body.append(document.createElement('div'));
    document.body.setAttribute('data-unrelated', 'updated');
  });
  await page.waitForTimeout(600);
  assert.deepEqual(await page.evaluate(() => window.closeAttempts), []);
  assert.equal(await page.locator('[data-test-key="comments"]').getAttribute('visibility'), HIDDEN);
});

test('an automatic reopening without a user click is closed again', async t => {
  const page = await openFixture(context, t, { panels: [{ visibility: HIDDEN }] });
  await page.evaluate(expanded => {
    document.querySelector('[data-test-key="comments"]').setAttribute('visibility', expanded);
    window.updateLayout();
  }, EXPANDED);
  await closed(page);
  await restored(page);
});

test('new comments content stays hidden while a lazy close control is loading', async t => {
  const page = await openFixture(context, t, { panels: [{ control: false }] });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-test-key="comments"]')).visibility === 'hidden');
  assert.deepEqual(await page.evaluate(() => window.closeCalls), []);
  await page.evaluate(() => window.addCloseControl(document.querySelector('[data-test-key="comments"]')));
  await closed(page);
  await restored(page);
});

test('bounded retry reaches a native handler hydrated after the first close attempt', async t => {
  const page = await openFixture(context, t, { panels: [{ hydrationDelay: 350 }] });
  await closed(page);
  assert.ok((await page.evaluate(() => window.closeAttempts)).length >= 2, 'the initial unhandled click needs a later retry');
  assert.deepEqual(await page.evaluate(() => window.closeCalls), [{ key: 'comments', expanded: true }]);
  await restored(page);
});

test('a disabled native close control is retried once YouTube enables it', async t => {
  const page = await openFixture(context, t, { panels: [{ disabled: true }] });
  await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(() => window.closeAttempts), []);
  await page.evaluate(() => { document.querySelector('[data-test-key="comments"] button').disabled = false; });
  await closed(page);
  await restored(page);
});

test('id-based comments panels and hidden classic close controls are supported', async t => {
  const page = await openFixture(context, t, { panels: [{ byId: true, classic: true, legacyHidden: true }] });
  await closed(page);
  await restored(page);
});

test('target-id changes identify a comments panel without requiring navigation', async t => {
  const page = await openFixture(context, t, { panels: [{ target: 'engagement-panel-structured-description' }] });
  await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(() => window.closeAttempts), []);
  await page.evaluate(comments => {
    document.querySelector('[data-test-key="comments"]').setAttribute('target-id', comments);
    window.updateLayout();
  }, COMMENTS);
  await closed(page);
  await restored(page);
});

test('id changes identify a comments panel without requiring navigation', async t => {
  const page = await openFixture(context, t, { panels: [{ byId: true, target: 'other-panel' }] });
  await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(() => window.closeAttempts), []);
  await page.evaluate(comments => {
    document.querySelector('[data-test-key="comments"]').id = comments;
    window.updateLayout();
  }, COMMENTS);
  await closed(page);
  await restored(page);
});

test('SPA navigation replaces the comments panel and closes the new instance', async t => {
  const page = await openFixture(context, t);
  await closed(page);
  await page.evaluate(() => {
    document.querySelector('[data-test-key="comments"]').remove();
    history.pushState({}, '', '/watch?v=second-fixture');
    window.makePanel({ key: 'second-comments' });
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await closed(page, 'second-comments');
  await restored(page);
  assert.deepEqual(await page.evaluate(() => window.closeCalls.map(call => call.key)), ['comments', 'second-comments']);
});

test('a document loaded on Home stays ready for a later SPA watch page', async t => {
  const page = await openFixture(context, t, { panels: [] }, '/');
  await page.evaluate(() => {
    history.pushState({}, '', '/watch?v=from-home');
    window.makePanel({ key: 'home-to-watch' });
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await closed(page, 'home-to-watch');
  await restored(page);
});

test('Description, Ask, and Transcript panels remain expanded', async t => {
  const otherTargets = ['engagement-panel-structured-description', 'engagement-panel-searchable-transcript', 'engagement-panel-conversation'];
  const page = await openFixture(context, t, { panels: [
    {},
    ...otherTargets.map((target, index) => ({ target, key: `other-${index}` })),
  ] });
  await closed(page);
  await page.waitForTimeout(350);
  assert.deepEqual(await page.evaluate(() => window.closeAttempts), ['comments']);
  for (let i = 0; i < otherTargets.length; i += 1) {
    assert.equal(await page.locator(`[data-test-key="other-${i}"]`).getAttribute('visibility'), EXPANDED);
  }
});

test('ordinary inline comments are hidden without hiding the player', async t => {
  const page = await openFixture(context, t, { panels: [] });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#inline-host > ytd-comments')).display === 'none');
  assert.equal(await page.locator('#player').isVisible(), true);
  assert.equal(await page.locator('#player').evaluate(player => player.getBoundingClientRect().width), 1150);
});

test('a comments close control outside the native panel header is not clicked', async t => {
  const page = await openFixture(context, t, { panels: [{ outsideHeader: true }] });
  await page.waitForTimeout(450);
  assert.deepEqual(await page.evaluate(() => window.closeAttempts), []);
  assert.equal(await page.locator('[data-test-key="comments"]').getAttribute('visibility'), EXPANDED);
});

test('unhandled close attempts stop at a bounded retry limit', async t => {
  const page = await openFixture(context, t, { panels: [{ hydrationDelay: 60000 }] });
  await page.waitForTimeout(4600);
  const attempts = await page.evaluate(() => window.closeAttempts.length);
  assert.ok(attempts >= 1 && attempts <= 6, `expected at most six close attempts, observed ${attempts} clicks`);
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(() => window.closeAttempts.length), attempts, 'the extension must stop retrying an unresponsive button');
  assert.deepEqual(await page.evaluate(() => window.closeCalls), []);
  await page.evaluate(({ hidden, expanded }) => {
    const panel = document.querySelector('[data-test-key="comments"]');
    panel.setAttribute('visibility', hidden);
    panel.setAttribute('visibility', expanded);
  }, { hidden: HIDDEN, expanded: EXPANDED });
  await page.waitForFunction(attempts => window.closeAttempts.length > attempts, attempts);
});

test('native readiness and changed controls recover reused panels after delayed handler hydration', async t => {
  // Separate documents keep a readiness event from accidentally resetting the
  // budget in another case. They share one wait for their bounded retries.
  const signals = ['yt-navigate-finish', 'yt-page-data-updated', 'pageshow', 'visibilitychange',
    'target-id', 'id', 'disabled', 'aria-disabled', 'close-control-id'];
  const cases = await Promise.all(signals.map(async signal => ({
    signal,
    page: await openFixture(context, t, { panels: [{ hydrationDelay: 60000, byId: signal === 'id' }] }),
  })));
  await cases[0].page.waitForTimeout(4600);
  for (const { signal, page } of cases) {
    assert.equal(await page.evaluate(() => window.closeAttempts.length), 6, `${signal}: the initial retry budget must be exhausted`);
    assert.deepEqual(await page.evaluate(() => window.closeCalls), []);
    await page.evaluate(({ signal, comments }) => {
      const panel = document.querySelector('[data-test-key="comments"]');
      const button = panel.querySelector('button');
      window.hydratePanel(panel);
      if (signal === 'target-id' || signal === 'id') {
        panel.setAttribute(signal, 'other-panel');
        panel.setAttribute(signal, comments);
      } else if (signal === 'disabled') {
        button.disabled = true;
        button.disabled = false;
      } else if (signal === 'aria-disabled') {
        button.setAttribute('aria-disabled', 'true');
        button.setAttribute('aria-disabled', 'false');
      } else if (signal === 'close-control-id') {
        button.id = 'new-native-button';
      } else if (signal === 'pageshow') {
        window.dispatchEvent(new PageTransitionEvent('pageshow'));
      } else {
        if (signal === 'visibilitychange' && document.hidden) throw new Error('Visibility fixture must be a visible document');
        document.dispatchEvent(new Event(signal));
      }
    }, { signal, comments: COMMENTS });
    await closed(page);
    await restored(page);
  }
});

async function staysOpen(page) {
  await page.waitForTimeout(350);
  assert.equal(await page.locator('[data-test-key="comments"]').getAttribute('visibility'), EXPANDED);
  assert.equal(await page.locator('[data-test-key="comments"] ytd-comments').isVisible(), true);
  assert.equal(await page.locator('[data-test-key="comments"]').evaluate(panel => getComputedStyle(panel).pointerEvents), 'auto');
}

test('clicking the native comments entry point opens readable comments and preserves them through readiness events', async t => {
  const page = await openFixture(context, t);
  await closed(page);
  assert.equal(await page.locator('ytd-comments-entry-point-header-renderer').isVisible(), true);
  await page.locator('#open-comments').click();
  await page.evaluate(() => {
    for (const event of ['yt-page-data-updated', 'yt-navigate-finish', 'visibilitychange']) document.dispatchEvent(new Event(event));
    window.dispatchEvent(new PageTransitionEvent('pageshow'));
    window.addCloseControl(document.querySelector('[data-test-key="comments"]'));
  });
  await staysOpen(page);
  assert.equal(await page.evaluate(() => window.closeCalls.length), 1);
});

test('keyboard activation and a click on a nested Shorts icon allow comments', async t => {
  const page = await openFixture(context, t, { panels: [{ visibility: HIDDEN }] }, '/shorts/first');
  await page.locator('#comments-button').focus();
  await page.keyboard.press('Enter');
  await staysOpen(page);
  await page.locator('[data-test-key="comments"] button').click();
  await page.locator('#comments-button span').click();
  await staysOpen(page);
});

test('programmatic opener clicks and unrelated trusted clicks do not opt in', async t => {
  const page = await openFixture(context, t, { panels: [{ visibility: HIDDEN }] });
  await page.locator('#other-action').click();
  await page.evaluate(() => document.querySelector('#open-comments').click());
  await closed(page);
  assert.equal(await page.locator('#inline-host ytd-comments').isVisible(), false);
});

test('inline comments have a working Show/Hide control without disabling the extension', async t => {
  const page = await openFixture(context, t, { panels: [] });
  const toggle = page.getByRole('button', { name: 'Show comments', exact: true });
  await toggle.click();
  assert.equal(await page.locator('#inline-host ytd-comments').isVisible(), true);
  assert.equal(await page.getByRole('button', { name: 'Hide comments', exact: true }).getAttribute('aria-expanded'), 'true');
  await page.getByRole('button', { name: 'Hide comments', exact: true }).click();
  assert.equal(await page.locator('#inline-host ytd-comments').isVisible(), false);
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
});

test('new videos reset opt-in even when YouTube reuses the same panel and inline comments', async t => {
  const page = await openFixture(context, t);
  await closed(page);
  await page.locator('#open-comments').click();
  await staysOpen(page);
  await page.evaluate(() => {
    history.pushState({}, '', '/watch?v=next-video');
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await page.waitForFunction(() => window.closeCalls.length === 2);
  assert.equal(await page.locator('#inline-host ytd-comments').isVisible(), false);
  assert.equal(await page.getByRole('button', { name: 'Show comments', exact: true }).count(), 1);
  await restored(page);
});

test('timestamp changes on the same video keep the user choice, Shorts navigation resets it', async t => {
  const page = await openFixture(context, t, { panels: [{ visibility: HIDDEN }] }, '/watch?v=same');
  await page.locator('#open-comments').click();
  await page.evaluate(() => {
    history.replaceState({}, '', '/watch?v=same&t=60&lc=comment');
    document.dispatchEvent(new Event('yt-page-data-updated'));
  });
  await staysOpen(page);
  await page.evaluate(() => {
    history.pushState({}, '', '/shorts/second');
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await closed(page);
});

test('opting in cancels pending close retries before a delayed handler hydrates', async t => {
  const page = await openFixture(context, t, { panels: [{ hydrationDelay: 500 }] });
  await page.waitForFunction(() => window.closeAttempts.length > 0);
  await page.locator('#open-comments').click();
  const count = await page.evaluate(() => window.closeAttempts.length);
  await page.waitForTimeout(1100);
  await staysOpen(page);
  assert.equal(await page.evaluate(() => window.closeAttempts.length), count);
});

test('lazy, moved and replaced inline comments keep exactly one working disclosure', async t => {
  const page = await openFixture(context, t, { panels: [] });
  await page.getByRole('button', { name: 'Show comments', exact: true }).waitFor();
  await page.evaluate(() => document.querySelector('[data-ycc-comments-toggle]').remove());
  await page.getByRole('button', { name: 'Show comments', exact: true }).waitFor();
  await page.evaluate(() => {
    const comments = document.querySelector('#inline-host ytd-comments');
    const holder = document.createElement('section');
    document.body.append(holder);
    holder.append(comments);
  });
  await page.getByRole('button', { name: 'Show comments', exact: true }).click();
  assert.equal(await page.locator('section > ytd-comments').isVisible(), true);
  await page.evaluate(() => document.querySelector('section > ytd-comments').remove());
  await page.waitForFunction(() => document.querySelectorAll('[data-ycc-comments-toggle]').length === 0);
  await page.evaluate(() => document.querySelector('#inline-host').append(document.createElement('ytd-comments')));
  await page.getByRole('button', { name: 'Hide comments', exact: true }).click();
  assert.equal(await page.locator('#inline-host ytd-comments').isVisible(), false);
});

test('modern Shorts reel-action-bar-view-model comment button opens, toggles closed, and reopens', async t => {
  const page = await openFixture(context, t, { panels: [{ target: SHORTS_COMMENTS, visibility: HIDDEN }] }, '/shorts');
  await page.locator('#reel-comments').click();
  await page.evaluate(() => {
    history.replaceState({}, '', '/shorts/first-reel');
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await staysOpen(page);
  await page.locator('#reel-comments').click();
  await page.waitForFunction(hidden =>
    document.querySelector('[data-test-key="comments"]')?.getAttribute('visibility') === hidden &&
    !document.documentElement.hasAttribute('data-ycc-comments-open'), HIDDEN);
  await page.locator('#reel-comments').click();
  await staysOpen(page);
});

test('Watch Side Rail comment button and inline disclosure with hidden inline comments sync the Side Rail panel', async t => {
  const page = await openFixture(context, t, { inlineHidden: true });
  await closed(page);
  await page.locator('#side-rail-comments').click();
  await staysOpen(page);
  assert.equal(await page.getByRole('button', { name: 'Hide comments', exact: true }).getAttribute('aria-expanded'), 'true');
  await page.getByRole('button', { name: 'Hide comments', exact: true }).click();
  await closed(page);
  assert.equal(await page.getByRole('button', { name: 'Show comments', exact: true }).getAttribute('aria-expanded'), 'false');
  await page.getByRole('button', { name: 'Show comments', exact: true }).click();
  await staysOpen(page);
});

test('player quick-action comment button, comment teaser, and unlabeled action container openers allow comments', async t => {
  const page = await openFixture(context, t, { panels: [{ visibility: HIDDEN }] });
  await page.locator('#quick-action-comments').click();
  await staysOpen(page);
  await page.locator('[data-test-key="comments"] button').click();
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-ycc-comments-open'));
  await page.locator('#teaser-button').click();
  await staysOpen(page);
  await page.locator('[data-test-key="comments"] button').click();
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-ycc-comments-open'));
  await page.locator('#side-rail-unlabeled').click();
  await staysOpen(page);
});
