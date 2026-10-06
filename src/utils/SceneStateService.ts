import { EntityState } from '../types/types';

type TargetState = Record<string, any>;

/**
 * Works out whether a scene is "active" like Apple Home does: a scene is highlighted when
 * every device it controls currently matches the state the scene would set.
 *
 * Home Assistant only exposes the member entity ids on a scene entity, not their target
 * states, so the targets are read once from the scene config API (UI/scenes.yaml scenes
 * with an `id`) and cached. Scenes without readable config are simply never highlighted.
 */
export class SceneStateService {
  private static targets = new Map<string, TargetState | null>();
  private static pending = new Map<string, Promise<void>>();

  /** Load the scene's target states (once). Resolves when the cache has an entry. */
  static ensureLoaded(hass: any, scene: EntityState): Promise<void> {
    const entityId = scene.entity_id;
    if (this.targets.has(entityId)) return Promise.resolve();
    const existing = this.pending.get(entityId);
    if (existing) return existing;

    const configId = scene.attributes?.id;
    const request: Promise<void> =
      !configId || typeof hass?.callApi !== 'function'
        ? Promise.resolve().then(() => {
            this.targets.set(entityId, null);
          })
        : hass
            .callApi('GET', `config/scene/config/${configId}`)
            .then((config: any) => {
              this.targets.set(
                entityId,
                config?.entities && Object.keys(config.entities).length ? config.entities : null
              );
            })
            .catch(() => {
              // Not editable / not admin: no way to know the targets
              this.targets.set(entityId, null);
            });
    const tracked = request.finally(() => this.pending.delete(entityId));
    this.pending.set(entityId, tracked);
    return tracked;
  }

  /** Forget cached targets (e.g. when the scene was edited). */
  static invalidate(entityId?: string): void {
    if (entityId) this.targets.delete(entityId);
    else this.targets.clear();
  }

  static isActive(hass: any, scene: EntityState): boolean {
    const targets = this.targets.get(scene.entity_id);
    if (!targets || !hass?.states) return false;

    for (const [entityId, target] of Object.entries(targets)) {
      const current: EntityState | undefined = hass.states[entityId];
      if (!current || !this.matches(current, target)) return false;
    }
    return true;
  }

  private static normalizeState(value: any): string {
    if (value === true) return 'on';
    if (value === false) return 'off';
    return String(value).toLowerCase();
  }

  private static matches(current: EntityState, target: TargetState | string | boolean): boolean {
    // Short form: `light.x: "on"`
    if (typeof target !== 'object' || target === null) {
      return this.normalizeState(current.state) === this.normalizeState(target);
    }

    if (target.state !== undefined && this.normalizeState(current.state) !== this.normalizeState(target.state)) {
      return false;
    }
    // An off device has no meaningful attributes to compare
    if (this.normalizeState(current.state) === 'off') return true;

    const attrs = current.attributes || {};
    const near = (a: any, b: any, tolerance: number) =>
      typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tolerance;

    if (target.brightness !== undefined && !near(attrs.brightness, target.brightness, 5)) return false;
    if (target.color_temp_kelvin !== undefined && !near(attrs.color_temp_kelvin, target.color_temp_kelvin, 150))
      return false;
    if (
      target.temperature !== undefined &&
      attrs.temperature !== undefined &&
      !near(attrs.temperature, target.temperature, 0.3)
    )
      return false;
    if (target.current_position !== undefined && !near(attrs.current_position, target.current_position, 3))
      return false;
    const rgb: any[] | undefined = attrs.rgb_color;
    if (Array.isArray(target.rgb_color) && Array.isArray(rgb)) {
      if (target.rgb_color.some((v: number, i: number) => !near(rgb[i], v, 12))) return false;
    }
    return true;
  }
}
