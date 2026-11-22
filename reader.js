(() => {
  'use strict';

  const metadata = window.bridgeReaderMetadata || {};
  const pageShots = window.bridgeReaderPageShots || {};
  const readerUrl = document.currentScript?.src || document.baseURI;
  const narrow = matchMedia('(max-width: 46rem)');
  const timeout = 12000;
  const previewModeKey = 'bridge-reader-preview-mode';
  const maxAutomaticEmbeds = 3;
  const xHosts = ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'];
  const youtubeHosts = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'];
  const scriptLoads = new Map();

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function button(label, className = 'br-action') {
    const node = element('button', className, label);
    node.type = 'button';
    return node;
  }

  function externalLink(href) {
    const link = element('a', 'br-action', 'Open in new tab');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  }

  function pageShot(link) {
    const shot = pageShots[link.href] || pageShots[link.getAttribute('href')];
    if (!shot || !/^media\/previews\/[a-z0-9][a-z0-9_.-]*\.(?:webp|png|jpe?g)$/i.test(shot.path)) return;
    if (!Number.isInteger(shot.width) || !Number.isInteger(shot.height) || shot.width < 1 || shot.height < 1) return;
    return { src: new URL(shot.path, readerUrl).href, width: shot.width, height: shot.height };
  }

  function screenshot(shot, alt = '') {
    const image = element('img', 'br-page-shot-image');
    image.alt = alt;
    image.width = shot.width;
    image.height = shot.height;
    image.decoding = 'async';
    return image;
  }

  function seconds(value) {
    if (!value) return 0;
    if (/^\d+$/.test(value)) return Number(value);
    const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i.exec(value);
    return match ? Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0) : 0;
  }

  function describeLink(link) {
    const url = new URL(link.href);
    const host = url.hostname;
    const info = metadata[link.href] || metadata[link.getAttribute('href')] || {};
    const text = link.textContent.trim();
    const image = link.querySelector('img');
    const label = text || link.getAttribute('aria-label') || 'Article image';
    const source = { url, info, label, image };
    const post = xHosts.includes(host) && url.pathname.match(/\/status\/(\d+)(?:\/|$)/);
    if (post) return { ...source, platform: 'X', id: post[1] };

    if (youtubeHosts.includes(host)) {
      const [, route, pathId] = url.pathname.split('/');
      const id = host === 'youtu.be' ? route : ['shorts', 'live', 'embed'].includes(route) ? pathId : url.searchParams.get('v');
      if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) {
        const start = seconds(url.searchParams.get('start') || url.searchParams.get('t') || new URLSearchParams(url.hash.slice(1)).get('t'));
        return { ...source, platform: 'YouTube', id, start };
      }
    }
    return { ...source, shot: image ? undefined : pageShot(link) };
  }

  // Wait for the provider API even when a host page already includes its script.
  function provider(src, ready) {
    const existing = ready();
    if (existing) return Promise.resolve(existing);
    if (scriptLoads.has(src)) return scriptLoads.get(src);

    const pending = new Promise((resolve, reject) => {
      const prior = [...document.scripts].find(script => script.src === src);
      const script = prior || element('script');
      let clock;
      let timer;
      function clear() {
        clearTimeout(clock);
        clearInterval(timer);
        script.removeEventListener('error', unavailable);
      }
      function unavailable() {
        clear();
        if (!prior) script.remove();
        reject(new Error('Provider unavailable'));
      }
      function check() {
        const api = ready();
        if (api) {
          clear();
          resolve(api);
        }
      }
      script.addEventListener('error', unavailable, { once: true });
      timer = setInterval(check, 80);
      clock = setTimeout(unavailable, timeout);
      if (!prior) {
        script.async = true;
        script.src = src;
        document.head.append(script);
      }
    }).finally(() => scriptLoads.delete(src));
    scriptLoads.set(src, pending);
    return pending;
  }

  async function renderPost(media, container, signal) {
    const widgets = await provider('https://platform.twitter.com/widgets.js', () => window.twttr?.widgets);
    if (signal.aborted) return;
    const scheme = getComputedStyle(container).colorScheme;
    const useDark = scheme === 'dark' || (scheme.includes('dark') && matchMedia('(prefers-color-scheme: dark)').matches);
    const theme = useDark ? 'dark' : 'light';
    const blockAutoplay = frame => {
      const features = (frame.getAttribute('allow') || '').split(';').filter(feature =>
        feature.trim() && !/^autoplay\b/i.test(feature.trim())
      );
      frame.setAttribute('allow', [...features, "autoplay 'none'"].join('; '));
    };
    const observeFrames = new MutationObserver(() => {
      container.querySelectorAll('iframe').forEach(blockAutoplay);
    });
    observeFrames.observe(container, { childList: true, subtree: true });
    signal.addEventListener('abort', () => observeFrames.disconnect(), { once: true });
    const result = await widgets.createTweet(media.id, container, { theme, dnt: true });
    if (!result) throw new Error('Post unavailable');
    container.querySelectorAll('iframe').forEach(blockAutoplay);
  }

  async function renderVideo(media, container, signal, onUnavailable, onPlayback) {
    const playerUrl = new URL(`https://www.youtube-nocookie.com/embed/${media.id}`);
    playerUrl.searchParams.set('enablejsapi', '1');
    playerUrl.searchParams.set('autoplay', '0');
    if (location.origin !== 'null') playerUrl.searchParams.set('origin', location.origin);
    if (media.start) playerUrl.searchParams.set('start', String(media.start));

    const frame = element('iframe', 'br-video');
    frame.title = media.info.title || 'YouTube video';
    frame.src = playerUrl.href;
    frame.allow = "accelerometer; autoplay 'none'; encrypted-media; gyroscope; picture-in-picture; fullscreen";
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    container.append(frame);
    const Player = await provider('https://www.youtube.com/iframe_api', () => window.YT?.Player);
    if (signal.aborted) return;
    await new Promise(resolve => {
      const player = new Player(frame, {
        events: {
          onReady: resolve,
          onError: onUnavailable,
          onStateChange: event => onPlayback(event.data === window.YT.PlayerState.PLAYING ||
            event.data === window.YT.PlayerState.BUFFERING),
        },
      });
      signal.addEventListener('abort', () => {
        player.destroy();
        resolve();
      }, { once: true });
    });
  }

  function attachNavigation(root) {
    const index = root.querySelector('.br-index');
    const timeline = root.querySelector('.br-timeline');
    const navs = [index.querySelector('nav'), timeline.querySelector('nav')];
    const sections = [root.querySelector('#bridge-introduction'), ...root.querySelectorAll('.br-section')];
    const targets = new Map(sections.map(section => [`#${section.id}`, section]));
    let activeId;
    let pending;

    function keepVisible(nav, link) {
      if (!nav.clientWidth) return;
      const viewport = nav.getBoundingClientRect();
      const item = link.getBoundingClientRect();
      if (nav === navs[1]) {
        if (item.left < viewport.left || item.right > viewport.right) {
          nav.scrollBy({ left: (item.left + item.right - viewport.left - viewport.right) / 2 });
        }
      } else if (item.top < viewport.top || item.bottom > viewport.bottom) {
        nav.scrollBy({ top: (item.top + item.bottom - viewport.top - viewport.bottom) / 2 });
      }
    }

    function update() {
      pending = undefined;
      const sectionOffset = Number.parseFloat(getComputedStyle(sections[0]).scrollMarginTop) || 0;
      const threshold = sectionOffset + 75;
      let active = sections[0];
      for (const section of sections) {
        if (section.getBoundingClientRect().top > threshold) break;
        active = section;
      }
      if (active.id === activeId) return;
      activeId = active.id;
      for (const nav of navs) {
        nav.querySelector('[aria-current]')?.removeAttribute('aria-current');
        const link = nav.querySelector(`a[href="#${activeId}"]`);
        if (!link) {
          if (nav === navs[1]) nav.scrollTo({ left: 0 });
          continue;
        }
        link.setAttribute('aria-current', 'location');
        keepVisible(nav, link);
      }
    }

    function schedule() {
      if (pending === undefined) pending = requestAnimationFrame(update);
    }

    function applyLayout() {
      index.open = !narrow.matches;
      timeline.open = !narrow.matches;
      schedule();
    }

    applyLayout();
    narrow.addEventListener('change', applyLayout);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('hashchange', schedule);
    root.addEventListener('load', schedule, true);

    for (const nav of navs) {
      nav.parentElement.addEventListener('toggle', () => {
        const current = nav.querySelector('[aria-current]');
        if (current) keepVisible(nav, current);
        schedule();
      });
      nav.addEventListener('click', event => {
        const link = event.target.closest('a');
        if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const target = targets.get(link.hash);
        if (!target) return;
        if (narrow.matches && nav === navs[0]) index.open = false;
        requestAnimationFrame(() => target.focus({ preventScroll: true }));
      });
    }

    navs[1].addEventListener('keydown', event => {
      const link = event.target.closest('a');
      if (!link || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const entries = [...navs[1].querySelectorAll('a')];
      const previous = entries.indexOf(link);
      const offset = event.key === 'ArrowLeft' ? -1 : 1;
      const step = getComputedStyle(navs[1]).direction === 'rtl' ? -offset : offset;
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : previous + step;
      if (!entries[next]) return;
      event.preventDefault();
      entries[next].focus({ preventScroll: true });
      keepVisible(navs[1], entries[next]);
    });

    index.addEventListener('keydown', event => {
      if (event.key === 'Escape' && index.open) {
        index.open = false;
        index.querySelector('summary').focus();
      }
    });
    index.addEventListener('focusout', event => {
      if (narrow.matches && index.open && event.relatedTarget && !index.contains(event.relatedTarget)) index.open = false;
    });
    document.addEventListener('click', event => {
      if (narrow.matches && index.open && !index.contains(event.target)) index.open = false;
    });
  }

  function attachPreviews(root) {
    const dialog = root.querySelector('.br-dialog');
    const dialogTitle = dialog.querySelector('h2');
    const dialogDomain = dialog.querySelector('.br-domain');
    const dialogBody = dialog.querySelector('.br-dialog-body');
    const status = root.querySelector('[data-reader-status]');
    const groups = new Map();
    const entries = new Map();
    const automatic = new Set();
    const connection = navigator.connection;
    let opener;
    let slowEntry;
    let savedMode;

    try { savedMode = localStorage.getItem(previewModeKey); } catch {}
    const deviceMode = () => connection?.saveData || ['slow-2g', '2g'].includes(connection?.effectiveType)
      ? 'light'
      : 'expanded';
    let mode = ['light', 'expanded'].includes(savedMode) ? savedMode : deviceMode();

    const options = element('div', 'br-preview-options');
    const modeButton = button('');
    const modeHint = element('span', 'br-preview-mode');
    options.append(modeButton, modeHint);
    root.querySelector('.br-byline').after(options);

    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(changes => {
      for (const change of changes) {
        const entry = entries.get(change.target);
        entry.near = change.isIntersecting;
      }
      loadNearby();
    }, { rootMargin: '200px 0px' }) : null;

    function showDialog(title, domain, trigger, content) {
      opener = trigger;
      dialogTitle.textContent = title;
      dialogDomain.textContent = domain;
      dialogDomain.hidden = !domain;
      dialogBody.replaceChildren(content);
      if (!dialog.open) dialog.showModal();
    }

    dialog.addEventListener('close', () => {
      dialogBody.replaceChildren();
      opener?.focus({ preventScroll: true });
      opener = undefined;
    });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right ||
          event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    });

    function showSourcePreview(source, trigger, framePage = false) {
      const content = document.createDocumentFragment();
      const { info, url, image, shot } = source;
      const title = info.title || source.label;
      if (info.description) content.append(element('p', '', info.description));
      if (shot && !framePage) {
        const capture = screenshot(shot, `Screenshot of ${url.hostname}`);
        capture.addEventListener('error', () => capture.remove(), { once: true });
        capture.src = shot.src;
        content.append(capture);
      } else if (image || info.image) {
        const thumbnail = image ? image.cloneNode() : element('img');
        if (!image) {
          thumbnail.src = info.image;
          thumbnail.alt = '';
          thumbnail.referrerPolicy = 'no-referrer';
          thumbnail.addEventListener('error', () => thumbnail.remove(), { once: true });
        }
        content.append(thumbnail);
      }
      const actions = element('div', 'br-dialog-actions');
      actions.append(externalLink(url.href));
      content.append(actions);
      if (framePage) {
        const frame = element('iframe', 'br-page-frame');
        frame.title = title;
        frame.src = url.href;
        frame.referrerPolicy = 'strict-origin-when-cross-origin';
        frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
        frame.setAttribute('allow', "autoplay 'none'");
        content.append(frame);
      }
      showDialog(title, url.hostname, trigger, content);
    }

    function placeCard(link, card) {
      const paragraph = link.closest('p, blockquote');
      if (!paragraph) {
        link.after(card);
        return;
      }
      let end = link;
      while (end.parentElement !== paragraph) end = end.parentElement;
      while (end.nextSibling && end.nextSibling.nodeName !== 'BR') end = end.nextSibling;
      const boundary = end.nextSibling;
      const key = boundary || paragraph;
      if (!groups.has(key)) {
        const group = element('span', 'br-preview-group');
        paragraph.insertBefore(group, boundary);
        groups.set(key, group);
      }
      groups.get(key).append(card);
    }

    function showSlowOption(entry) {
      if (slowEntry || mode !== 'expanded' || entry.card.hidden || !entry.near) return;
      const message = element('span', 'br-preview-slow', 'Preview taking a while? ');
      const light = button('Use light previews', 'br-mini');
      light.addEventListener('click', () => {
        changeMode('light', true);
        entry.trigger.focus({ preventScroll: true });
      });
      message.append(light);
      entry.card.append(message);
      slowEntry = { entry, message };
    }

    function removeSlowOption(entry) {
      if (slowEntry?.entry !== entry) return;
      slowEntry.message.remove();
      slowEntry = undefined;
    }

    function stopMedia(entry) {
      if (!entry.mount) return;
      const { slot, controller, slowTimer, timer } = entry.mount;
      entry.mount = undefined;
      clearTimeout(slowTimer);
      clearTimeout(timer);
      automatic.delete(entry);
      controller.abort();
      slot.remove();
      removeSlowOption(entry);
      entry.loadButton.hidden = false;
    }

    function loadNearby() {
      if (mode !== 'expanded') return;
      for (const entry of automatic) {
        if (entry.near || entry.mount.playing || entry.mount.slot.contains(document.activeElement)) continue;
        stopMedia(entry);
      }
      for (const entry of entries.values()) {
        if (automatic.size >= maxAutomaticEmbeds) break;
        if (!entry.mount && entry.near && !entry.card.hidden && !entry.failed) loadMedia(entry, true);
      }
    }

    function loadMedia(entry, auto = false) {
      if (entry.mount) return;
      const { source, card, loadButton, embedNotice } = entry;
      const controller = new AbortController();
      const slot = element('span', 'br-preview-player');
      const container = element('span', 'br-preview-frame');
      const loading = element('span', 'br-preview-loading', `Loading ${source.platform}…`);
      if (!auto) loading.setAttribute('role', 'status');
      slot.append(loading, container);
      card.append(slot);
      embedNotice.hidden = true;
      loadButton.hidden = true;
      if (auto) automatic.add(entry);

      function unavailable() {
        if (controller.signal.aborted) return;
        entry.failed = true;
        const focusWasInPlayer = slot.contains(document.activeElement);
        stopMedia(entry);
        embedNotice.hidden = false;
        loadButton.textContent = 'Retry embed';
        if (focusWasInPlayer) loadButton.focus({ preventScroll: true });
        loadNearby();
      }

      const timer = setTimeout(unavailable, timeout);
      const slowTimer = setTimeout(() => showSlowOption(entry), 3000);
      const mount = { slot, controller, timer, slowTimer, playing: false };
      entry.mount = mount;
      const render = source.platform === 'X' ? renderPost : renderVideo;
      render(source, container, controller.signal, unavailable, playing => {
        if (controller.signal.aborted) return;
        mount.playing = playing;
        if (!playing) loadNearby();
      }).then(() => {
        if (controller.signal.aborted) return;
        clearTimeout(timer);
        clearTimeout(slowTimer);
        removeSlowOption(entry);
        loading.remove();
      }, unavailable);
    }

    function populateCard(entry) {
      if (entry.closeButton) return;
      const { source, card } = entry;
      const title = element('span', 'br-preview-title', entry.title);
      const header = element('span', 'br-preview-card-header');
      const close = button('Close preview', 'br-mini br-preview-close');
      close.setAttribute('aria-label', `Close preview: ${entry.title}`);
      close.addEventListener('click', () => {
        if (mode === 'expanded') entry.dismissed = true;
        showCard(entry, false);
        entry.trigger.focus({ preventScroll: true });
        loadNearby();
      });
      entry.closeButton = close;
      header.append(title, close);
      card.append(header);
      if (entry.title !== source.url.hostname) {
        card.append(element('span', 'br-preview-domain', source.url.hostname));
      }
      if (source.info.description) {
        card.append(element('span', 'br-preview-description', source.info.description));
      }
      if (source.shot) {
        const enlarge = button('', 'br-page-shot-button');
        const thumbnail = screenshot(source.shot);
        enlarge.setAttribute('aria-label', `Enlarge page screenshot: ${entry.title}`);
        enlarge.setAttribute('aria-haspopup', 'dialog');
        enlarge.addEventListener('click', () => showSourcePreview(source, enlarge));
        thumbnail.loading = 'lazy';
        thumbnail.addEventListener('error', () => enlarge.remove(), { once: true });
        thumbnail.src = source.shot.src;
        enlarge.append(thumbnail);
        card.append(enlarge);
      }
      const actions = element('span', 'br-preview-actions');
      if (source.platform) {
        const label = source.platform === 'YouTube' ? 'Load video player' : 'Load X post';
        entry.loadButton = button(label);
        entry.embedNotice = element('span', 'br-preview-loading', 'This embed is unavailable.');
        entry.embedNotice.setAttribute('role', 'status');
        entry.embedNotice.hidden = true;
        entry.loadButton.addEventListener('click', () => {
          loadMedia(entry);
          close.focus({ preventScroll: true });
        });
        actions.append(entry.loadButton);
      } else {
        const framePage = source.info.frame && source.url.protocol === 'https:' && source.url.origin !== location.origin;
        if (framePage || (source.info.image && !source.shot)) {
          const view = button(framePage ? 'View page here' : 'View details');
          view.setAttribute('aria-haspopup', 'dialog');
          view.addEventListener('click', () => showSourcePreview(source, view, framePage));
          actions.append(view);
        }
      }
      actions.append(externalLink(source.url.href));
      card.append(actions);
      if (entry.embedNotice) card.append(entry.embedNotice);
    }

    function showCard(entry, open) {
      const { card, trigger, source } = entry;
      if (open) populateCard(entry);
      card.hidden = !open;
      trigger.hidden = open;
      trigger.setAttribute('aria-expanded', String(open));
      if (!open) stopMedia(entry);
      if (!source.platform) return;
      if (open && mode === 'expanded') {
        observer?.observe(card);
      } else {
        observer?.unobserve(card);
        entry.near = false;
      }
    }

    function changeMode(next, remember = false) {
      mode = next;
      if (remember) {
        savedMode = mode;
        try { localStorage.setItem(previewModeKey, mode); } catch {}
      }
      modeButton.textContent = mode === 'light' ? 'Expand previews' : 'Use light previews';
      modeHint.textContent = mode === 'light' ? 'Previews load on click.' : '';
      modeHint.hidden = mode !== 'light';
      for (const entry of entries.values()) {
        showCard(entry, mode === 'expanded' && !entry.dismissed);
      }
      if (remember) status.textContent = mode === 'light' ? 'Previews load on click.' : 'Previews expanded.';
    }

    for (const link of root.querySelectorAll('.br-prose a[href], .br-cover a[href]')) {
      if (!['https:', 'http:'].includes(link.protocol)) continue;
      const source = describeLink(link);
      const trigger = button(source.image ? 'Preview image' : 'Preview', 'br-mini');
      if (source.image) {
        trigger.setAttribute('aria-haspopup', 'dialog');
        trigger.addEventListener('click', () => showSourcePreview(source, trigger));
        link.after(trigger);
        continue;
      }
      const title = source.info.title || (source.platform === 'X' ? 'X post' : source.platform === 'YouTube' ? 'YouTube video' :
        (/^(?:https?:\/\/|www\.)/i.test(source.label) ? source.url.hostname : source.label));
      const card = element('span', 'br-preview-card');
      card.id = `bridge-preview-${entries.size + 1}`;
      const entry = { source, title, card, trigger };
      entries.set(card, entry);
      placeCard(link, card);
      trigger.setAttribute('aria-label', `Preview: ${title}`);
      trigger.setAttribute('aria-controls', card.id);
      trigger.addEventListener('click', () => {
        entry.dismissed = false;
        showCard(entry, true);
        if (source.platform) loadMedia(entry);
        entry.closeButton.focus({ preventScroll: true });
      });
      link.after(trigger);
    }
    modeButton.addEventListener('click', () => changeMode(mode === 'light' ? 'expanded' : 'light', true));
    connection?.addEventListener('change', () => {
      if (!savedMode && deviceMode() !== mode) changeMode(deviceMode());
    });
    changeMode(mode);

    for (const heading of root.querySelectorAll('.br-section')) {
      const copy = button('Copy section link', 'br-mini');
      copy.addEventListener('click', async () => {
        const url = new URL(location.href);
        url.hash = heading.id;
        try {
          await navigator.clipboard.writeText(url.href);
          status.textContent = 'Section link copied.';
          copy.textContent = 'Copied';
          setTimeout(() => { copy.textContent = 'Copy section link'; }, 1500);
        } catch {
          const field = element('input', 'br-copy-field');
          field.value = url.href;
          field.readOnly = true;
          field.setAttribute('aria-label', 'Section URL');
          showDialog('Copy section link', '', copy, field);
          field.focus();
          field.select();
        }
      });
      heading.after(copy);
    }
  }

  for (const root of document.querySelectorAll('[data-bridge-reader]')) {
    attachNavigation(root);
    attachPreviews(root);
  }
})();
