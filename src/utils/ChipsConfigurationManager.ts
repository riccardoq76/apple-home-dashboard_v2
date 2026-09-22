import { DeviceGroup } from '../config/DashboardConfig';
import { ChipsConfig } from '../sections/AppleChips';
import { CustomizationManager } from './CustomizationManager';

export interface ChipsSettings {
  enabled: boolean;
  chips_config: ChipsConfig;
}

export class ChipsConfigurationManager {
  private static readonly DEFAULT_CHIPS_SETTINGS: ChipsSettings = {
    enabled: true,
    chips_config: {
      climate: {
        group: DeviceGroup.CLIMATE,
        enabled: true,
        show_when_zero: true
      },
      lights: {
        group: DeviceGroup.LIGHTING,
        enabled: true,
        show_when_zero: false
      },
      security: {
        group: DeviceGroup.SECURITY,
        enabled: true,
        show_when_zero: true
      },
      media: {
        group: DeviceGroup.MEDIA,
        enabled: true,
        show_when_zero: false,
      },
      water: {
        group: DeviceGroup.WATER,
        enabled: true,
        show_when_zero: false
      }
    }
  };

  /**
   * Get the default chips settings
   */
  static getDefaultSettings(): ChipsSettings {
    return JSON.parse(JSON.stringify(this.DEFAULT_CHIPS_SETTINGS));
  }

  /**
   * Merge user settings with defaults
   */
  static mergeWithDefaults(userSettings?: Partial<ChipsSettings>): ChipsSettings {
    if (!userSettings) {
      return this.getDefaultSettings();
    }

    const merged: ChipsSettings = {
      enabled: userSettings.enabled !== undefined ? userSettings.enabled : this.DEFAULT_CHIPS_SETTINGS.enabled,
      chips_config: {
        ...this.DEFAULT_CHIPS_SETTINGS.chips_config
      }
    };

    // Merge individual chip configurations
    if (userSettings.chips_config) {
      Object.keys(userSettings.chips_config).forEach(key => {
        const chipKey = key as keyof ChipsConfig;
        if (userSettings.chips_config![chipKey]) {
          merged.chips_config[chipKey] = {
            ...this.DEFAULT_CHIPS_SETTINGS.chips_config[chipKey],
            ...userSettings.chips_config![chipKey]
          };
        }
      });
    }

    return merged;
  }

  /**
   * Validate chips settings
   */
  static validateSettings(settings: any): settings is ChipsSettings {
    if (!settings || typeof settings !== 'object') {
      return false;
    }

    if (typeof settings.enabled !== 'boolean') {
      return false;
    }

    if (!settings.chips_config || typeof settings.chips_config !== 'object') {
      return false;
    }

    // Validate each chip config
    const validChipKeys = ['climate', 'lights', 'security', 'media', 'water'];
    const chipKeys = Object.keys(settings.chips_config);
    
    for (const key of chipKeys) {
      if (!validChipKeys.includes(key)) {
        return false;
      }

      const chip = settings.chips_config[key];
      if (!chip || typeof chip !== 'object') {
        return false;
      }

      if (typeof chip.enabled !== 'boolean') {
        return false;
      }

      if (chip.show_when_zero !== undefined && typeof chip.show_when_zero !== 'boolean') {
        return false;
      }

      if (chip.navigation_path !== undefined && typeof chip.navigation_path !== 'string') {
        return false;
      }
    }

    return true;
  }

  /**
   * Get chips settings from dashboard configuration
   */
  static getSettingsFromConfig(dashboardConfig?: any): ChipsSettings {
    // For now, always use default settings - chips are enabled by default
    // In the future, users can configure this through the dashboard config
    return this.getDefaultSettings();
  }

  /**
   * Save chips order
   */
  static async saveChipsOrder(customizationManager: CustomizationManager, chipsOrder: string[]): Promise<void> {
    // Use the CustomizationManager's method which now handles the new structure
    await customizationManager.saveChipsOrder(chipsOrder);
  }

  /**
   * Get saved chips order
   */
  static getSavedChipsOrder(customizationManager: CustomizationManager): string[] {
    // Use the CustomizationManager's method which now handles the new structure
    return customizationManager.getSavedChipsOrder();
  }

}
