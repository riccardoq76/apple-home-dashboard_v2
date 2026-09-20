import { CustomizationManager } from '../utils/CustomizationManager';
import { localize } from '../utils/LocalizationService';

export interface PersonInfo {
  entityId: string;
  name: string;
  /** True when the person is in the home zone */
  home: boolean;
  /** Localized location: "Home", "Away", or the name of the zone they are in */
  location: string;
  picture?: string;
  lastChanged?: string;
}

export class PeopleSection {
  private customizationManager: CustomizationManager;

  constructor(customizationManager: CustomizationManager) {
    this.customizationManager = customizationManager;
  }

  /**
   * Collect `person` entities. People at home come first, then alphabetically.
   */
  static getPeople(hass: any, excluded: ReadonlySet<string> = new Set()): PersonInfo[] {
    const result: PersonInfo[] = [];
    if (!hass?.states) return result;

    for (const entityId of Object.keys(hass.states)) {
      if (!entityId.startsWith('person.')) continue;
      if (excluded.has(entityId)) continue;

      // hass.entities is the display registry: it exposes `hidden`, while `hidden_by` only exists in the full registry
      const registry = hass.entities?.[entityId];
      if (registry && (registry.hidden || registry.hidden_by || registry.disabled_by)) continue;

      const state = hass.states[entityId];
      if (!state) continue;

      const home = state.state === 'home';
      result.push({
        entityId,
        name: state.attributes?.friendly_name || entityId.split('.')[1],
        home,
        location: PeopleSection.getLocation(hass, state.state),
        picture: state.attributes?.entity_picture,
        lastChanged: state.last_changed
      });
    }

    return result.sort((a, b) => Number(b.home) - Number(a.home) || a.name.localeCompare(b.name));
  }

  static hasPeople(hass: any, excluded: ReadonlySet<string> = new Set()): boolean {
    return PeopleSection.getPeople(hass, excluded).length > 0;
  }

  /** Short text for the chip: "2 Home", "Nobody home", or the state of a single person */
  static getSummary(people: PersonInfo[]): string {
    const homeCount = people.filter(p => p.home).length;
    if (people.length === 1) return people[0].location;
    if (homeCount > 0) return `${homeCount} ${localize('people.home')}`;
    return localize('people.nobody_home');
  }

  private static getLocation(hass: any, state: string): string {
    if (state === 'home') return localize('people.home');
    if (state === 'not_home') return localize('people.away');
    if (state === 'unknown' || state === 'unavailable') return localize('people.unknown');
    // Any other state is the name of a zone the person is in
    const zone = Object.values(hass.states).find((s: any) =>
      s.entity_id.startsWith('zone.') && s.attributes?.friendly_name === state) as any;
    return zone?.attributes?.friendly_name || state;
  }

  async render(container: HTMLElement, hass: any): Promise<void> {
    const excluded = new Set(await this.customizationManager.getExcludedFromDashboard());
    const people = PeopleSection.getPeople(hass, excluded);
    if (people.length === 0) return;

    this.injectStyles(container);

    const addGroup = (title: string, items: PersonInfo[]) => {
      if (items.length === 0) return;
      const heading = document.createElement('div');
      heading.className = 'apple-home-section-title';
      heading.textContent = `${title} · ${items.length}`;
      container.appendChild(heading);

      const grid = document.createElement('div');
      grid.className = 'apple-people-grid';
      items.forEach(p => grid.appendChild(this.createCard(p)));
      container.appendChild(grid);
    };

    addGroup(localize('people.home_group'), people.filter(p => p.home));
    addGroup(localize('people.away_group'), people.filter(p => !p.home));
  }

  private createCard(person: PersonInfo): HTMLElement {
    const card = document.createElement('div');
    card.className = `apple-person-card ${person.home ? 'home' : 'away'}`;

    const avatar = document.createElement('div');
    avatar.className = 'person-avatar';
    if (person.picture) {
      const img = document.createElement('img');
      img.src = person.picture;
      img.alt = '';
      img.addEventListener('error', () => {
        img.remove();
        avatar.textContent = PeopleSection.initials(person.name);
      });
      avatar.appendChild(img);
    } else {
      avatar.textContent = PeopleSection.initials(person.name);
    }

    const info = document.createElement('div');
    info.className = 'person-info';
    const name = document.createElement('span');
    name.className = 'person-name';
    // Set via textContent so entity names are never parsed as markup
    name.textContent = person.name;
    const location = document.createElement('span');
    location.className = 'person-location';
    const since = PeopleSection.formatSince(person.lastChanged);
    location.textContent = since ? `${person.location} · ${since}` : person.location;
    info.append(name, location);

    card.append(avatar, info);
    card.addEventListener('click', () => {
      card.dispatchEvent(new CustomEvent('hass-more-info', {
        detail: { entityId: person.entityId }, bubbles: true, composed: true
      }));
    });
    return card;
  }

  private static initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || '?').slice(0, 2);
    return letters.toUpperCase();
  }

  /** "since 3 h" style hint; empty when the timestamp is missing or invalid */
  private static formatSince(iso?: string): string {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    if (isNaN(ms) || ms < 0) return '';
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1) return localize('people.now');
    if (minutes < 60) return `${minutes} ${localize('people.min')}`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} ${localize('people.hours')}`;
    return `${Math.floor(hours / 24)} ${localize('people.days')}`;
  }

  private injectStyles(container: HTMLElement): void {
    const shadowRoot = container.getRootNode() as ShadowRoot;
    if (!shadowRoot || !(shadowRoot instanceof ShadowRoot)) return;
    if (shadowRoot.querySelector('#apple-people-section-styles')) return;

    const style = document.createElement('style');
    style.id = 'apple-people-section-styles';
    style.textContent = `
      .apple-people-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 12px;
        margin-top: 6px;
        width: 100%;
        box-sizing: border-box;
      }
      .apple-person-card {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 14px 18px;
        border-radius: var(--apple-card-radius, 22px);
        color: white;
        cursor: pointer;
        background: var(--apple-card-bg-inactive, rgba(0, 0, 0, 0.3));
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-sizing: border-box;
        min-width: 0;
        font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif;
      }
      .apple-person-card.home {
        background: var(--apple-card-bg-active, rgba(255, 255, 255, 0.9));
        color: #1c1c1e;
      }
      .person-avatar {
        flex: 0 0 auto;
        width: 46px;
        height: 46px;
        border-radius: 50%;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 17px;
        font-weight: 600;
        background: rgba(255, 255, 255, 0.18);
      }
      .apple-person-card.home .person-avatar { background: rgba(0, 0, 0, 0.1); }
      .apple-person-card.away .person-avatar { opacity: 0.85; }
      .person-avatar img { width: 100%; height: 100%; object-fit: cover; }
      .person-info { display: flex; flex-direction: column; min-width: 0; }
      .person-name {
        font-size: 16px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .person-location {
        font-size: 13px;
        opacity: 0.7;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    `;
    shadowRoot.appendChild(style);
  }
}
