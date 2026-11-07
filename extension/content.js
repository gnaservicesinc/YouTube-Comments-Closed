(() => {
  "use strict";

  const PANEL_TAG = "ytd-engagement-panel-section-list-renderer";
  const PANEL_IDS = [
    "engagement-panel-comments-section",
    "shorts-engagement-panel-comments-section",
    "comments-section",
  ];
  const COMMENTS = PANEL_IDS.flatMap(id => [
    `${PANEL_TAG}[target-id="${id}"]`,
    `${PANEL_TAG}#${id}`,
  ]).join(", ");
  const EXPANDED = "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED";
  const OPEN_ATTRIBUTE = "data-ycc-comments-open";
  const TOGGLE_ATTRIBUTE = "data-ycc-comments-toggle";
  const OPEN_CONTROLS = [
    "ytd-comments-entry-point-header-renderer",
    "ytd-comments-entry-point-teaser-renderer",
    "#comment-teaser",
    "#comments-button",
    "#open-comments",
    '[aria-controls="comments"]',
    ...PANEL_IDS.flatMap(id => [
      `[aria-controls="${id}"]`,
      `[target-id="${id}"]:not(${PANEL_TAG})`,
    ]),
    'a[href="#comments"]',
    "yt-player-quick-action-buttons > toggle-button-view-model",
    "reel-action-bar-view-model > button-view-model:first-of-type",
  ].join(",");
  const ACTION_CONTAINERS = [
    "yt-side-rail-view-model",
    "reel-action-bar-view-model",
    "yt-reel-player-overlay-view-model",
    "ytd-reel-player-overlay-renderer",
    "yt-player-quick-action-buttons",
    ".ytp-fullscreen-quick-actions",
    "ytd-watch-metadata",
    "ytd-comments-header-renderer",
  ].join(",");
  const COMMENT_ICON_SELECTOR = [
    'svg path[d*="21.604"]',
    'svg path[d*="14.2 20H19"]',
    'svg path[d*="M20 2H4"]',
    'svg path[d*="M21 6h-2v9H6"]',
    'svg path[d*="M9 22a1 1 0 01-1-1v-3H4"]',
  ].join(",");
  // Retrying covers a close button rendered before its event handler is ready.
  // Keep attempts bounded so a changed YouTube layout cannot cause a click loop.
  const RETRY_DELAYS = [100, 250, 500, 1000, 2000];
  const attempts = new WeakMap();
  let frame = 0;
  let retryTimer = 0;
  let commentsOpen = false;
  let openedAt = 0;
  let lastActionClick = 0;
  let video = videoKey();
  const toggles = new WeakMap();

  function videoKey() {
    // Ignore timestamps, comment links, and tracking parameters on the same
    // video. Hydration and visibility events must not undo an explicit click.
    const url = new URL(location.href);
    return url.pathname === "/watch" ? `/watch?v=${url.searchParams.get("v") || ""}` : url.pathname;
  }

  function syncVideo() {
    const next = videoKey();
    if (next === video) return false;
    const initialShortsResolve = video === "/shorts" && next.startsWith("/shorts/");
    video = next;
    if (initialShortsResolve && commentsOpen) return false;
    commentsOpen = false;
    openedAt = 0;
    lastActionClick = 0;
    for (const panel of document.querySelectorAll(COMMENTS)) attempts.delete(panel);
    return true;
  }

  function isCommentLabel(text) {
    return Boolean(text && /\bcomments?\b/i.test(text) && !/\b(sort|close|hide|disable)\b/i.test(text));
  }

  function isCommentButton(node) {
    if (!node.matches("button, [role='button'], [role='tab'], button-view-model, ytd-button-renderer")) {
      return false;
    }
    if (node.querySelector(COMMENT_ICON_SELECTOR)) return true;
    if (node.closest("ytd-comments")) return false;
    const control = node.matches("button, [role='button'], [role='tab']")
      ? node
      : node.querySelector("button, [role='button'], [role='tab']");
    const labelText = node.closest("label, button-view-model")
      ?.querySelector(".ytSpecButtonShapeWithLabelLabel")?.textContent;
    return isCommentLabel(node.getAttribute("aria-label")) ||
      isCommentLabel(node.getAttribute("title")) ||
      isCommentLabel(control?.getAttribute("aria-label")) ||
      isCommentLabel(control?.getAttribute("title")) ||
      isCommentLabel(labelText);
  }

  function isOpenControl(path) {
    if (path.some(node =>
      node.hasAttribute(TOGGLE_ATTRIBUTE) ||
      node.matches(`${PANEL_TAG}, #visibility-button, #close-button, #sort-menu, yt-sort-filter-sub-menu-renderer`)
    )) {
      return false;
    }
    return path.some(node => node.matches(OPEN_CONTROLS) || isCommentButton(node));
  }

  function findOpenButton() {
    const candidates = document.querySelectorAll([
      "yt-side-rail-view-model button",
      "yt-side-rail-view-model [role='tab']",
      "ytd-comments-entry-point-header-renderer button",
      "ytd-comments-entry-point-header-renderer [role='button']",
      "#comment-teaser button",
      "#open-comments",
      "#comments-button",
      "yt-player-quick-action-buttons > toggle-button-view-model button",
      "reel-action-bar-view-model > button-view-model:first-of-type button",
    ].join(","));
    for (const candidate of candidates) {
      if (!candidate.closest(PANEL_TAG) &&
          (candidate.matches(OPEN_CONTROLS) || isCommentButton(candidate) || candidate.closest(OPEN_CONTROLS))) {
        return candidate;
      }
    }
    return null;
  }

  function openCommentsPanel() {
    const panels = [...document.querySelectorAll(COMMENTS)];
    if (panels.some(panel => panel.getAttribute("visibility") === EXPANDED)) return;
    findOpenButton()?.click();
  }

  function updateDisclosure() {
    document.documentElement?.toggleAttribute(OPEN_ATTRIBUTE, commentsOpen);
    for (const comments of document.querySelectorAll("ytd-comments")) {
      if (comments.closest(PANEL_TAG)) continue;
      let button = toggles.get(comments);
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.setAttribute(TOGGLE_ATTRIBUTE, "");
        if (comments.id) button.setAttribute("aria-controls", comments.id);
        button.addEventListener("click", event => {
          if (!event.isTrusted) return;
          syncVideo();
          commentsOpen = !commentsOpen;
          openedAt = commentsOpen ? performance.now() : 0;
          lastActionClick = 0;
          if (commentsOpen) {
            clearTimeout(retryTimer);
            for (const panel of document.querySelectorAll(COMMENTS)) attempts.delete(panel);
          }
          updateDisclosure();
          if (commentsOpen && comments.hidden) openCommentsPanel();
          scheduleClose();
        });
        toggles.set(comments, button);
      }
      if (comments.previousElementSibling !== button) comments.before(button);
      const label = commentsOpen ? "Hide comments" : "Show comments";
      if (button.textContent !== label) button.textContent = label;
      button.setAttribute("aria-expanded", String(commentsOpen));
    }
    for (const button of document.querySelectorAll(`button[${TOGGLE_ATTRIBUTE}]`)) {
      if (!button.nextElementSibling?.matches("ytd-comments")) button.remove();
    }
  }

  document.addEventListener("click", event => {
    if (!event.isTrusted) {
      lastActionClick = 0;
      return;
    }
    // Capture before YouTube's handler opens the panel. Keyboard activation of
    // native buttons also produces a trusted click; scripted clicks do not.
    const path = event.composedPath().filter(node => node instanceof Element);
    if (path.some(node => node.hasAttribute(TOGGLE_ATTRIBUTE))) return;
    if (path.some(node => node.matches("#visibility-button, #close-button"))) {
      openedAt = 0;
      lastActionClick = 0;
      return;
    }
    const anyExpanded = [...document.querySelectorAll(COMMENTS)]
      .some(panel => panel.getAttribute("visibility") === EXPANDED);
    if (!isOpenControl(path)) {
      if (!anyExpanded &&
          !path.some(node => node.matches(`${PANEL_TAG}, a[href]:not([href^="#"])`)) &&
          path.some(node => node.matches("button, [role='button'], [role='tab']")) &&
          path.some(node => node.matches(ACTION_CONTAINERS))) {
        lastActionClick = performance.now();
      } else {
        lastActionClick = 0;
      }
      return;
    }
    syncVideo();
    const wasOpen = commentsOpen && anyExpanded;
    commentsOpen = true;
    openedAt = wasOpen ? 0 : performance.now();
    lastActionClick = 0;
    clearTimeout(retryTimer);
    for (const panel of document.querySelectorAll(COMMENTS)) attempts.delete(panel);
    updateDisclosure();
  }, true);

  function closeControl(panel) {
    // Structural IDs work in every language. Never select a page-wide "Close"
    // button: Description, Ask, transcript, and dialogs have their own controls.
    const selectors = [
      "ytd-engagement-panel-title-header-renderer #visibility-button button",
      "ytd-engagement-panel-title-header-renderer #visibility-button [role='button']",
      "#header #visibility-button button",
      "#header #visibility-button [role='button']",
      "#header #close-button button",
      "#header button#close-button",
      "#header yt-icon-button#close-button",
    ];
    for (const selector of selectors) {
      const button = panel.querySelector(selector);
      if (button && !button.disabled && button.getAttribute("aria-disabled") !== "true") {
        return button;
      }
    }
    return null;
  }

  function closeComments() {
    frame = 0;
    clearTimeout(retryTimer);
    retryTimer = 0;
    syncVideo();
    updateDisclosure();
    if (commentsOpen) return;
    let nextRetry = Infinity;

    for (const panel of document.querySelectorAll(COMMENTS)) {
      // CSS visibility/display is deliberately ignored. Another blocker can
      // hide the panel while YouTube still reserves an open column for it.
      if (panel.getAttribute("visibility") !== EXPANDED) {
        attempts.delete(panel);
        continue;
      }

      const button = closeControl(panel);
      if (!button) continue; // The observer will catch the lazily built header.
      let attempt = attempts.get(panel);
      if (!attempt || attempt.button !== button) {
        attempt = { button, count: 0, next: 0 };
        attempts.set(panel, attempt);
      }
      if (attempt.count > RETRY_DELAYS.length) continue;

      const now = performance.now();
      if (now >= attempt.next) {
        // Use YouTube's own action so its internal panel state, column width,
        // and player size all update together. Do not edit visibility ourselves.
        button.click();
        attempt.next = now + (RETRY_DELAYS[attempt.count] ?? Infinity);
        attempt.count += 1;
      }
      if (panel.getAttribute("visibility") === EXPANDED) {
        nextRetry = Math.min(nextRetry, Math.max(0, attempt.next - performance.now()));
      } else {
        attempts.delete(panel);
      }
    }

    if (Number.isFinite(nextRetry)) {
      retryTimer = setTimeout(scheduleClose, nextRetry);
    }
  }

  function scheduleClose() {
    if (!frame) frame = requestAnimationFrame(closeComments);
  }

  function pageReady() {
    // YouTube can reuse the same panel and button for the next video. A new
    // page readiness event starts a fresh bounded cycle after slow hydration.
    syncVideo();
    lastActionClick = 0;
    for (const panel of document.querySelectorAll(COMMENTS)) attempts.delete(panel);
    scheduleClose();
  }

  function hasPanel(node) {
    return node instanceof Element &&
      (node.matches(`${PANEL_TAG}, ytd-comments, [${TOGGLE_ATTRIBUTE}]`) ||
       node.querySelector(`${PANEL_TAG}, ytd-comments`) !== null);
  }

  const observer = new MutationObserver((records) => {
    let relevant = false;
    for (const record of records) {
      const target = record.target;
      if (record.type === "attributes") {
        if (!(target instanceof Element)) continue;
        if (target.matches(PANEL_TAG)) {
          const isCommentsPanel = target.matches(COMMENTS);
          const nowExpanded = target.getAttribute("visibility") === EXPANDED;
          if (record.attributeName === "visibility") {
            if (record.oldValue !== EXPANDED && nowExpanded) {
              attempts.delete(target);
              if (isCommentsPanel && !commentsOpen && lastActionClick &&
                  performance.now() - lastActionClick < 500) {
                syncVideo();
                commentsOpen = true;
                openedAt = performance.now();
                lastActionClick = 0;
                clearTimeout(retryTimer);
              }
            } else if (isCommentsPanel && record.oldValue === EXPANDED && !nowExpanded) {
              const wasScriptAttempt = attempts.has(target);
              attempts.delete(target);
              if (commentsOpen && !wasScriptAttempt && performance.now() - openedAt > 200) {
                commentsOpen = false;
                openedAt = 0;
                lastActionClick = 0;
              }
            }
          } else if (["target-id", "id"].includes(record.attributeName) &&
                     record.oldValue !== target.getAttribute(record.attributeName)) {
            attempts.delete(target);
          }
          relevant = true;
        } else {
          const panel = target.closest(COMMENTS);
          if (panel) {
            const button = attempts.get(panel)?.button;
            if (button === target && record.oldValue !== target.getAttribute(record.attributeName) &&
                (record.attributeName === "id" ||
                 (record.attributeName === "disabled" && !target.hasAttribute("disabled")) ||
                 (record.attributeName === "aria-disabled" && target.getAttribute("aria-disabled") !== "true"))) {
              attempts.delete(panel);
            }
            relevant = true;
          }
        }
      } else if ((target instanceof Element && target.closest(COMMENTS)) ||
                 Array.from(record.addedNodes).some(hasPanel) ||
                 Array.from(record.removedNodes).some(hasPanel)) {
        relevant = true;
      }
    }
    if (relevant) scheduleClose();
  });

  // documentElement can still be absent at document_start.
  observer.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ["visibility", "target-id", "id", "disabled", "aria-disabled"],
  });

  // The script is injected on all desktop YouTube routes, including Home, so
  // clicking through to a video does not depend on a full page reload.
  document.addEventListener("yt-navigate-finish", pageReady);
  document.addEventListener("yt-page-data-updated", pageReady);
  window.addEventListener("pageshow", pageReady);
  window.addEventListener("popstate", pageReady);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) pageReady();
  });
  scheduleClose();
})();
