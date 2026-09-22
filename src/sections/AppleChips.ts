import { DashboardConfig, DeviceGroup } from '../config/DashboardConfig';
import { EntityState } from '../types/types';
import { localize } from '../utils/LocalizationService';
import { RTLHelper } from '../utils/RTLHelper';
import { EnergySection } from './EnergySection';
import { BatterySection } from './BatterySection';
import { PeopleSection } from './PeopleSection';
import { CalendarSection } from './CalendarSection';

export interface ChipConfig {
  group: DeviceGroup;
  enabled: boolean;
  show_when_zero?: boolean;
  navigation_path?: string;
}

export interface ChipsConfig {
  climate?: ChipConfig;
  lights?: ChipConfig;
  security?: ChipConfig;
  media?: ChipConfig;
  water?: ChipConfig;
  energy?: ChipConfig;
  battery?: ChipConfig;
  people?: ChipConfig;
  calendar?: ChipConfig;
}

export interface ChipData {
  group: DeviceGroup;
  icon: string;
  groupName: string;
  statusText: string;
  iconColor: string;
  backgroundColor: string;
  textColor: string;
  enabled: boolean;
  navigationPath?: string;
}

export class AppleChips {
  private config?: ChipsConfig;
  private _hass?: any;
  private chips: ChipData[] = [];
  private activeGroup?: DeviceGroup;
  private container?: HTMLElement;
  private lastRenderedHash?: string;
  private lastHassTimestamp?: number; // Track hass changes
  private editMode: boolean = false;
  private customizationManager?: any;
  private onRenderCallback?: () => void;
  private statusTextCache = new Map<string, string>(); // Cache for status text
  private showSwitches: boolean = false; // Cached value for showSwitches setting
  private includedSwitches: string[] = []; // Cached value for includedSwitches setting
  private calendarSection?: CalendarSection;
  private calendarEventCount: number | null = null; // Filled in asynchronously, see refreshCalendarEventCount
  private calendarCountFetchInFlight = false;

  constructor(container: HTMLElement, customizationManager?: any) {
    this.container = container;
    this.customizationManager = customizationManager;
    // Initialize showSwitches and includedSwitches settings
    this.updateSettings();
    if (this.customizationManager) {
      this.calendarSection = new CalendarSection(this.customizationManager);
    }
  }

  /**
   * The chip's "N eventi" status text needs today's event count, which - unlike every other
   * chip - requires an actual API call (fetchEvents), not just a read of hass.states. Chip
   * generation itself stays synchronous (updateChipData), so this runs in the background and
   * re-renders once (and only once) a fresher count is known; CalendarSection's own 5-minute
   * cache keeps repeated calls here cheap.
   */
  private refreshCalendarEventCount(): void {
    if (!this.calendarSection || !this._hass || this.calendarCountFetchInFlight) return;
    this.calendarCountFetchInFlight = true;
    this.calendarSection.getTodayEventCount(this._hass)
      .then(count => {
        if (count !== this.calendarEventCount) {
          this.calendarEventCount = count;
          this.render();
        }
      })
      .catch(() => { /* keep the previous count on failure */ })
      .finally(() => { this.calendarCountFetchInFlight = false; });
  }

  private async updateSettings() {
    if (this.customizationManager) {
      this.showSwitches = await this.customizationManager.getShowSwitches() || false;
      this.includedSwitches = await this.customizationManager.getIncludedSwitches() || [];
    }
  }

  /**
   * Get hidden sections synchronously from customization manager
   * This ensures we always have the current value without async delay
   */
  private getHiddenSections(): string[] {
    if (!this.customizationManager) return [];
    return this.customizationManager.getHiddenSections() || [];
  }

  /**
   * Get the area ID for an entity, checking both entity registry and device registry
   */
  private getEntityAreaId(entityId: string): string | null {
    if (!this._hass) return null;
    
    // Check entity registry first
    const entityRegistry = this._hass.entities?.[entityId];
    if (entityRegistry?.area_id) {
      return entityRegistry.area_id;
    }
    
    // If entity doesn't have an area but has a device, check device's area
    if (entityRegistry?.device_id) {
      const device = this._hass.devices?.[entityRegistry.device_id];
      if (device?.area_id) {
        return device.area_id;
      }
    }
    
    // No area found - entity belongs to "no_area" (Default Room)
    return 'no_area';
  }

  /**
   * Check if an entity belongs to a hidden area/section
   */
  private isEntityInHiddenArea(entityId: string): boolean {
    const hiddenSections = this.getHiddenSections();
    if (hiddenSections.length === 0) return false;
    
    const areaId = this.getEntityAreaId(entityId);
    if (!areaId) return false;
    
    return hiddenSections.includes(areaId);
  }

  static getDefaultConfig(): ChipsConfig {
    return {
      climate: {
        group: DeviceGroup.CLIMATE,
        enabled: true,
        show_when_zero: true
      },
      lights: {
        group: DeviceGroup.LIGHTING,
        enabled: true,
        show_when_zero: true
      },
      security: {
        group: DeviceGroup.SECURITY,
        enabled: true,
        show_when_zero: true
      },
      media: {
        group: DeviceGroup.MEDIA,
        enabled: true,
        show_when_zero: true
      },
      water: {
        group: DeviceGroup.WATER,
        enabled: true,
        show_when_zero: false
      },
      energy: {
        group: DeviceGroup.ENERGY,
        enabled: true,
        show_when_zero: false
      },
      battery: {
        group: DeviceGroup.BATTERY,
        enabled: true,
        show_when_zero: false
      },
      people: {
        group: DeviceGroup.PEOPLE,
        enabled: true,
        show_when_zero: false
      },
      calendar: {
        group: DeviceGroup.CALENDAR,
        enabled: true,
        show_when_zero: false
      }
    };
  }

  setConfig(config: ChipsConfig) {
    // Merge with default config
    this.config = {
      ...AppleChips.getDefaultConfig(),
      ...config
    };
    
    // Update settings in case they changed
    this.updateSettings();
    
    // Trigger render if we have hass
    if (this._hass) {
      this.render();
    }
  }

  set hass(hass: any) {
    // Prevent unnecessary re-renders by comparing relevant entity states
    if (hass && this._hass && this.hasRelevantEntityChanges(hass)) {
      this._hass = hass;

      // Render when hass is set and there are relevant changes
      if (this.config) {
        this.render();
      }
    } else if (!this._hass) {
      // First time setting hass
      this._hass = hass;
      if (this.config) {
        this.render();
      }
    } else {
      // Update hass reference but don't re-render
      this._hass = hass;
    }
  }

  private static readonly RELEVANT_DOMAINS = new Set(['light', 'switch', 'climate', 'alarm_control_panel', 'lock', 'media_player', 'water_heater', 'cover', 'person']);
  private static readonly OPENING_DEVICE_CLASSES = new Set(['door', 'window', 'opening', 'garage_door']);

  /** True for door/window/opening sensors and garage doors/gates that are currently open. */
  private static isOpenOpening(entity: EntityState): boolean {
    const domain = entity.entity_id.split('.')[0];
    if (domain === 'binary_sensor') {
      return AppleChips.OPENING_DEVICE_CLASSES.has(entity.attributes?.device_class as string) && entity.state === 'on';
    }
    if (domain === 'cover') {
      return DashboardConfig.isGarageDoorOrGate(entity.entity_id, entity.attributes) &&
        (entity.state === 'open' || entity.state === 'opening' || entity.state === 'closing');
    }
    return false;
  }
  private static readonly WATER_KEYWORDS = ['water', 'leak', 'flood'];

  private hasRelevantEntityChanges(newHass: any): boolean {
    if (!this._hass || !this.config) return true;

    // Only check entities whose domain is relevant, skipping the rest
    for (const entityId of Object.keys(newHass.states)) {
      const dotIdx = entityId.indexOf('.');
      const domain = entityId.substring(0, dotIdx);
      const isRelevantDomain = AppleChips.RELEVANT_DOMAINS.has(domain);

      if (!isRelevantDomain) {
        // Quick water keyword check only for non-relevant domains (binary_sensor, sensor)
        if (domain !== 'binary_sensor' && domain !== 'sensor') continue;
        const isWaterEntity = AppleChips.WATER_KEYWORDS.some(kw => entityId.includes(kw)) ||
                             newHass.states[entityId]?.attributes?.device_class === 'moisture';
        const isPowerEntity = domain === 'sensor' && newHass.states[entityId]?.attributes?.device_class === 'power';
        const deviceClass = newHass.states[entityId]?.attributes?.device_class;
        const isOpeningEntity = domain === 'binary_sensor' && AppleChips.OPENING_DEVICE_CLASSES.has(deviceClass);
        const isBatteryEntity = deviceClass === 'battery';
        if (!isWaterEntity && !isPowerEntity && !isOpeningEntity && !isBatteryEntity) continue;
      }

      const oldEntity = this._hass.states[entityId];
      const newEntity = newHass.states[entityId];

      if (!oldEntity || !newEntity) return true;
      if (oldEntity.state !== newEntity.state) return true;
      if ((domain === 'climate' || domain === 'water_heater') &&
          oldEntity.attributes?.current_temperature !== newEntity.attributes?.current_temperature) {
        return true;
      }
    }

    return false;
  }

  get hass() {
    return this._hass;
  }

  isConfigured(): boolean {
    return !!this.config;
  }

  getConfig(): ChipsConfig | undefined {
    return this.config;
  }

  getActiveGroup(): DeviceGroup | undefined {
    return this.activeGroup;
  }

  setActiveGroup(group: DeviceGroup | undefined) {
    this.activeGroup = group;
    if (this._hass && this.config) {
      this.render();
    }
  }

  setEditMode(editMode: boolean) {
    this.editMode = editMode;
    if (this._hass && this.config) {
      this.render();
    }
  }

  /** Re-render now, e.g. after the exclusion list changed (a state change is not needed to notice it). */
  refresh() {
    if (this._hass && this.config) {
      this.render();
    }
  }

  setOnRenderCallback(callback: () => void) {
    this.onRenderCallback = callback;
  }

  getEditMode(): boolean {
    return this.editMode;
  }

  applySavedChipsOrder(chips: ChipData[]): ChipData[] {
    if (!this.customizationManager) return chips;
    
    const savedOrder = this.customizationManager.getSavedChipsOrder();
    if (savedOrder.length === 0) return chips;
    
    // Create a map for quick lookup
    const chipMap = new Map();
    chips.forEach(chip => {
      chipMap.set(chip.group, chip);
    });

    // Build ordered array based on saved order
    const orderedChips: ChipData[] = [];
    const usedGroups = new Set();

    // First, add chips in the saved order
    savedOrder.forEach((group: string) => {
      if (chipMap.has(group)) {
        orderedChips.push(chipMap.get(group));
        usedGroups.add(group);
      }
    });

    // Then, add any chips that weren't in the saved order (new groups)
    chips.forEach(chip => {
      if (!usedGroups.has(chip.group)) {
        orderedChips.push(chip);
      }
    });

    return orderedChips;
  }

  private render() {
    if (!this._hass || !this.config || !this.container) {
      return;
    }

    this.updateChipData();
    this.refreshCalendarEventCount();

    // Only render if we have chips to show
    if (this.chips.length === 0) {
      this.container.innerHTML = '';
      this.lastRenderedHash = '';
      return;
    }

    // Create a hash of current state to prevent unnecessary re-renders
    const currentHash = JSON.stringify({
      chips: this.chips.map(c => ({ group: c.group, statusText: c.statusText })),
      activeGroup: this.activeGroup,
      editMode: this.editMode
    });

    if (this.lastRenderedHash === currentHash) {
      // No changes in chip data, skip render
      return;
    }

    const html = this.generateHTML();
    
    this.container.innerHTML = html;
    this.attachEventListeners();
    this.lastRenderedHash = currentHash;
    
    // Call the render callback if it exists
    if (this.onRenderCallback) {
      this.onRenderCallback();
    }
  }

  private updateChipData() {
    if (!this._hass || !this.config) return;

    this.chips = [];
    // Entities the user excluded from the dashboard in Home Settings must not be counted either
    const home = this.customizationManager?.getCustomization('home') || {};
    const excludedFromDashboard = new Set<string>(home.excluded_from_dashboard || []);
    // Filter out excluded, hidden, disabled, config/diagnostic entities, and entities from hidden areas
    const allEntities = Object.values(this._hass.states).filter((entity: any) => {
      if (excludedFromDashboard.has(entity.entity_id)) return false;
      const entityRegistry = this._hass.entities?.[entity.entity_id];
      if (entityRegistry) {
        // hass.entities is the display registry: `hidden` here, `hidden_by` only in the full registry
        if (entityRegistry.hidden || entityRegistry.hidden_by || entityRegistry.disabled_by) return false;
        // Exclude configuration and diagnostic entities from chip calculations
        if (entityRegistry.entity_category === 'config' || entityRegistry.entity_category === 'diagnostic') return false;
      }
      // Filter out entities from hidden areas/rooms
      if (this.isEntityInHiddenArea(entity.entity_id)) {
        return false;
      }
      return true;
    }) as EntityState[];

    // For each device group, check if there are entities and create chips accordingly
    const deviceGroups = [
      { group: DeviceGroup.CLIMATE, config: this.config.climate },
      { group: DeviceGroup.LIGHTING, config: this.config.lights },
      { group: DeviceGroup.SECURITY, config: this.config.security },
      { group: DeviceGroup.MEDIA, config: this.config.media },
      { group: DeviceGroup.WATER, config: this.config.water },
      { group: DeviceGroup.ENERGY, config: this.config.energy },
      { group: DeviceGroup.BATTERY, config: this.config.battery },
      { group: DeviceGroup.PEOPLE, config: this.config.people },
      { group: DeviceGroup.CALENDAR, config: this.config.calendar }
    ];

    for (const { group, config } of deviceGroups) {
      if (!config?.enabled) continue;

      // Find entities that belong to this group based on domain mapping
      const groupEntities = allEntities.filter(entity => {
        const domain = entity.entity_id.split('.')[0];
        const entityState = this.hass?.states[entity.entity_id];
        
        // Special handling for switches
        if (domain === 'switch') {
          if (this.showSwitches) {
            const entityGroup = DashboardConfig.getDeviceGroup(domain, entity.entity_id, entityState?.attributes, this.showSwitches);
            return entityGroup === group;
          } else {
            // If showSwitches is false, only include outlets or included switches
            const isOutlet = DashboardConfig.isOutlet(entity.entity_id, entityState?.attributes);
            const isIncluded = this.includedSwitches.includes(entity.entity_id);
            if (isOutlet || isIncluded) {
              const entityGroup = DashboardConfig.getDeviceGroup(domain, entity.entity_id, entityState?.attributes, true); // Force true to get proper group
              return entityGroup === group;
            }
            return false;
          }
        } else {
          const entityGroup = DashboardConfig.getDeviceGroup(domain, entity.entity_id, entityState?.attributes, this.showSwitches);
          return entityGroup === group;
        }
      });

      // Special handling for water group: catches entities named after water/leak/flood that
      // getDeviceGroup wouldn't otherwise route to Water (e.g. a sensor without device_class 'moisture').
      // Moisture binary_sensors are already routed to Water by getDeviceGroup, so they're excluded here to avoid double-counting.
      if (group === DeviceGroup.WATER) {
        const existingIds = new Set(groupEntities.map(e => e.entity_id));
        const waterEntities = allEntities.filter(entity =>
          !existingIds.has(entity.entity_id) && (
            entity.entity_id.includes('water') ||
            entity.entity_id.includes('leak') ||
            entity.entity_id.includes('flood') ||
            entity.attributes.device_class === 'moisture'
          )
        );
        groupEntities.push(...waterEntities);
      }

      // Special handling for energy group - detect energy/power sensors
      let shouldShow = groupEntities.length > 0;
      if (group === DeviceGroup.ENERGY) {
        shouldShow = EnergySection.hasEnergySensors(this._hass);
      }

      // Battery chip: shown whenever battery entities exist (like the Energy chip); the Home card is opt-in via settings
      let batteryStatusText: string | undefined;
      if (group === DeviceGroup.BATTERY) {
        const threshold = typeof home.battery_threshold === 'number' ? home.battery_threshold : 20;
        const batteries = BatterySection.getBatteries(this._hass, threshold, excludedFromDashboard);
        shouldShow = batteries.length > 0;
        const lowCount = batteries.filter(b => b.low).length;
        // Computed here rather than in getGroupStatusText: that cache is keyed on group entities, which this group has none of
        batteryStatusText = lowCount > 0 ? `${lowCount} ${localize('batteries.low')}` : localize('batteries.ok_short');
      }
      
      // People chip: shown whenever person entities exist; like Battery, none of the group's entities come from the domain mapping
      let peopleStatusText: string | undefined;
      if (group === DeviceGroup.PEOPLE) {
        const people = PeopleSection.getPeople(this._hass, excludedFromDashboard);
        shouldShow = people.length > 0;
        peopleStatusText = PeopleSection.getSummary(people);
      }

      // Calendar chip: shown whenever a selected calendar still exists; the event count itself
      // needs an API call, so it's filled in asynchronously (see refreshCalendarEventCount) and
      // read here from the last known value, defaulting to "no events" until the first fetch lands
      let calendarStatusText: string | undefined;
      if (group === DeviceGroup.CALENDAR) {
        const calendarIds: string[] = Array.isArray(home.calendar_entities) ? home.calendar_entities : [];
        shouldShow = calendarIds.some(id => !!this._hass.states[id]);
        const count = this.calendarEventCount ?? 0;
        calendarStatusText = count > 0
          ? `${count} ${localize('calendar.chip_events')}`
          : localize('calendar.chip_no_events');
      }

      if (shouldShow) {
        const groupStyle = DashboardConfig.getGroupStyle(group);
        let statusText = batteryStatusText ?? peopleStatusText ?? calendarStatusText ?? this.getGroupStatusText(group, groupEntities);
        
        // Get inactive background color from DashboardConfig
        const inactiveStyle = DashboardConfig.getEntityData(
          { entity_id: 'light.dummy', state: 'off', attributes: {} } as EntityState, 
          'light', // Use light domain to get inactive styling
          false
        );
        
        this.chips.push({
          group: group,
          icon: groupStyle.icon,
          groupName: typeof groupStyle.name === 'function' ? groupStyle.name() : groupStyle.name,
          statusText: statusText,
          iconColor: groupStyle.iconColor, // Always use base iconColor for chips, active state handled in HTML/CSS
          backgroundColor: inactiveStyle.backgroundColor,
          textColor: '#ffffff',
          enabled: config.enabled,
          navigationPath: config.navigation_path || group // Store just the group name, not absolute path
        });
      }
    }

    // Apply saved chip order
    this.chips = this.applySavedChipsOrder(this.chips);
  }

  private generateHTML(): string {
    // Get the media group's active icon color from DashboardConfig
    const mediaGroupStyle = DashboardConfig.getGroupStyle(DeviceGroup.MEDIA);
    const mediaActiveIconColor = mediaGroupStyle.activeIconColor || mediaGroupStyle.iconColor;
    
    return `
      <style>
        :host {
          --media-active-icon-color: ${mediaActiveIconColor};
          --chip-background-color: var(--apple-chip-bg-inactive, rgba(56, 56, 56, 0.46));
        }
        
        /* Match StatusSection structure exactly */
        .apple-chips-section {
          display: block;
          margin-top: 8px;
          width: 100%;
        }

        /* Use identical structure as status-carousel-container */
        .chips-carousel-container {
          overflow-x: auto;
          overflow-y: hidden;
          margin-inline-start: calc(-1 * var(--apple-page-padding, 22px));
          margin-inline-end: calc(-1 * var(--apple-page-padding, 22px));
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        
        .chips-carousel-container::-webkit-scrollbar {
          display: none;
        }

        .chips-grid {
          display: inline-flex;
          gap: 10px;
          align-items: center;
          padding-inline-start: var(--apple-page-padding, 22px);
          padding-inline-end: var(--apple-page-padding, 22px);
          min-width: 100%;
          box-sizing: border-box;
          height: 44px;
        }
        
        /* RTL support */
        .chips-carousel-container.rtl {
          direction: rtl;
        }
        
        .chips-carousel-container.ltr {
          direction: ltr;
        }

        /* Chip drag placeholder styling */

        .chip-wrapper {
          flex-shrink: 0;
          position: relative;
        }

        .chip-wrapper.edit-mode {
          animation: apple-home-shake 1.3s ease-in-out infinite;
          touch-action: none;
        }

        /* Drag placeholder for chip wrappers */
        .chip-wrapper.drag-placeholder {
          background: transparent !important;
          border: none !important;
          opacity: 1;
          pointer-events: none;
          /* Keep the same size as the original chip to maintain layout */
          display: flex;
          align-items: center;
          min-height: var(--apple-chip-height, 32px);
        }

        .chip {
          display: flex;
          align-items: center;
          gap: var(--apple-chip-gap, 6px);
          padding: var(--apple-chip-padding, 3px 16px 3px 8px);
          border-radius: 50px;
          background: var(--chip-background-color);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          color: white;
          font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif;
          cursor: pointer;
          transition: background-color 0.2s ease, opacity 0.2s ease;
          user-select: none;
          -webkit-user-select: none;
          -webkit-tap-highlight-color: transparent;
          min-height: var(--apple-chip-height, 32px);
          white-space: nowrap;
          position: relative; /* Ensure proper positioning during drag */
        }

        /* RTL chips - swap left/right padding */
        .chips-carousel-container.rtl .chip {
          padding: 3px 8px 3px 16px;
        }

        /* Ensure chips maintain their position during drag operations */
        .chip-wrapper:not(.dragging) {
          transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .chip-wrapper.dragging {
          /* Dragging styles are applied via inline styles in DragAndDropManager */
          animation: none !important; /* Disable shake animation during drag */
        }

        .chip.active {
          background: var(--apple-chip-bg-active, rgba(255, 255, 255, 0.9)) !important;
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
        }

        .chip.active .chip-group-name {
          color: var(--apple-text-active, #1f1f1f) !important;
        }

        .chip.active .chip-status {
          color: rgba(31, 31, 31, 0.7) !important;
        }

        /* Active media chip icon color */
        .chip.active[data-group="media"] .chip-icon {
          color: var(--media-active-icon-color) !important;
        }

        .chip.active[data-group="media"] .chip-icon ha-icon {
          color: var(--media-active-icon-color) !important;
        }

        .chip-icon {
          width: var(--apple-chip-icon-size, 24px);
          height: var(--apple-chip-icon-size, 24px);
          display: flex;
          align-items: center;
          justify-content: center;
          align-self: center;
          color: var(--chip-icon-color);
          flex-shrink: 0;
        }

        .chip-icon ha-icon {
          width: var(--apple-chip-icon-size, 24px);
          height: var(--apple-chip-icon-size, 24px);
          --mdc-icon-size: var(--apple-chip-icon-size, 24px);
          color: var(--chip-icon-color);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .chip-content {
          display: flex;
          flex-direction: column;
          gap: 0px;
        }

        .chip-group-name {
          font-size: var(--apple-chip-name-size, 13px);
          font-weight: 600;
          color: white;
          line-height: 1.2;
          letter-spacing: -0.2px;
        }

        .chip-status {
          font-size: var(--apple-chip-status-size, 11px);
          font-weight: 500;
          color: rgba(255, 255, 255, 0.7);
          line-height: 1.2;
        }
        
        /* Responsive chip sizing - uses CSS variables from LiquidGlassStyles.ts */
        @media (max-width: 479px) {
          .chips-grid {
            gap: var(--apple-chip-gap, 8px);
          }
          
          .chip {
            padding: var(--apple-chip-padding, 4px 14px 4px 8px);
            min-height: var(--apple-chip-height, 32px);
          }
          
          .chip-icon {
            width: var(--apple-chip-icon-size, 20px);
            height: var(--apple-chip-icon-size, 20px);
          }
          
          .chip-icon ha-icon {
            width: var(--apple-chip-icon-size, 20px);
            height: var(--apple-chip-icon-size, 20px);
            --mdc-icon-size: var(--apple-chip-icon-size, 20px);
          }
          
          .chip-group-name {
            font-size: var(--apple-chip-name-size, 13px);
          }
          
          .chip-status {
            font-size: var(--apple-chip-status-size, 11px);
          }
        }
        
        /* Extra small screens */
        @media (max-width: 359px) {
          .chips-grid {
            gap: 6px;
          }
          
          .chip {
            padding: 3px 12px 3px 6px;
            min-height: 30px;
            gap: 6px;
          }
          
          .chip-icon {
            width: var(--apple-chip-icon-size, 18px);
            height: var(--apple-chip-icon-size, 18px);
          }
          
          .chip-icon ha-icon {
            width: var(--apple-chip-icon-size, 18px);
            height: var(--apple-chip-icon-size, 18px);
            --mdc-icon-size: var(--apple-chip-icon-size, 18px);
          }
          
          .chip-group-name {
            font-size: var(--apple-chip-name-size, 12px);
          }
          
          .chip-status {
            font-size: 10px;
          }
        }
        
        /* RTL chips on small screens */
        @media (max-width: 479px) {
          .chips-carousel-container.rtl .chip {
            padding: 4px 8px 4px 14px;
          }
        }
        
        @media (max-width: 359px) {
          .chips-carousel-container.rtl .chip {
            padding: 3px 6px 3px 12px;
          }
        }
        
        /* Reduce motion for accessibility */
        @media (prefers-reduced-motion: reduce) {
          .chip-wrapper.edit-mode {
            animation: none !important;
          }
          .chip, .chip-wrapper {
            transition: none !important;
          }
        }

        @keyframes apple-home-shake {
          0%, 100% { transform: translateX(0px) rotate(0deg); }
          10% { transform: translateX(-1px) rotate(-0.6deg); }
          20% { transform: translateX(1px) rotate(0.6deg); }
          30% { transform: translateX(-1px) rotate(-0.6deg); }
          40% { transform: translateX(1px) rotate(0.6deg); }
          50% { transform: translateX(-1px) rotate(-0.6deg); }
          60% { transform: translateX(1px) rotate(0.6deg); }
          70% { transform: translateX(-1px) rotate(-0.6deg); }
          80% { transform: translateX(1px) rotate(0.6deg); }
          90% { transform: translateX(-1px) rotate(-0.6deg); }
        }
      </style>
      <div class="apple-chips-section">
        <div class="chips-carousel-container ${RTLHelper.isRTL() ? 'rtl' : 'ltr'}">
          <div class="chips-grid" data-area-id="chips" data-section-type="chips">
            ${this.chips.map(chip => `
              <div class="chip-wrapper ${this.editMode ? 'edit-mode' : ''}" 
                   data-entity-id="${chip.group}" 
                   data-chip-id="${chip.group}">
                <div class="chip ${chip.group === this.activeGroup ? 'active' : ''}" 
                     data-group="${chip.group}" 
                     style="--chip-background-color: ${chip.backgroundColor}; --chip-icon-color: ${chip.iconColor};"
                     ${chip.navigationPath ? `data-navigation="${chip.navigationPath}"` : ''}>
                  <div class="chip-icon">
                    <ha-icon icon="${chip.icon}"></ha-icon>
                  </div>
                  <div class="chip-content">
                    <span class="chip-group-name">${chip.groupName}</span>
                    <span class="chip-status">${chip.statusText}</span>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  private attachEventListeners() {
    if (!this.container) return;
    
    // Add click handlers to chips (not chip wrappers)
    this.container.querySelectorAll('.chip').forEach((chip: any) => {
      chip.addEventListener('click', this.handleChipClick.bind(this));
    });
  }

  clearContainer() {
    if (this.container) {
      this.container.innerHTML = '';
      this.lastRenderedHash = '';
      this.statusTextCache.clear(); // Clear status text cache
    }
  }

  private handleChipClick(event: Event) {
    // Don't handle clicks in edit mode (for dragging)
    if (this.editMode) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const chip = event.currentTarget as HTMLElement;
    const group = chip.dataset.group as DeviceGroup;
    const navigationPath = chip.dataset.navigation;

    // Additional safety check - ensure we have valid navigation data
    if (!group && !navigationPath) {
      return;
    }

    // Check if this is the currently active chip - if so, return to home
    if (group === this.activeGroup) {
      this.navigateToHomePage();
      return;
    }

    // Determine the path to navigate to
    const targetPath = navigationPath || group;
    
    // Additional check to prevent navigation to invalid paths during load
    if (!targetPath || targetPath.trim() === '') {
      return;
    }

    // Navigate to the target path
    this.navigateToPath(targetPath);
  }

  private navigateToPath(path: string) {
    // Validate the path before attempting navigation
    if (!path || path.trim() === '') {
      return;
    }

    const currentPath = window.location.pathname;
    let basePath = '';
    
    // Handle different dashboard URL patterns
    if (currentPath.startsWith('/lovelace/')) {
      // Default lovelace dashboard: /lovelace/home -> /lovelace/
      basePath = '/lovelace/';
    } else if (currentPath === '/lovelace') {
      // Root lovelace: /lovelace -> /lovelace/
      basePath = '/lovelace/';
    } else {
      // Custom dashboard: /apple-home/home -> /apple-home/
      // Extract the dashboard name (first segment after root)
      const pathParts = currentPath.split('/').filter(part => part.length > 0);
      
      if (pathParts.length > 0) {
        basePath = `/${pathParts[0]}/`;
      } else {
        // Fallback - try to detect dashboard from current location
        basePath = '/lovelace/';
      }
    }
    
    // Clean path and construct full URL
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    const newUrl = `${basePath}${cleanPath}`;
    
    // Additional validation - ensure we're not navigating to a config path by mistake
    if (newUrl.includes('/config/') && !basePath.includes('/config/')) {
      return;
    }

    // Navigate using Home Assistant's system
    window.history.pushState(null, '', newUrl);
    const event = new Event('location-changed', { bubbles: true, composed: true });
    window.dispatchEvent(event);
  }

  private navigateToHomePage() {
    // Navigate to the home page 
    this.navigateToPath('home');
  }

  private getGroupStatusText(group: DeviceGroup, entities: EntityState[]): string {
    // Create a cache key based on entity states
    const cacheKey = `${group}:${entities.map(e => `${e.entity_id}:${e.state}:${e.attributes?.current_temperature || ''}`).join(';')}`;
    
    // Return cached result if available
    if (this.statusTextCache.has(cacheKey)) {
      return this.statusTextCache.get(cacheKey)!;
    }
    
    let statusText: string;
    
    switch (group) {
      case DeviceGroup.LIGHTING:
        const onLights = entities.filter(entity => entity.state === 'on');
        statusText = onLights.length > 0 ? `${onLights.length} ${localize('status.on')}` : localize('status.off');
        break;
        
      case DeviceGroup.CLIMATE:
        const climateEntities = entities.filter(entity => entity.entity_id.startsWith('climate.') || entity.entity_id.startsWith('water_heater.'));
        statusText = '--°';

        if (climateEntities.length > 0) {
          const temperatures = climateEntities
            .map(entity => entity.attributes.current_temperature)
            .filter(temp => temp !== undefined && temp !== null)
            .sort((a, b) => a - b);
          
          if (temperatures.length > 0) {
            const min = Math.round(temperatures[0]);
            const max = Math.round(temperatures[temperatures.length - 1]);
            statusText = temperatures.length === 1 ? `${min}°` : `${min}-${max}°`;
          }
        }
        break;
        
      case DeviceGroup.SECURITY:
        const alarmEntities = entities.filter(entity => entity.entity_id.startsWith('alarm_control_panel.'));
        const lockEntities = entities.filter(entity => entity.entity_id.startsWith('lock.'));
        
        const armed = alarmEntities.filter(entity => entity.state === 'armed_away' || entity.state === 'armed_home' || entity.state === 'armed_night' || entity.state === 'armed_vacation' || entity.state === 'armed_custom_bypass');
        const unlocked = lockEntities.filter(entity => entity.state === 'unlocked');
        const openings = entities.filter(entity => AppleChips.isOpenOpening(entity));

        const securityParts: string[] = [];
        if (armed.length > 0) securityParts.push(localize('status.armed'));
        if (openings.length > 0) securityParts.push(`${openings.length} ${localize('status.open')}`);
        if (unlocked.length > 0) securityParts.push(`${unlocked.length} ${localize('status.unlocked')}`);
        statusText = securityParts.length > 0 ? securityParts.join(', ') : localize('chip_status.secure');
        break;
        
      case DeviceGroup.MEDIA:
        const playingMedia = entities.filter(entity => entity.state === 'playing');
        const tvEntities = entities.filter(entity => 
          entity.attributes.device_class === 'tv' || 
          entity.entity_id.includes('tv') ||
          entity.attributes.source_list
        );
        const onTVs = tvEntities.filter(entity => entity.state === 'on');
        
        if (playingMedia.length > 0) {
          statusText = `${playingMedia.length} ${localize('status.playing')}`;
        } else if (onTVs.length > 0) {
          statusText = `${onTVs.length} ${onTVs.length > 1 ? localize('chip_status.tvs') : localize('chip_status.tv')} ${localize('status.on')}`;
        } else {
          statusText = localize('status.off');
        }
        break;
        
      case DeviceGroup.WATER:
        const activeWater = entities.filter(entity => entity.state === 'on' || entity.state === 'detected');
        statusText = activeWater.length > 0 ? `${activeWater.length} ${localize('chip_status.active')}` : localize('chip_status.all_inactive');
        break;

      case DeviceGroup.ENERGY:
        const totalPower = EnergySection.getTotalPower(this._hass);
        if (totalPower !== null) {
          statusText = totalPower >= 1000 ? `${(totalPower / 1000).toFixed(1)} kW` : `${Math.round(totalPower)} W`;
        } else {
          statusText = localize('energy.active');
        }
        break;

      default:
        statusText = localize('status.off');
        break;
    }
    
    // Cache the result and clear old cache entries (keep only last 20)
    if (this.statusTextCache.size > 20) {
      const firstKey = this.statusTextCache.keys().next().value;
      if (firstKey) {
        this.statusTextCache.delete(firstKey);
      }
    }
    this.statusTextCache.set(cacheKey, statusText);
    
    return statusText;
  }
}
