import { CustomizationManager } from '../utils/CustomizationManager';
import { DataService } from '../utils/DataService';
import { DashboardConfig } from '../config/DashboardConfig';
import { Entity } from '../types/types';
import { DragAndDropManager } from '../utils/DragAndDropManager';
import { localize } from '../utils/LocalizationService';

export class CamerasPage {
  private _container?: HTMLElement;
  private customizationManager?: CustomizationManager;
  private dragAndDropManager?: DragAndDropManager;
  private _hass?: any;
  private _config?: any;

  constructor() {
    // Regular class constructor
  }

  set hass(hass: any) {
    this._hass = hass;
  }

  async setConfig(config: any) {
    this._config = config;

    // Initialize customization manager from config
    if (config.customizations && this._hass) {
      this.customizationManager = CustomizationManager.getInstance(this._hass);
      await this.customizationManager.setCustomizations(config.customizations);

      // Initialize drag and drop manager with cameras context
      this.dragAndDropManager = new DragAndDropManager(
        (areaId) => this.handleSaveCurrentOrder(areaId),
        this.customizationManager,
        'cameras' // Use cameras context for cameras page
      );
    }
  }

  private createCamerasTitle(): HTMLElement {
    const titleElement = document.createElement('h1');
    titleElement.className = 'apple-page-title';
    titleElement.textContent = localize('pages.cameras');
    return titleElement;
  }

  async render(
    container: HTMLElement,
    hass: any,
    onTallToggle?: (entityId: string, areaId: string) => void | Promise<void | boolean>
  ): Promise<void> {
    // Store the container reference
    this._container = container;

    // Remove only dynamic content, keep permanent elements (header, chips) in place
    const permanentSelectors = ['.apple-home-header', '.permanent-chips'];
    Array.from(container.children).forEach((child) => {
      const isPermanent = permanentSelectors.some((sel) => child.matches(sel));
      if (!isPermanent) child.remove();
    });

    // Add cameras title after header but before chips
    const camerasTitle = this.createCamerasTitle();
    const existingPermanentChips = container.querySelector('.permanent-chips');
    if (existingPermanentChips) {
      container.insertBefore(camerasTitle, existingPermanentChips);
    } else {
      container.appendChild(camerasTitle);
    }

    try {
      // Get data from Home Assistant
      const entities = await DataService.getEntities(hass);

      // Filter entities for cameras and exclude those marked for exclusion
      const allCamerasEntities = entities.filter((entity) => {
        const domain = entity.entity_id.split('.')[0];
        return DashboardConfig.isCamerasDomain(domain);
      });

      // Now apply exclusions asynchronously
      const camerasEntities = [];
      for (const entity of allCamerasEntities) {
        const isExcluded = (await this.customizationManager?.isEntityExcludedFromDashboard(entity.entity_id)) || false;
        if (!isExcluded) {
          camerasEntities.push(entity);
        }
      }

      // Apply user customizations
      if (!this.customizationManager) {
        throw new Error(localize('errors.customization_manager_not_initialized'));
      }

      const customizations = this.customizationManager.getCustomizations();

      // Apply entity order customizations with context
      let sortedCameras = [...camerasEntities];
      const savedOrder = this.customizationManager.getSavedCardOrderWithContext('cameras_section', 'cameras');

      if (savedOrder.length > 0) {
        const entityMap = new Map(camerasEntities.map((entity) => [entity.entity_id, entity]));
        const orderedCameras: Entity[] = [];

        // First, add cameras in the saved order
        savedOrder.forEach((entityId: string) => {
          if (entityMap.has(entityId)) {
            orderedCameras.push(entityMap.get(entityId)!);
            entityMap.delete(entityId);
          }
        });

        // Then, add any new cameras that weren't in the saved order
        const remainingCameras = Array.from(entityMap.values());
        orderedCameras.push(...remainingCameras);

        sortedCameras = orderedCameras;
      }

      // Apply tall card settings - cameras are handled by CardManager
      sortedCameras.forEach((entity) => {
        // CardManager handles tall card settings in the new structure
        (entity as any).is_tall = true; // Default for cameras
      });

      // Render all cameras in a grid layout (non-carousel)
      await this.renderCamerasGrid(container, sortedCameras, hass, onTallToggle);
    } catch (error) {
      console.error('Error rendering cameras page:', error);
    }
  }

  private async renderCamerasGrid(
    container: HTMLElement,
    camerasEntities: Entity[],
    hass: any,
    onTallToggle?: (entityId: string, areaId: string) => void | Promise<void | boolean>
  ): Promise<void> {
    if (!this.customizationManager) {
      throw new Error(localize('errors.customization_manager_not_initialized'));
    }

    // Create a grid container for all cameras
    const gridContainer = document.createElement('div');
    gridContainer.className = 'cameras-grid';
    gridContainer.dataset.areaId = 'cameras_section';
    gridContainer.dataset.sectionType = 'cameras';

    // Create camera cards
    for (const entity of camerasEntities) {
      const cardConfig = this.createEntityCard(entity.entity_id, hass, entity);
      if (cardConfig) {
        cardConfig.section_type = 'cameras';
        await this.createAndAppendCard(cardConfig, gridContainer, hass, onTallToggle);
      }
    }

    container.appendChild(gridContainer);
  }

  private createEntityCard(entityId: string, hass: any, entity: Entity): any {
    if (!this.customizationManager) return null;

    const domain = entityId.split('.')[0];
    const stateObj = hass.states[entityId];

    if (!stateObj) return null;

    // Get user customizations for this entity (for individual entity overrides like names)
    const customizations = this.customizationManager.getCustomizations();
    const entityCustomizations = customizations.entities?.[entityId] || null;

    // Create base card configuration
    const cardConfig: any = {
      type: 'custom:apple-home-card',
      entity: entityId,
      name: entityCustomizations?.name || stateObj.attributes.friendly_name || entityId,
      area_id: 'cameras_section',
      is_tall: (entity as any).is_tall !== undefined ? (entity as any).is_tall : true, // Cameras are tall by default
      camera_view: 'snapshot',
      refresh_interval: 10000, // 10 seconds
      ...entityCustomizations,
    };

    return cardConfig;
  }

  private async createAndAppendCard(
    cardConfig: any,
    gridContainer: HTMLElement,
    hass: any,
    onTallToggle?: (entityId: string, areaId: string) => void | Promise<void | boolean>
  ): Promise<void> {
    // Create wrapper div for the card
    const wrapper = document.createElement('div');
    wrapper.className = 'entity-card-wrapper';
    wrapper.dataset.entityId = cardConfig.entity;
    wrapper.dataset.areaId = 'cameras_section';

    // Apply tall class if needed
    if (cardConfig.is_tall) {
      wrapper.classList.add('tall');
    }

    // Create the card element
    const cardElement = document.createElement('apple-home-card') as any;
    cardElement.setConfig(cardConfig);
    cardElement.hass = hass;

    // Add edit mode controls - but no tall toggle for cameras
    const controls = document.createElement('div');
    controls.className = 'entity-controls';
    // Cameras don't have resize controls

    wrapper.appendChild(controls);
    wrapper.appendChild(cardElement);
    gridContainer.appendChild(wrapper);
  }

  public updateDragAndDrop(editMode: boolean, container: HTMLElement) {
    if (!this.dragAndDropManager) return;

    if (editMode) {
      // Add a small delay to ensure cards are fully rendered
      setTimeout(() => {
        this.dragAndDropManager!.enableDragAndDrop(container);
        // Update entity wrapper styles for edit mode
        const entityWrappers = container.querySelectorAll('.entity-card-wrapper');
        entityWrappers.forEach((wrapper) => {
          const element = wrapper as HTMLElement;
          element.classList.toggle('edit-mode', true);

          const appleHomeCard = element.querySelector('apple-home-card') as any;
          if (appleHomeCard && typeof appleHomeCard.refreshEditMode === 'function') {
            appleHomeCard.refreshEditMode();
          }
        });
      }, 100);
    } else {
      this.dragAndDropManager.disableDragAndDrop(container);
      // Update entity wrapper styles
      const entityWrappers = container.querySelectorAll('.entity-card-wrapper');
      entityWrappers.forEach((wrapper) => {
        const element = wrapper as HTMLElement;
        element.classList.toggle('edit-mode', false);

        const appleHomeCard = element.querySelector('apple-home-card') as any;
        if (appleHomeCard && typeof appleHomeCard.refreshEditMode === 'function') {
          appleHomeCard.refreshEditMode();
        }
      });
    }
  }

  private handleSaveCurrentOrder(areaId: string) {
    if (!this._container) {
      return;
    }

    // Look for the area container within the stored container
    const areaContainer = this._container.querySelector(`[data-area-id="${areaId}"]`);
    if (!areaContainer) {
      return;
    }

    const wrappers = areaContainer.querySelectorAll('.entity-card-wrapper:not(.drag-placeholder)');
    const entityOrder = Array.from(wrappers)
      .map((wrapper) => {
        const element = wrapper as HTMLElement;
        return element.dataset.entityId || '';
      })
      .filter((id) => id);

    // Save with 'cameras' context
    if (this.customizationManager) {
      this.customizationManager.saveCardOrderWithContext(areaId, entityOrder, 'cameras');
    }
  }
}
