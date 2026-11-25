/* Service worker for the installable "Tasks" app (built by vite-plugin-pwa, strategy injectManifest).
 *
 * It caches only the app shell (the built JS/CSS/HTML/icons), so the app opens with no network. API
 * calls go to another origin (the backend) and are never intercepted, so nothing authenticated is cached.
 *
 * skipWaiting() and clientsClaim() run synchronously at the top on purpose: a new deploy's worker takes
 * over straight away (the page then reloads onto it, see src/main.jsx) instead of waiting for every open
 * window to close, which on a counter iPad that is never closed would mean never updating.
 */
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

self.skipWaiting();
clientsClaim();

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Any page navigation (/tasks, /inventory/products, ...) gets the SPA shell.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')));
