import { localize } from '../utils/LocalizationService';

/**
 * Generic full page that shows a single section (used by Batteries and Calendar).
 * Keeps the header/chips containers in place and replaces the rest of the content.
 */
export class SectionPage {
  private _hass?: any;

  constructor(
    private titleKey: string,
    private renderSection: (container: HTMLElement, hass: any) => Promise<void>
  ) {}

  set hass(hass: any) {
    this._hass = hass;
  }

  async render(container: HTMLElement, hass: any): Promise<void> {
    this._hass = hass;

    const permanentSelectors = ['.apple-home-header', '.permanent-chips'];
    Array.from(container.children).forEach(child => {
      if (!permanentSelectors.some(sel => child.matches(sel))) child.remove();
    });

    const title = document.createElement('h1');
    title.className = 'apple-page-title';
    title.textContent = localize(this.titleKey);

    const permanentChips = container.querySelector('.permanent-chips');
    if (permanentChips) {
      container.insertBefore(title, permanentChips);
    } else {
      container.appendChild(title);
    }

    await this.renderSection(container, hass);
  }
}
