(() => {
  "use strict";

  const PANEL_TAG = "ytd-engagement-panel-section-list-renderer";
  const COMMENT_PANEL_IDS = [
    "engagement-panel-comments-section",
    "shorts-engagement-panel-comments-section",
    "comments-section",
  ];
  const DESCRIPTION_PANEL_IDS = [
    "engagement-panel-structured-description",
  ];
  const ASK_PANEL_IDS = [
    "PAyouchat",
    "engagement-panel-youchat",
  ];

  function panelSelector(ids) {
    return ids.flatMap(id => [
      `${PANEL_TAG}[target-id="${id}"]`,
      `${PANEL_TAG}#${id}`,
    ]).join(", ");
  }

  const COMMENTS = panelSelector(COMMENT_PANEL_IDS);
  const DESCRIPTIONS = panelSelector(DESCRIPTION_PANEL_IDS);
  const ASKS = panelSelector(ASK_PANEL_IDS);
  const ALL_MANAGED_PANELS = [COMMENTS, DESCRIPTIONS, ASKS].join(", ");
  const SIDE_RAIL_WATCH_SELECTOR = [
    "ytd-watch-flexy[side-rail-dismissible-panels]",
    "ytd-watch-flexy[fixed-default-panels]",
    "ytd-watch-flexy[show-fixed-side-menu]",
    "ytd-watch-flexy[use-engagement-panel-for-structured-description]",
  ].join(", ");
  const EXPANDED = "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED";
  const OPEN_ATTRIBUTES = {
    comments: "data-ycc-comments-open",
    description: "data-ycc-description-open",
    ask: "data-ycc-ask-open",
  };
  const TOGGLE_ATTRIBUTE = "data-ycc-comments-toggle";
  const MODE_STORAGE_KEY = "ycc-panel-mode";
  const MODE_ALWAYS_CLOSED = "always-closed";
  const MODE_REMEMBER = "remember";
  const PANEL_KINDS = ["comments", "description", "ask"];

  const OPEN_CONTROLS = [
    "ytd-comments-entry-point-header-renderer",
    "ytd-comments-entry-point-teaser-renderer",
    "#comment-teaser",
    "#comments-button",
    "#open-comments",
    '[aria-controls="comments"]',
    ...COMMENT_PANEL_IDS.flatMap(id => [
      `[aria-controls="${id}"]`,
      `[target-id="${id}"]:not(${PANEL_TAG})`,
    ]),
    'a[href="#comments"]',
    "yt-player-quick-action-buttons > toggle-button-view-model",
    "reel-action-bar-view-model > button-view-model:first-of-type",
  ].join(",");

  const DESCRIPTION_OPEN_CONTROLS = [
    "ytd-watch-metadata #description",
    "#description-inline-expander",
    "#expand",
    "#expand-sizer",
    "ytd-text-inline-expander #expand",
    "tp-yt-paper-button#expand",
    "#structured-description",
    ...DESCRIPTION_PANEL_IDS.flatMap(id => [
      `[aria-controls="${id}"]`,
      `[target-id="${id}"]:not(${PANEL_TAG})`,
    ]),
  ].join(",");

  const ASK_OPEN_CONTROLS = [
    ...ASK_PANEL_IDS.flatMap(id => [
      `[aria-controls="${id}"]`,
      `[target-id="${id}"]:not(${PANEL_TAG})`,
    ]),
  ].join(",");

  const PANEL_CLOSE_CONTROLS = [
    "#visibility-button",
    "#close-button",
    ".ytVideoTitleHeaderViewModelHeaderButton",
    "yt-video-title-header-view-model button",
    "yt-floating-button-view-model button",
    ".ytPanelHeaderViewModelTrailingButtons button",
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
  const toggles = new WeakMap();
  let frame = 0;
  let retryTimer = 0;
  let lastActionClick = 0;
  const openState = {
    comments: false,
    description: false,
    ask: false,
  };
  const openedAt = {
    comments: 0,
    description: 0,
    ask: 0,
  };
  const reopenOnToggleClose = {
    comments: false,
    description: false,
    ask: false,
  };
  const bumpedByAutoOpen = {
    comments: false,
    description: false,
    ask: false,
  };
  const rememberedUntil = {
    comments: 0,
    description: 0,
    ask: 0,
  };

  function getPanelMode() {
    try {
      return localStorage.getItem(MODE_STORAGE_KEY) === MODE_REMEMBER
        ? MODE_REMEMBER
        : MODE_ALWAYS_CLOSED;
    } catch {
      return MODE_ALWAYS_CLOSED;
    }
  }

  let panelMode = getPanelMode();
  let video = videoKey();

  function setPanelMode(mode) {
    panelMode = mode === MODE_REMEMBER ? MODE_REMEMBER : MODE_ALWAYS_CLOSED;
    try {
      localStorage.setItem(MODE_STORAGE_KEY, panelMode);
    } catch {
      // Ignore storage quota or privacy-mode errors.
    }
    syncSettingsCardRadios();
  }

  if (globalThis.chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "ycc-set-mode") {
        setPanelMode(message.mode);
        sendResponse({ ok: true, mode: panelMode });
      } else if (message?.type === "ycc-get-mode") {
        panelMode = getPanelMode();
        sendResponse({ ok: true, mode: panelMode });
      }
      return false;
    });
  }

  window.addEventListener("storage", event => {
    if (event.key === MODE_STORAGE_KEY) {
      panelMode = getPanelMode();
      syncSettingsCardRadios();
    }
  });

  function videoKey() {
    // Ignore timestamps, comment links, and tracking parameters on the same
    // video. Hydration and visibility events must not undo an explicit click.
    const url = new URL(location.href);
    return url.pathname === "/watch" ? `/watch?v=${url.searchParams.get("v") || ""}` : url.pathname;
  }

  function isManagedDescriptionPanel(panel) {
    if (!panel.matches(DESCRIPTIONS)) return false;
    return document.querySelector(SIDE_RAIL_WATCH_SELECTOR) !== null ||
      panel.querySelector("yt-video-title-header-view-model, ytd-structured-description-content-renderer") !== null;
  }

  function panelKind(panel) {
    if (!(panel instanceof Element) || !panel.matches(PANEL_TAG)) return null;
    if (panel.matches(COMMENTS)) return "comments";
    if (panel.matches(ASKS)) return "ask";
    if (isManagedDescriptionPanel(panel)) return "description";
    return null;
  }

  function panelsForKind(kind) {
    if (kind === "comments") return [...document.querySelectorAll(COMMENTS)];
    if (kind === "ask") return [...document.querySelectorAll(ASKS)];
    if (kind === "description") {
      return [...document.querySelectorAll(DESCRIPTIONS)].filter(isManagedDescriptionPanel);
    }
    return [];
  }

  function isKindExpanded(kind) {
    return panelsForKind(kind).some(panel => panel.getAttribute("visibility") === EXPANDED);
  }

  function hasUnrequestedExpandedPanel(excludeKind) {
    for (const kind of PANEL_KINDS) {
      if (kind !== excludeKind && !openState[kind] && isKindExpanded(kind)) {
        return true;
      }
    }
    return false;
  }

  function hasOtherExpandedPanel() {
    for (const panel of document.querySelectorAll(`${PANEL_TAG}[visibility="${EXPANDED}"]`)) {
      if (panelKind(panel) === null) return true;
    }
    return false;
  }

  function syncVideo() {
    const next = videoKey();
    if (next === video) return false;
    const initialShortsResolve = video === "/shorts" && next.startsWith("/shorts/");
    panelMode = getPanelMode();
    const rememberWatchPanel = panelMode === MODE_REMEMBER &&
      video.startsWith("/watch") &&
      next.startsWith("/watch");
    video = next;
    if (initialShortsResolve && openState.comments) return false;
    for (const kind of PANEL_KINDS) {
      if (rememberWatchPanel && openState[kind]) {
        openedAt[kind] = performance.now();
        rememberedUntil[kind] = performance.now() + 2500;
        reopenOnToggleClose[kind] = false;
        bumpedByAutoOpen[kind] = true;
      } else {
        openState[kind] = false;
        openedAt[kind] = 0;
        rememberedUntil[kind] = 0;
        reopenOnToggleClose[kind] = false;
        bumpedByAutoOpen[kind] = false;
      }
    }
    lastActionClick = 0;
    for (const panel of document.querySelectorAll(ALL_MANAGED_PANELS)) attempts.delete(panel);
    return true;
  }

  function getButtonLabelText(node) {
    return node.closest("label, button-view-model")
      ?.querySelector(".ytSpecButtonShapeWithLabelLabel")?.textContent;
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
    const labelText = getButtonLabelText(node);
    return isCommentLabel(node.getAttribute("aria-label")) ||
      isCommentLabel(node.getAttribute("title")) ||
      isCommentLabel(control?.getAttribute("aria-label")) ||
      isCommentLabel(control?.getAttribute("title")) ||
      isCommentLabel(labelText);
  }

  function isDescriptionLabel(text) {
    return Boolean(text && /\bdescription\b/i.test(text) && !/\b(close|hide)\b/i.test(text));
  }

  function isDescriptionButton(node) {
    if (!node.matches("button, [role='button'], [role='tab'], button-view-model, ytd-button-renderer")) {
      return false;
    }
    if (node.closest(PANEL_TAG)) return false;
    const control = node.matches("button, [role='button'], [role='tab']")
      ? node
      : node.querySelector("button, [role='button'], [role='tab']");
    const labelText = getButtonLabelText(node);
    return isDescriptionLabel(node.getAttribute("aria-label")) ||
      isDescriptionLabel(node.getAttribute("title")) ||
      isDescriptionLabel(control?.getAttribute("aria-label")) ||
      isDescriptionLabel(control?.getAttribute("title")) ||
      isDescriptionLabel(labelText);
  }

  function isAskLabel(text) {
    return Boolean(text && /\b(ask|youchat)\b/i.test(text) && !/\b(close|hide)\b/i.test(text));
  }

  function isAskButton(node) {
    if (!node.matches("button, [role='button'], [role='tab'], button-view-model, ytd-button-renderer")) {
      return false;
    }
    if (node.closest(PANEL_TAG)) return false;
    const control = node.matches("button, [role='button'], [role='tab']")
      ? node
      : node.querySelector("button, [role='button'], [role='tab']");
    const labelText = getButtonLabelText(node);
    return isAskLabel(node.getAttribute("aria-label")) ||
      isAskLabel(node.getAttribute("title")) ||
      isAskLabel(control?.getAttribute("aria-label")) ||
      isAskLabel(control?.getAttribute("title")) ||
      isAskLabel(labelText) ||
      (Boolean(node.closest("ytd-watch-metadata, yt-side-rail-view-model")) && isAskLabel(node.textContent));
  }

  function clickControlKind(path) {
    if (path.some(node =>
      node.hasAttribute(TOGGLE_ATTRIBUTE) ||
      node.matches(`${PANEL_TAG}, ${PANEL_CLOSE_CONTROLS}, #sort-menu, yt-sort-filter-sub-menu-renderer`)
    )) {
      return null;
    }
    if (path.some(node => node.matches(OPEN_CONTROLS) || isCommentButton(node))) {
      return "comments";
    }
    if (path.some(node => node.matches('a[href]:not([href^="#"])'))) {
      return null;
    }
    if (path.some(node => node.matches(ASK_OPEN_CONTROLS) || isAskButton(node))) {
      return "ask";
    }
    if (path.some(node => node.matches(DESCRIPTION_OPEN_CONTROLS) || isDescriptionButton(node))) {
      return "description";
    }
    return null;
  }

  function findOpenButton(kind = "comments") {
    if (kind === "description") {
      const candidates = document.querySelectorAll([
        "yt-side-rail-view-model button",
        "yt-side-rail-view-model [role='tab']",
        DESCRIPTION_OPEN_CONTROLS,
      ].join(","));
      for (const candidate of candidates) {
        if (!candidate.closest(PANEL_TAG) &&
            (candidate.matches(DESCRIPTION_OPEN_CONTROLS) || isDescriptionButton(candidate))) {
          return candidate;
        }
      }
      return null;
    }
    if (kind === "ask") {
      const candidates = document.querySelectorAll([
        "yt-side-rail-view-model button",
        "yt-side-rail-view-model [role='tab']",
        "ytd-watch-metadata button",
        ASK_OPEN_CONTROLS,
      ].join(","));
      for (const candidate of candidates) {
        if (!candidate.closest(PANEL_TAG) &&
            (candidate.matches(ASK_OPEN_CONTROLS) || isAskButton(candidate))) {
          return candidate;
        }
      }
      return null;
    }
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

  function openPanel(kind = "comments") {
    if (isKindExpanded(kind)) return;
    findOpenButton(kind)?.click();
  }

  function updateDisclosure() {
    for (const kind of PANEL_KINDS) {
      document.documentElement?.toggleAttribute(OPEN_ATTRIBUTES[kind], openState[kind]);
    }
    document.documentElement?.toggleAttribute("data-ycc-other-panel-open", hasOtherExpandedPanel());
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
          openState.comments = !openState.comments;
          openedAt.comments = openState.comments ? performance.now() : 0;
          reopenOnToggleClose.comments = false;
          bumpedByAutoOpen.comments = false;
          lastActionClick = 0;
          if (openState.comments) {
            clearTimeout(retryTimer);
            for (const panel of panelsForKind("comments")) attempts.delete(panel);
          }
          updateDisclosure();
          if (openState.comments && comments.hidden) openPanel("comments");
          scheduleClose();
        });
        toggles.set(comments, button);
      }
      if (comments.previousElementSibling !== button) comments.before(button);
      const label = openState.comments ? "Hide comments" : "Show comments";
      if (button.textContent !== label) button.textContent = label;
      button.setAttribute("aria-expanded", String(openState.comments));
    }
    for (const button of document.querySelectorAll(`button[${TOGGLE_ATTRIBUTE}]`)) {
      if (!button.nextElementSibling?.matches("ytd-comments")) button.remove();
    }
    updateSettingsCard();
  }

  function syncSettingsCardRadios() {
    for (const card of document.querySelectorAll("section[data-ycc-settings-card]")) {
      const radio = card.querySelector(`input[name="yccPanelMode"][value="${panelMode}"]`);
      if (radio instanceof HTMLInputElement) radio.checked = true;
    }
  }

  function updateSettingsCard() {
    if (!location.pathname.startsWith("/account")) {
      for (const card of document.querySelectorAll("section[data-ycc-settings-card]")) {
        card.remove();
      }
      return;
    }
    const container = document.querySelector([
      "ytd-page-manager ytd-section-list-renderer #contents",
      "ytd-settings-options-renderer #contents",
      "[data-ycc-settings-container]",
    ].join(", "));
    if (!container) return;
    let card = container.querySelector("section[data-ycc-settings-card]");
    if (!card) {
      card = document.createElement("section");
      card.setAttribute("data-ycc-settings-card", "");

      const form = document.createElement("form");
      const fieldset = document.createElement("fieldset");
      const legend = document.createElement("legend");
      legend.textContent = "YouTube Comments Closed — Side Rail & comments";
      fieldset.append(legend);

      const options = [
        {
          id: "ycc-setting-always-closed",
          value: MODE_ALWAYS_CLOSED,
          title: "Always start closed",
          detail: " — start every video with Comments, Description, and Ask closed",
        },
        {
          id: "ycc-setting-remember",
          value: MODE_REMEMBER,
          title: "Remember open panel",
          detail: " — keep your opened panel across videos until you close it",
        },
      ];

      for (const opt of options) {
        const label = document.createElement("label");
        label.htmlFor = opt.id;
        label.className = "ycc-settings-option";

        const input = document.createElement("input");
        input.type = "radio";
        input.id = opt.id;
        input.name = "yccPanelMode";
        input.value = opt.value;
        input.checked = panelMode === opt.value;

        const text = document.createElement("span");
        const strong = document.createElement("strong");
        strong.textContent = opt.title;
        text.append(strong, document.createTextNode(opt.detail));

        label.append(input, text);
        fieldset.append(label);
      }

      form.addEventListener("change", event => {
        const target = event.target;
        if (target instanceof HTMLInputElement && target.name === "yccPanelMode") {
          setPanelMode(target.value);
        }
      });

      form.append(fieldset);
      card.append(form);
      container.prepend(card);
    }
    syncSettingsCardRadios();
  }

  function finishDismissibleTransition() {
    if (PANEL_KINDS.some(kind => openState[kind]) || hasOtherExpandedPanel()) return;
    const flexy = document.querySelector("ytd-watch-flexy.dismissible-panels-transitioning");
    const columns = flexy?.querySelector("#columns") ||
      document.querySelector("ytd-watch-flexy #columns.side-rail-transitioning");
    if (columns && typeof TransitionEvent === "function") {
      columns.dispatchEvent(new TransitionEvent("transitionend", { propertyName: "width", bubbles: true }));
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
    if (path.some(node => node.matches(PANEL_CLOSE_CONTROLS))) {
      const panel = path.find(node => node.matches(PANEL_TAG));
      const kind = panel ? panelKind(panel) : null;
      if (kind) {
        openedAt[kind] = 0;
        rememberedUntil[kind] = 0;
        reopenOnToggleClose[kind] = false;
        bumpedByAutoOpen[kind] = false;
      } else {
        for (const k of PANEL_KINDS) {
          openedAt[k] = 0;
          rememberedUntil[k] = 0;
          reopenOnToggleClose[k] = false;
          bumpedByAutoOpen[k] = false;
        }
      }
      lastActionClick = 0;
      return;
    }
    const kind = clickControlKind(path);
    if (!kind) {
      if (path.some(node => node.matches(PANEL_TAG)) &&
          path.some(node => node.matches("button, [role='button']"))) {
        for (const k of PANEL_KINDS) {
          openedAt[k] = 0;
          rememberedUntil[k] = 0;
          reopenOnToggleClose[k] = false;
          bumpedByAutoOpen[k] = false;
        }
        lastActionClick = 0;
      } else if (!path.some(node => node.matches(`${PANEL_TAG}, a[href]:not([href^="#"])`)) &&
          path.some(node => node.matches("button, [role='button'], [role='tab']")) &&
          path.some(node => node.matches(ACTION_CONTAINERS))) {
        lastActionClick = performance.now();
      } else {
        lastActionClick = 0;
      }
      return;
    }
    syncVideo();
    const expandedNow = isKindExpanded(kind);
    const wasOpen = openState[kind] && expandedNow;
    const inSideRail = path.some(node => node.matches("yt-side-rail-view-model"));
    for (const otherKind of PANEL_KINDS) {
      if (otherKind !== kind) {
        if (inSideRail) openState[otherKind] = false;
        openedAt[otherKind] = 0;
        rememberedUntil[otherKind] = 0;
        reopenOnToggleClose[otherKind] = false;
        bumpedByAutoOpen[otherKind] = false;
      }
    }
    openState[kind] = true;
    openedAt[kind] = wasOpen ? 0 : performance.now();
    rememberedUntil[kind] = 0;
    reopenOnToggleClose[kind] = !wasOpen && expandedNow;
    bumpedByAutoOpen[kind] = false;
    lastActionClick = 0;
    clearTimeout(retryTimer);
    for (const panel of panelsForKind(kind)) attempts.delete(panel);
    updateDisclosure();
    if (inSideRail) scheduleClose();
  }, true);

  function closeControl(panel, kind) {
    // Structural IDs and header view models work in every language.
    const selectors = [
      "ytd-engagement-panel-title-header-renderer #visibility-button button",
      "ytd-engagement-panel-title-header-renderer #visibility-button [role='button']",
      "#header #visibility-button button",
      "#header #visibility-button [role='button']",
      "#header #close-button button",
      "#header button#close-button",
      "#header yt-icon-button#close-button",
      "#header yt-panel-header-view-model .ytPanelHeaderViewModelTrailingButtons button",
    ];
    if (kind === "description" || kind === "ask") {
      selectors.push(
        "yt-panel-header-view-model .ytPanelHeaderViewModelTrailingButtons button",
        "yt-video-title-header-view-model .ytVideoTitleHeaderViewModelHeaderButton button",
        "yt-video-title-header-view-model button",
        "yt-floating-button-view-model button",
      );
    }
    for (const selector of selectors) {
      const button = panel.querySelector(selector);
      if (button && !button.disabled && button.getAttribute("aria-disabled") !== "true") {
        return button;
      }
    }
    if (kind === "ask") {
      for (const tab of document.querySelectorAll('yt-side-rail-view-model button[role="tab"][aria-selected="true"]')) {
        if ((isAskButton(tab) || (!isCommentButton(tab) && !isDescriptionButton(tab))) &&
            !tab.disabled && tab.getAttribute("aria-disabled") !== "true") {
          return tab;
        }
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
    let nextRetry = Infinity;

    for (const panel of document.querySelectorAll(ALL_MANAGED_PANELS)) {
      const kind = panelKind(panel);
      if (!kind || openState[kind]) {
        attempts.delete(panel);
        continue;
      }
      // CSS visibility/display is deliberately ignored. Another blocker can
      // hide the panel while YouTube still reserves an open column for it.
      if (panel.getAttribute("visibility") !== EXPANDED) {
        attempts.delete(panel);
        continue;
      }

      const button = closeControl(panel, kind);
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

    finishDismissibleTransition();

    for (const kind of PANEL_KINDS) {
      if (bumpedByAutoOpen[kind] && openState[kind] && !hasUnrequestedExpandedPanel(kind)) {
        if (!isKindExpanded(kind)) {
          bumpedByAutoOpen[kind] = false;
          openPanel(kind);
        } else if (performance.now() >= rememberedUntil[kind]) {
          bumpedByAutoOpen[kind] = false;
        }
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
    for (const panel of document.querySelectorAll(ALL_MANAGED_PANELS)) attempts.delete(panel);
    scheduleClose();
  }

  function hasPanel(node) {
    return node instanceof Element &&
      (node.matches(`${PANEL_TAG}, ytd-comments, [${TOGGLE_ATTRIBUTE}], ytd-section-list-renderer, ytd-settings-options-renderer, [data-ycc-settings-container]`) ||
       node.querySelector(`${PANEL_TAG}, ytd-comments, ytd-section-list-renderer, ytd-settings-options-renderer, [data-ycc-settings-container]`) !== null);
  }

  const observer = new MutationObserver((records) => {
    let relevant = false;
    for (const record of records) {
      const target = record.target;
      if (record.type === "attributes") {
        if (!(target instanceof Element)) continue;
        if (target.matches("ytd-watch-flexy")) {
          relevant = true;
          continue;
        }
        if (target.matches(PANEL_TAG)) {
          const kind = panelKind(target);
          const nowExpanded = target.getAttribute("visibility") === EXPANDED;
          if (record.attributeName === "visibility") {
            if (record.oldValue !== EXPANDED && nowExpanded) {
              attempts.delete(target);
              if (!kind) {
                for (const k of PANEL_KINDS) {
                  if (!isKindExpanded(k)) openState[k] = false;
                  openedAt[k] = 0;
                  rememberedUntil[k] = 0;
                  reopenOnToggleClose[k] = false;
                  bumpedByAutoOpen[k] = false;
                }
                lastActionClick = 0;
              } else if (!openState[kind] && lastActionClick &&
                  performance.now() - lastActionClick < 500) {
                syncVideo();
                for (const otherKind of PANEL_KINDS) {
                  if (otherKind !== kind) {
                    openState[otherKind] = false;
                    openedAt[otherKind] = 0;
                    reopenOnToggleClose[otherKind] = false;
                    bumpedByAutoOpen[otherKind] = false;
                  }
                }
                openState[kind] = true;
                openedAt[kind] = performance.now();
                reopenOnToggleClose[kind] = false;
                bumpedByAutoOpen[kind] = false;
                lastActionClick = 0;
                clearTimeout(retryTimer);
              }
            } else if (kind && record.oldValue === EXPANDED && !nowExpanded) {
              const wasScriptAttempt = attempts.has(target);
              attempts.delete(target);
              if (openState[kind] && !wasScriptAttempt) {
                if (hasOtherExpandedPanel()) {
                  openState[kind] = false;
                  openedAt[kind] = 0;
                  rememberedUntil[kind] = 0;
                  reopenOnToggleClose[kind] = false;
                  bumpedByAutoOpen[kind] = false;
                  lastActionClick = 0;
                } else if (reopenOnToggleClose[kind] && performance.now() - openedAt[kind] <= 200) {
                  reopenOnToggleClose[kind] = false;
                  openedAt[kind] = performance.now();
                  requestAnimationFrame(() => openPanel(kind));
                } else if (hasUnrequestedExpandedPanel(kind) || performance.now() < rememberedUntil[kind]) {
                  bumpedByAutoOpen[kind] = true;
                } else if (performance.now() - openedAt[kind] > 200) {
                  openState[kind] = false;
                  openedAt[kind] = 0;
                  rememberedUntil[kind] = 0;
                  reopenOnToggleClose[kind] = false;
                  bumpedByAutoOpen[kind] = false;
                  lastActionClick = 0;
                }
              }
            }
          } else if (["target-id", "id"].includes(record.attributeName) &&
                     record.oldValue !== target.getAttribute(record.attributeName)) {
            attempts.delete(target);
          }
          relevant = true;
        } else {
          const panel = target.closest(ALL_MANAGED_PANELS);
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
      } else if ((target instanceof Element && target.closest(ALL_MANAGED_PANELS)) ||
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
    attributeFilter: [
      "visibility",
      "target-id",
      "id",
      "disabled",
      "aria-disabled",
      "side-rail-dismissible-panels",
      "fixed-default-panels",
      "show-fixed-side-menu",
      "use-engagement-panel-for-structured-description",
      "fixed-panel-expanded",
    ],
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
