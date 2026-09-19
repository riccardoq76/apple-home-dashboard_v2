import { CustomizationManager } from '../utils/CustomizationManager';
import { localize } from '../utils/LocalizationService';

export interface BatteryInfo {
  entityId: string;
  name: string;
  /** Battery percentage, or null for binary "battery low" sensors */
  level: number | null;
  low: boolean;
}

const BATTERY_NAME_SUFFIX = /[\s_-]*(battery|batteria|batterie|batterij|batería|bateria|akku|батарея|电池|סוללה)(\s+(level|low|livello|niveau|nivel|nível|stand))?$/i;
const MAX_HOME_ROWS = 4;

export class BatterySection {
  private customizationManager: CustomizationManager;

  constructor(customizationManager: CustomizationManager) {
    this.customizationManager = customizationManager;
  }

  /**
   * Collect battery levels from `sensor` (numeric %) and `binary_sensor` (on = low) entities
   * with device_class battery. Diagnostic entities are included on purpose: batteries are
   * diagnostic by default in most integrations. Sorted with the emptiest first.
   */
  static getBatteries(hass: any, threshold: number): BatteryInfo[] {
    const result: BatteryInfo[] = [];
    if (!hass?.states) return result;

    for (const entityId of Object.keys(hass.states)) {
      const domain = entityId.split('.')[0];
      if (domain !== 'sensor' && domain !== 'binary_sensor') continue;

      const state = hass.states[entityId];
      if (state?.attributes?.device_class !== 'battery') continue;

      const registry = hass.entities?.[entityId];
      if (registry && (registry.hidden_by || registry.disabled_by)) continue;

      const rawName: string = state.attributes.friendly_name || entityId;
      const name = rawName.replace(BATTERY_NAME_SUFFIX, '').trim() || rawName;

      if (domain === 'binary_sensor') {
        if (state.state !== 'on' && state.state !== 'off') continue;
        result.push({ entityId, name, level: null, low: state.state === 'on' });
      } else {
        const level = parseFloat(state.state);
        if (isNaN(level)) continue;
        result.push({ entityId, name, level, low: level <= threshold });
      }
    }

    // Binary "low" sensors carry no percentage: rank them as empty
    const rank = (b: BatteryInfo) => (b.level === null ? (b.low ? -1 : 101) : b.level);
    return result.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }

  static hasBatteries(hass: any): boolean {
    return BatterySection.getBatteries(hass, 0).length > 0;
  }

  async render(container: HTMLElement, hass: any, context: 'home' | 'page' = 'home'): Promise<void> {
    const threshold = await this.customizationManager.getBatteryThreshold();
    const batteries = BatterySection.getBatteries(hass, threshold);
    if (batteries.length === 0) return;

    this.injectStyles(container);

    if (context === 'page') {
      this.renderPage(container, batteries);
    } else {
      this.renderHomeCard(container, batteries);
    }
  }

  private renderHomeCard(container: HTMLElement, batteries: BatteryInfo[]): void {
    const lowBatteries = batteries.filter(b => b.low);

    const card = document.createElement('div');
    card.className = 'apple-battery-card';

    const header = document.createElement('div');
    header.className = 'battery-header';
    const headerIcon = lowBatteries.length > 0 ? 'mdi:battery-alert-variant-outline' : 'mdi:battery-check-outline';
    header.innerHTML = `
      <div class="battery-header-left">
        <ha-icon icon="${headerIcon}" class="battery-header-icon ${lowBatteries.length > 0 ? 'low' : 'ok'}"></ha-icon>
        <span class="battery-label">${localize('section_titles.batteries')}</span>
      </div>
      <span class="battery-summary">${lowBatteries.length > 0
        ? `${lowBatteries.length} ${localize('batteries.low')}`
        : localize('batteries.all_ok')}</span>`;
    card.appendChild(header);

    const rows = document.createElement('div');
    rows.className = 'battery-rows';
    lowBatteries.slice(0, MAX_HOME_ROWS).forEach(b => rows.appendChild(this.createRow(b)));
    if (lowBatteries.length > MAX_HOME_ROWS) {
      const more = document.createElement('div');
      more.className = 'battery-more';
      more.textContent = `+${lowBatteries.length - MAX_HOME_ROWS}`;
      rows.appendChild(more);
    }
    if (lowBatteries.length > 0) card.appendChild(rows);

    container.appendChild(card);
  }

  private renderPage(container: HTMLElement, batteries: BatteryInfo[]): void {
    const lowBatteries = batteries.filter(b => b.low);
    const okBatteries = batteries.filter(b => !b.low);

    const addGroup = (title: string, items: BatteryInfo[]) => {
      if (items.length === 0) return;
      const heading = document.createElement('div');
      heading.className = 'apple-home-section-title';
      heading.textContent = `${title} · ${items.length}`;
      container.appendChild(heading);

      const list = document.createElement('div');
      list.className = 'apple-battery-card battery-page-list';
      const rows = document.createElement('div');
      rows.className = 'battery-rows';
      items.forEach(b => rows.appendChild(this.createRow(b, true)));
      list.appendChild(rows);
      container.appendChild(list);
    };

    addGroup(localize('batteries.low_group'), lowBatteries);
    addGroup(localize('batteries.ok_group'), okBatteries);
  }

  private createRow(battery: BatteryInfo, openMoreInfo = false): HTMLElement {
    const row = document.createElement('div');
    row.className = `battery-row ${battery.low ? 'low' : 'ok'}`;

    const percent = battery.level === null ? (battery.low ? 5 : 100) : Math.max(0, Math.min(100, battery.level));
    const valueText = battery.level === null
      ? localize(battery.low ? 'batteries.low_short' : 'batteries.ok_short')
      : `${Math.round(battery.level)}%`;
    const icon = battery.low ? 'mdi:battery-alert-variant-outline' : 'mdi:battery-high';

    row.innerHTML = `
      <ha-icon icon="${icon}" class="battery-row-icon"></ha-icon>
      <span class="battery-row-name"></span>
      <div class="battery-bar"><div class="battery-bar-fill" style="width:${percent}%"></div></div>
      <span class="battery-row-value">${valueText}</span>`;
    // Set via textContent so entity names are never parsed as markup
    row.querySelector('.battery-row-name')!.textContent = battery.name;

    if (openMoreInfo) {
      row.addEventListener('click', () => {
        row.dispatchEvent(new CustomEvent('hass-more-info', {
          detail: { entityId: battery.entityId }, bubbles: true, composed: true
        }));
      });
    }
    return row;
  }

  private injectStyles(container: HTMLElement): void {
    const shadowRoot = container.getRootNode() as ShadowRoot;
    if (!shadowRoot || !(shadowRoot instanceof ShadowRoot)) return;
    if (shadowRoot.querySelector('#apple-battery-section-styles')) return;

    const style = document.createElement('style');
    style.id = 'apple-battery-section-styles';
    style.textContent = `
      .apple-battery-card {
        border-radius: var(--apple-card-radius, 22px);
        padding: 16px 20px;
        margin-top: 20px;
        color: white;
        position: relative;
        overflow: hidden;
        background: var(--apple-card-bg-inactive, rgba(0, 0, 0, 0.3));
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.08);
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
        font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif;
      }
      .apple-battery-card.battery-page-list { margin-top: 6px; }

      .battery-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
      }
      .battery-header-left { display: flex; align-items: center; gap: 8px; }
      .battery-header-icon { --mdc-icon-size: 22px; }
      .battery-header-icon.low, .battery-row.low .battery-row-icon { color: #FF9F0A; }
      .battery-header-icon.ok, .battery-row.ok .battery-row-icon { color: #30D158; }
      .battery-label { font-size: 15px; font-weight: 600; }
      .battery-summary { font-size: 14px; font-weight: 500; color: rgba(255, 255, 255, 0.7); }

      .battery-rows { display: flex; flex-direction: column; }
      .apple-battery-card:not(.battery-page-list) .battery-rows { margin-top: 10px; }
      .battery-row {
        display: grid;
        grid-template-columns: 24px minmax(0, 1fr) minmax(56px, 90px) 44px;
        align-items: center;
        gap: 12px;
        padding: 9px 0;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
      }
      .battery-page-list .battery-row { cursor: pointer; }
      .battery-row:first-child { border-top: none; }
      .battery-row-icon { --mdc-icon-size: 20px; }
      .battery-row-name {
        font-size: 15px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .battery-bar {
        height: 6px;
        border-radius: 3px;
        background: rgba(255, 255, 255, 0.15);
        overflow: hidden;
      }
      .battery-bar-fill { height: 100%; border-radius: 3px; }
      .battery-row.low .battery-bar-fill { background: #FF9F0A; }
      .battery-row.ok .battery-bar-fill { background: #30D158; }
      .battery-row-value {
        font-size: 14px;
        font-weight: 500;
        text-align: end;
        color: rgba(255, 255, 255, 0.75);
        font-variant-numeric: tabular-nums;
      }
      .battery-more {
        padding: 8px 0 0;
        font-size: 13px;
        color: rgba(255, 255, 255, 0.55);
      }
    `;
    shadowRoot.appendChild(style);
  }
}
