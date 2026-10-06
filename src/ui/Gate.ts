import type { LatLon } from '../geo/mercator';
import type { LocationStatus } from '../geo/location';

type Mode = 'intro' | 'denied' | 'unavailable' | 'search' | 'hidden';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const COPY: Record<Exclude<Mode, 'hidden'>, { title: string; text: string; primary?: string; secondary?: boolean; search?: boolean }> = {
  intro: {
    title: 'Explore the world around you',
    text: 'SnapWorld builds a 3D map of the streets, buildings and places around your live location.',
    primary: 'Use my location',
    secondary: true,
  },
  denied: {
    title: 'Location is turned off',
    text: 'Allow location access for this site in your browser settings, then try again. You can search a place in the meantime.',
    primary: 'Try again',
    search: true,
  },
  unavailable: {
    title: "Couldn't find you",
    text: 'Your device didn’t return a location. Check that location services are on, or search a place to explore.',
    primary: 'Try again',
    search: true,
  },
  search: { title: 'Explore a place', text: 'Search for a city, street or landmark.', search: true },
};

/** Full-screen card for the location permission flow and place search. */
export class Gate {
  onPrimary: () => void = () => {};
  onPlace: (p: LatLon, label: string) => void = () => {};
  private mode: Mode = 'intro';
  private searchTimer = 0;
  private dismissible = false;

  constructor() {
    $('gate-primary').addEventListener('click', () => this.onPrimary());
    $('gate-secondary').addEventListener('click', () => this.show('search', true));
    $('search-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.search($<HTMLInputElement>('search-input').value, true);
    });
    $('search-input').addEventListener('input', (e) => {
      clearTimeout(this.searchTimer);
      const q = (e.target as HTMLInputElement).value;
      this.searchTimer = window.setTimeout(() => this.search(q), 450);
    });
    // Tap outside the card closes the search when the map behind is usable.
    $('gate').addEventListener('click', (e) => {
      if (e.target === $('gate') && this.dismissible) this.show('hidden');
    });
  }

  show(mode: Mode, dismissible = false) {
    this.mode = mode;
    this.dismissible = dismissible;
    $('gate').classList.toggle('hidden', mode === 'hidden');
    if (mode === 'hidden') return;
    const c = COPY[mode];
    $('gate-title').textContent = c.title;
    $('gate-text').textContent = c.text;
    $('gate-primary').textContent = c.primary ?? '';
    $('gate-primary').classList.toggle('hidden', !c.primary);
    $('gate-secondary').classList.toggle('hidden', !c.secondary);
    $('search-form').classList.toggle('hidden', !c.search);
    if (c.search) setTimeout(() => $('search-input').focus(), 50);
  }

  /** Reflect location status changes (only switches away from intro on failures). */
  status(s: LocationStatus) {
    if (s === 'denied' || s === 'unavailable') this.show(s);
    else if ((s === 'ok' || s === 'override') && this.mode !== 'search') this.show('hidden');
  }

  private async search(q: string, immediate = false) {
    const list = $('search-results');
    q = q.trim();
    if (q.length < 3 && !immediate) {
      list.innerHTML = '';
      return;
    }
    list.innerHTML = '<li class="note">Searching…</li>';
    try {
      // OpenStreetMap Nominatim: only the typed query is sent.
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const results: { lat: string; lon: string; name: string; display_name: string }[] = await res.json();
      list.innerHTML = '';
      if (!results.length) list.innerHTML = '<li class="note">No places found</li>';
      for (const r of results) {
        const li = document.createElement('li');
        li.tabIndex = 0;
        const title = document.createElement('b');
        title.textContent = r.name || r.display_name.split(',')[0];
        li.append(title, document.createTextNode(r.display_name));
        const pick = () => {
          this.onPlace({ lat: parseFloat(r.lat), lon: parseFloat(r.lon) }, title.textContent ?? '');
          this.show('hidden');
        };
        li.addEventListener('click', pick);
        li.addEventListener('keydown', (e) => e.key === 'Enter' && pick());
        list.append(li);
      }
    } catch {
      list.innerHTML = '<li class="note">Search is unavailable right now</li>';
    }
  }
}
