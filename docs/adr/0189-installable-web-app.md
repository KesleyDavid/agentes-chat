# 0189. The site installs as a web app: a manifest with its name and icons

- Status: Proposed
- Date: 2026-11-16
- Builds on: ADR 0035 (the phone app), ADR 0036 (the desktop app), ADR 0071 (browser push, which left "a manifest so
  the site installs" for later), ADR 0179 (app icons drawn from the agent engine)
- Code: `apps/web/public/manifest.webmanifest`, `apps/web/index.html`; icons `apps/web/public/icon-192.png`,
  `icon-512.png`, `icon-maskable-512.png`, written by `packages/ui/scripts/app-icons.mjs` (`maskable`); tests
  `apps/web/test/web-app-manifest.test.ts`, `packages/ui/test/app-icons.test.ts`

## Context

People put the site on a phone's home screen or install it from the browser, next to or instead of the native apps.
Chrome and Edge let a person install any site, or make a shortcut to it, by hand from their menu, manifest or not;
with no manifest, that app is named after the page's title ("agentes.chat · Your team and your agents, in the same
conversation") and gets whatever icon the browser derives, and the browser never suggests installing it.

iPhones and iPads read their own tags for the home screen's icon and title: `index.html` already has them
(`apple-touch-icon`, drawn by ADR 0179's generator, and `apple-mobile-web-app-title`), and they are not repeated
here. Safari already opens the site as a web app when it is added to the Dock on a Mac, and on iOS 26 when it is
added to the Home Screen
([WebKit, Safari 26](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/)),
so the app already runs without browser bars: `viewport-fit=cover` with `env(safe-area-inset-*)` padding, and the
desktop app told apart by the `window.__agentesDesktop` its window sets (ADR 0036), never by the display mode.

Every app icon is drawn by one generator from the agent engine's scenes (ADR 0179), which already writes the web's
`favicon.ico`, `apple-touch-icon.png` and `icon-512.png` and the phone's Android adaptive layers. A person picks an
icon per device; in a browser that pick is the tab's icon.

## Decision

1. **A static manifest, `apps/web/public/manifest.webmanifest`, linked from `index.html`.** Name and short name
   `agentes.chat`, the page's description, `id`, `start_url` and `scope` `/`, and `display: standalone`.
   `theme_color` is the light theme's bar colour (`#f6f6f4`, the page's own `theme-color`, which still wins, dark
   included, once the page is open); `background_color` is the page's light background before its CSS loads
   (`#f6f9fd`), shown behind the icon while Android launches it. A manifest can't name a dark colour, so a launch in
   dark mode starts light for a moment.
2. **Icons: 192 and 512 PNG for `any`, and a 512 PNG for `maskable`, all from ADR 0179's generator.** None is drawn
   by hand: `node packages/ui/scripts/app-icons.mjs` writes them from the shipped icon's scene (Night) with the
   web's other files. `any` is the full-bleed icon, `icon-512.png` as before and the same scene at 192
   (`icon-192.png`). The maskable one (`icon-maskable-512.png`) is the scene as Android's adaptive icon draws it, its
   back layer and its front layer (the same layer data the phone's files come from), framed so the maskable safe
   zone (a circle 80% of the width) is the 72 dp Android shows of the 108 dp layers: under a round mask it looks like
   the native app's round icon, and larger masks show more of the sky around the agent. It is opaque (RGB, no
   alpha), so no mask shows through.
3. **No server change.** Hono's `serveStatic` already sends `.webmanifest` as `application/manifest+json`.
4. **No `related_applications`.** The browser offers this web app as it is; the native apps keep the download page.
5. **The service worker stays as it is**, push only (ADR 0071 §2). Chrome's install criteria
   ([web.dev](https://web.dev/articles/install-criteria), checked 2026-11-11) ask for the manifest's name, a 192 and
   a 512 icon, `start_url` and a standalone-like `display`, not for a worker that answers fetches; working offline
   would be a decision of its own.

## Consequences

- Chrome and Edge on Windows, Linux and macOS install it with this name and icon, not the page's title and a derived
  icon, and the site meets their criteria to promote the install ("Install app" in the address bar), still subject to
  HTTPS, the person's engagement and each browser's own rules. Installed, it opens in a window of its own. It sits
  next to the native desktop app, which still does what a browser can't (the menu bar, this computer's runner, its
  own notifications); the download page keeps offering the native one.
- Chrome on Android installs it with the maskable icon and opens it without the browser's bar.
- iPhone and iPad: Web Push reaches only a site added to the Home Screen as a web app, which a manifest whose
  `display` is `standalone` or `fullscreen` makes it
  ([WebKit, Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/),
  checked 2026-11-11). With this manifest, the site added there gets ADR 0071's browser push on every iOS version that
  has it, where the page already offers it (`canOfferWebPush` checks `display-mode: standalone`).
- An installed web app shows the shipped icon even when the person picked another one in the page: the manifest is a
  static file, and the pick (ADR 0179 §4) changes only the tab's icon, as the home screen's `apple-touch-icon` already
  stays the shipped one. Following the pick would need a manifest written per person, and an installed app takes a
  new icon only when the browser updates it in its own time; that is accepted.
- A link to another site (`target="_blank"`, outside `scope`) still opens outside the app, in the browser.
- Every server, self-hosted or not, installs as "agentes.chat" with this icon: the manifest is a static file of the
  build. A name per server would need the server to write the manifest, which nothing asks for yet.
- The icons change only through the generator: a new shipped scene gives the manifest's icons with the rest when the
  script runs again (ADR 0179 §1).

## Alternatives considered

- `display: browser`: the right name and icon on a shortcut, but Chrome and Edge don't promote the install (a person
  can still install it by hand), Android opens it in a browser tab, and before iOS 26 an iPhone keeps it a bookmark,
  without push.
- No manifest: a person can still install it by hand in Chrome and Edge, but under the page's title with a derived
  icon, no maskable icon for Android, no promoted install, and only iPhones get the name and icon right, through their
  own tags.
- Icons made once from the phone app's Android pictures and committed by hand: they would drift from the scenes every
  other icon is drawn from, and ADR 0179 draws every icon file from one generator.
