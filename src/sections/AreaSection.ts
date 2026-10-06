import { CustomizationManager } from '../utils/CustomizationManager';
import { CardManager } from '../utils/CardManager';
import { DataService } from '../utils/DataService';
import { Entity, CardConfig, Area } from '../types/types';
import { DashboardConfig } from '../config/DashboardConfig';
import { localize } from '../utils/LocalizationService';
import { RTLHelper } from '../utils/RTLHelper';

export class AreaSection {
  private customizationManager: CustomizationManager;
  private cardManager: CardManager;
  private _areasCache: Area[] | null = null;
  private _areasCacheHass: any = null;

  constructor(customizationManager: CustomizationManager, cardManager?: CardManager) {
    this.customizationManager = customizationManager;
    this.cardManager = cardManager || new CardManager(customizationManager);
  }

  // Cache areas per hass instance to avoid repeated WS calls within the same render cycle
  private async getCachedAreas(hass: any): Promise<Area[]> {
    if (this._areasCache && this._areasCacheHass === hass) {
      return this._areasCache;
    }
    this._areasCache = await DataService.getAreas(hass);
    this._areasCacheHass = hass;
    return this._areasCache;
  }

  async renderSingleArea(
    container: HTMLElement,
    areaId: string,
    areaEntities: Entity[],
    hass: any,
    onTallToggle?: (entityId: string, areaId: string) => void | Promise<void | boolean>,
    context: string = 'home',
    enableNavigation: boolean = true
  ): Promise<void> {
    if (areaEntities.length === 0) return;

    // Get area name (cached per render cycle)
    let areaName = areaId;
    if (areaId !== 'no_area') {
      try {
        const areas = await this.getCachedAreas(hass);
        const area = areas.find((a: Area) => a.area_id === areaId);
        areaName = area?.name || areaId;
      } catch (error) {
        // Silently handle error
      }
    } else {
      areaName = localize('section_titles.default_room');
    }

    // Add area title with conditional navigation
    const titleDiv = document.createElement('div');
    titleDiv.className = 'area-title';

    if (enableNavigation) {
      // Create clickable wrapper for just the title text and chevron
      const clickableWrapper = document.createElement('div');
      clickableWrapper.className = 'clickable-section-title';
      clickableWrapper.innerHTML = `<span>${areaName}</span><ha-icon icon="${RTLHelper.isRTL() ? 'mdi:chevron-left' : 'mdi:chevron-right'}" class="section-arrow"></ha-icon>`;

      // Add click handler to the wrapper
      clickableWrapper.addEventListener('click', () => {
        this.navigateToPath(`room-${areaId}`);
      });

      titleDiv.appendChild(clickableWrapper);
    } else {
      titleDiv.innerHTML = `<span>${areaName}</span>`;
    }

    container.appendChild(titleDiv);

    // Create area grid
    const gridDiv = document.createElement('div');
    gridDiv.className = 'area-entities';
    gridDiv.dataset.areaId = areaId;

    // Apply saved card order if available
    const savedOrder = this.customizationManager.getSavedCardOrderWithContext(areaId, context);
    let orderedCards = [...areaEntities];

    if (savedOrder && savedOrder.length > 0) {
      orderedCards = this.customizationManager.applySavedCardOrder(areaEntities, savedOrder);
    }

    // Create entity cards for this area
    for (const entity of orderedCards) {
      const cardConfig = this.createEntityCard(entity.entity_id, hass, areaName, entity);
      if (cardConfig) {
        await this.createAndAppendCard(cardConfig, gridDiv, hass, onTallToggle, context);
      }
    }

    container.appendChild(gridDiv);
  }

  private createEntityCard(entityId: string, hass: any, areaName?: string, entity?: Entity): CardConfig | null {
    const state = hass.states[entityId];
    if (!state) {
      return null;
    }

    let friendlyName = state?.attributes?.friendly_name || entityId.split('.')[1].replace(/_/g, ' ');
    const domain = entityId.split('.')[0];

    // Remove area name from entity name to avoid redundancy
    if (areaName && friendlyName.includes(areaName)) {
      const escaped = areaName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const cleanName = friendlyName
        .replace(new RegExp(`^${escaped}\\s+`, 'i'), '')
        .replace(new RegExp(`\\s+${escaped}$`, 'i'), '')
        .replace(new RegExp(`\\s+${escaped}\\s+`, 'i'), ' ')
        .trim();

      if (cleanName && cleanName.length > 0 && cleanName.toLowerCase() !== areaName.toLowerCase()) {
        friendlyName = cleanName;
      }
    }

    // Determine card type and properties
    let cardType = 'custom:apple-home-card';
    let isTallCard = false;

    // Check if domain should be tall by default
    if (DashboardConfig.isDefaultTallDomain(domain)) {
      isTallCard = true;
    }

    // Check if there's a custom tall card setting from customizations
    if (entity && typeof (entity as any).is_tall !== 'undefined') {
      isTallCard = (entity as any).is_tall;
    }

    const card: CardConfig = {
      type: cardType,
      entity: entityId,
      name: friendlyName,
      domain: domain,
      is_tall: isTallCard,
    };

    // Add default icon for scenes/scripts without icons
    if (DashboardConfig.isScenesDomain(domain) && !state.attributes?.icon) {
      (card as any).default_icon = 'mdi:home';
    }

    return card;
  }

  private async createAndAppendCard(
    cardConfig: any,
    container: HTMLElement,
    hass: any,
    onTallToggle?: (entityId: string, areaId: string) => void | Promise<void | boolean>,
    context: string = 'home'
  ): Promise<void> {
    try {
      let cardElement: HTMLElement;

      if (cardConfig.type === 'custom:apple-home-card') {
        cardElement = document.createElement('apple-home-card') as HTMLElement;

        // Determine if card should be tall based on customizations
        const shouldBeTall = this.cardManager.shouldCardBeTall(
          cardConfig.entity,
          container.dataset.areaId || 'unknown',
          context
        );
        const configWithTall = { ...cardConfig, is_tall: shouldBeTall };

        // Add default icon if specified
        if ((cardConfig as any).default_icon) {
          configWithTall.default_icon = (cardConfig as any).default_icon;
        }

        (cardElement as any).setConfig(configWithTall);
        (cardElement as any).hass = hass;
      } else {
        // Handle other card types
        const customCardType = cardConfig.type.replace('custom:', '');
        if (customElements.get(customCardType)) {
          cardElement = document.createElement(customCardType);
          if (cardElement && typeof (cardElement as any).setConfig === 'function') {
            (cardElement as any).setConfig(cardConfig);
            (cardElement as any).hass = hass;
          }
        } else {
          cardElement = document.createElement('div');
          cardElement.innerHTML = `<div style="color: red;">Unknown card type: ${cardConfig.type}</div>`;
        }
      }

      const wrapper = document.createElement('div');
      wrapper.className = 'entity-card-wrapper';
      wrapper.dataset.entityId = cardConfig.entity;

      // Determine if card should be tall based on customizations
      const shouldBeTall = this.cardManager.shouldCardBeTall(
        cardConfig.entity,
        container.dataset.areaId || 'unknown',
        context
      );

      if (shouldBeTall) {
        wrapper.classList.add('tall');
      }

      // Always add edit mode controls
      const controlsDiv = document.createElement('div');
      controlsDiv.className = 'entity-controls';

      let controlsHTML = '';

      // Get entity domain to check if it's a camera or scene
      const entityDomain = cardConfig.entity ? cardConfig.entity.split('.')[0] : '';
      const isFixedSizeEntity = ['camera', 'scene', 'script'].includes(entityDomain);

      // Only show tall toggle for regular entities (not cameras or scenes)
      if (!isFixedSizeEntity) {
        controlsHTML = `
          <button class="entity-control-btn tall-toggle ${shouldBeTall ? 'active' : ''}" 
                  data-action="toggle-tall" 
                  title="Toggle card design">
            <ha-icon icon="mdi:${shouldBeTall ? 'arrow-collapse' : 'arrow-expand'}"></ha-icon>
          </button>
        `;
      }

      controlsDiv.innerHTML = controlsHTML;

      // Add event listeners for controls
      const tallToggle = controlsDiv.querySelector('.tall-toggle') as HTMLButtonElement;
      if (tallToggle && onTallToggle) {
        tallToggle.addEventListener('click', (e) => {
          e.stopPropagation();
          onTallToggle(cardConfig.entity, container.dataset.areaId || 'unknown');
        });
      }

      wrapper.appendChild(controlsDiv);
      wrapper.appendChild(cardElement);
      container.appendChild(wrapper);
    } catch (error) {
      console.error('Error creating card:', error);
    }
  }

  private navigateToPath(path: string) {
    const currentPath = window.location.pathname;
    let basePath = '';

    // Handle different dashboard URL patterns
    if (currentPath.startsWith('/lovelace/')) {
      basePath = '/lovelace/';
    } else if (currentPath === '/lovelace') {
      basePath = '/lovelace/';
    } else {
      // Custom dashboard: extract the dashboard name
      const pathParts = currentPath.split('/').filter((part) => part.length > 0);
      if (pathParts.length > 0) {
        basePath = `/${pathParts[0]}/`;
      } else {
        basePath = '/lovelace/';
      }
    }

    // Clean path and construct full URL
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    const newUrl = `${basePath}${cleanPath}`;

    // Navigate using Home Assistant's system
    window.history.pushState(null, '', newUrl);
    const event = new Event('location-changed', { bubbles: true, composed: true });
    window.dispatchEvent(event);
  }
}
