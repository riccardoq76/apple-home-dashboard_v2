import { Area, Entity, Device } from '../types/types';

export class DataService {
  static async getDevices(hass: any): Promise<Device[]> {
    try {
      return await hass.callWS({ type: 'config/device_registry/list' });
    } catch {
      return [];
    }
  }

  static async getAreas(hass: any): Promise<Area[]> {
    try {
      return await hass.callWS({ type: 'config/area_registry/list' });
    } catch {
      return [];
    }
  }

  static async getEntities(hass: any): Promise<Entity[]> {
    try {
      const entities = await hass.callWS({ type: 'config/entity_registry/list' });
      // Filter out hidden and disabled entities
      return entities.filter((entity: Entity) => {
        // Exclude entities that are hidden by user, integration, etc.
        if (entity.hidden_by) {
          return false;
        }
        // Exclude entities that are disabled
        if (entity.disabled_by) {
          return false;
        }
        return true;
      });
    } catch {
      return [];
    }
  }

  static groupEntitiesByArea(
    entities: Entity[],
    areas: Area[],
    devices: Device[] = []
  ): { [areaId: string]: Entity[] } {
    const entitiesByArea: { [areaId: string]: Entity[] } = {};

    // Initialize areas
    areas.forEach((area) => {
      entitiesByArea[area.area_id] = [];
    });

    // Add entities without area to 'no_area'
    entitiesByArea['no_area'] = [];

    // Group entities by area
    entities.forEach((entity) => {
      let areaId = entity.area_id;

      // If entity doesn't have an area but has a device, check device's area
      if (!areaId && entity.device_id) {
        const device = devices.find((d) => d.id === entity.device_id);
        if (device?.area_id) {
          areaId = device.area_id;
        }
      }

      // If still no area, put in 'no_area'
      if (!areaId) {
        areaId = 'no_area';
      }

      // Initialize area if it doesn't exist (shouldn't happen, but just in case)
      if (!entitiesByArea[areaId]) {
        entitiesByArea[areaId] = [];
      }

      entitiesByArea[areaId].push(entity);
    });

    return entitiesByArea;
  }
}
