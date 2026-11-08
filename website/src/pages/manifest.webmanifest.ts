/**
 * The web app manifest — one per locale.
 *
 * A manifest carries no translations of its own, so a single file would install an Arabic reader's
 * copy under an English name that opens an English page. Three files, each linked from its own
 * locale's pages, is the whole fix.
 *
 * `start_url` is the times page rather than the home page: someone who installed this wanted the
 * tool, not the shop window. The scope stays the site root so the marketing pages are still
 * reachable from inside the installed copy — they simply wear the app's face there (see the
 * `display-mode: standalone` rules in Base.astro).
 */
import { manifestFor } from '../lib/manifest';

export const GET = () => manifestFor('en');
