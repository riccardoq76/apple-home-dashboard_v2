import { DataService } from './DataService';
import { Area, Device, Entity } from '../types/types';
import { localize } from './LocalizationService';
import { LiquidGlassClasses, liquidGlassCSS } from './LiquidGlassStyles';
import { CLIMATE_MODE_COLORS } from '../config/DashboardConfig';

/**
 * Apple Home style thermostat dialog.
 *
 * Replaces the native Home Assistant more-info dialog for the `climate` domain with a
 * draggable ring control matching the real Apple Home app: a colored arc (orange for heat,
 * blue for cool, green for auto) with a draggable thumb for the target temperature, a small
 * fixed dot for the current temperature, and a mode pill below that cycles hvac_modes.
 *
 * Anything beyond temperature + mode (fan mode, swing mode, presets, history) is not
 * recreated here - the gear icon falls back to the native more-info dialog for that.
 */

// Ring geometry: angle 0 = top (12 o'clock), increasing clockwise.
// The track has a gap centered at the bottom so the two tips sit near 7-8 and 4-5 o'clock,
// matching the real app - min temperature at the left tip, max temperature at the right tip.
const RING_VIEWBOX = 220;
const RING_RADIUS = 92;
const RING_STROKE = 16;
const THUMB_RADIUS = 14;
const GAP_DEGREES = 80;
const START_ANGLE = 180 + GAP_DEGREES / 2; // angle of the min-temp tip
const SWEEP_DEGREES = 360 - GAP_DEGREES;
const DEFAULT_MIN_TEMP = 7;
const DEFAULT_MAX_TEMP = 35;
const DEFAULT_STEP = 0.5;
const SERVICE_CALL_THROTTLE_MS = 250;

interface ClimateDialogState {
  hass: any;
  entityId: string;
  minTemp: number;
  maxTemp: number;
  step: number;
  targetTemp: number | null;
  currentTemp: number | null;
  hvacMode: string;
  hvacModes: string[];
  supportsTarget: boolean;
}

let stylesInjected = false;

function injectDialogStyles(): void {
  if (stylesInjected) return;
  const existing = document.getElementById('climate-dialog-styles');
  if (existing) {
    stylesInjected = true;
    return;
  }
  const style = document.createElement('style');
  style.id = 'climate-dialog-styles';
  style.textContent = `
    ${liquidGlassCSS}

    .climate-dialog-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(20px) saturate(1.5);
      -webkit-backdrop-filter: blur(20px) saturate(1.5);
      z-index: 1000;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.3s ease;
    }

    .climate-dialog-backdrop.show {
      opacity: 1;
    }

    @media (min-width: 600px) {
      .climate-dialog-backdrop {
        align-items: center;
      }
    }

    .climate-dialog-content {
      width: 100%;
      max-width: 420px;
      max-height: 92vh;
      overflow-y: auto;
      background: rgba(40, 40, 46, 0.85);
      border-radius: 28px 28px 0 0;
      padding: 20px 24px 32px;
      box-sizing: border-box;
      transform: translateY(40px);
      transition: transform 0.3s cubic-bezier(0.32, 0.72, 0, 1);
      color: #ffffff;
    }

    @media (min-width: 600px) {
      .climate-dialog-content {
        border-radius: 28px;
        margin-bottom: 0;
      }
    }

    .climate-dialog-backdrop.show .climate-dialog-content {
      transform: translateY(0);
    }

    .climate-dialog-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    .climate-dialog-titles {
      text-align: center;
      flex: 1;
    }

    .climate-dialog-room {
      font-size: 13px;
      color: rgba(255, 255, 255, 0.6);
      margin: 0 0 2px;
    }

    .climate-dialog-name {
      font-size: 20px;
      font-weight: 600;
      margin: 0;
    }

    .climate-dialog-spacer {
      width: 40px;
      height: 40px;
      flex-shrink: 0;
    }

    .climate-dialog-current {
      text-align: center;
      font-size: 15px;
      color: rgba(255, 255, 255, 0.6);
      margin: 0 0 18px;
    }

    .climate-dialog-ring-wrap {
      position: relative;
      width: 100%;
      max-width: 260px;
      margin: 0 auto 24px;
      touch-action: none;
    }

    .climate-dialog-ring-wrap svg {
      width: 100%;
      height: auto;
      display: block;
    }

    .climate-dialog-ring-track {
      fill: none;
      stroke: rgba(120, 120, 128, 0.32);
      stroke-linecap: round;
    }

    .climate-dialog-ring-fill {
      fill: none;
      stroke-linecap: round;
      transition: stroke 0.2s ease;
    }

    .climate-dialog-ring-hit {
      fill: none;
      stroke: transparent;
      stroke-width: 48;
      cursor: grab;
    }

    .climate-dialog-ring-hit:active {
      cursor: grabbing;
    }

    .climate-dialog-thumb {
      cursor: grab;
    }

    .climate-dialog-thumb:active {
      cursor: grabbing;
    }

    .climate-dialog-current-dot {
      fill: rgba(255, 255, 255, 0.85);
      stroke: rgba(0, 0, 0, 0.3);
      stroke-width: 1;
    }

    .climate-dialog-center {
      text-anchor: middle;
      dominant-baseline: middle;
    }

    .climate-dialog-center-label {
      font-size: 13px;
      fill: rgba(255, 255, 255, 0.6);
      font-family: inherit;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .climate-dialog-center-value {
      font-size: 44px;
      font-weight: 600;
      fill: #ffffff;
      font-family: inherit;
    }

    .climate-dialog-center-off {
      font-size: 24px;
      font-weight: 600;
      fill: #ffffff;
      font-family: inherit;
    }

    .climate-dialog-mode-pill {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 14px 20px;
      border-radius: 18px;
      background: rgba(120, 120, 128, 0.32);
      color: #ffffff;
      font-size: 17px;
      font-weight: 600;
      border: none;
      cursor: pointer;
      box-sizing: border-box;
    }

    .climate-dialog-mode-pill:active {
      background: rgba(120, 120, 128, 0.45);
    }

    .climate-dialog-mode-pill ha-icon {
      --mdc-icon-size: 18px;
      opacity: 0.6;
    }

    .climate-dialog-footer {
      display: flex;
      justify-content: flex-end;
      margin-top: 16px;
    }
  `;
  document.head.appendChild(style);
  stylesInjected = true;
}

export class ClimateDialogManager {
  private static activeBackdrop: HTMLElement | null = null;
  private static state: ClimateDialogState | null = null;
  private static dragging = false;
  private static lastServiceCallAt = 0;
  private static svgEl: SVGSVGElement | null = null;
  private static fillPath: SVGPathElement | null = null;
  private static thumbEl: SVGCircleElement | null = null;
  private static currentDotEl: SVGCircleElement | null = null;
  private static centerLabelEl: SVGTextElement | null = null;
  private static centerValueEl: SVGTextElement | null = null;
  private static modePillTextEl: HTMLElement | null = null;
  private static boundPointerMove?: (e: PointerEvent) => void;
  private static boundPointerUp?: (e: PointerEvent) => void;

  /** Only the `climate` domain is supported for now; other domains fall back to native more-info. */
  static isSupported(entityId: string): boolean {
    return entityId.startsWith('climate.');
  }

  static open(hass: any, entityId: string): void {
    if (this.activeBackdrop) return;
    injectDialogStyles();

    const stateObj = hass?.states?.[entityId];
    if (!stateObj) return;
    const attributes = stateObj.attributes || {};

    this.state = {
      hass,
      entityId,
      minTemp: typeof attributes.min_temp === 'number' ? attributes.min_temp : DEFAULT_MIN_TEMP,
      maxTemp: typeof attributes.max_temp === 'number' ? attributes.max_temp : DEFAULT_MAX_TEMP,
      step: typeof attributes.target_temp_step === 'number' ? attributes.target_temp_step : DEFAULT_STEP,
      targetTemp: typeof attributes.temperature === 'number' ? attributes.temperature : null,
      currentTemp: typeof attributes.current_temperature === 'number' ? attributes.current_temperature : null,
      hvacMode: stateObj.state,
      hvacModes: Array.isArray(attributes.hvac_modes) ? attributes.hvac_modes : [stateObj.state],
      supportsTarget: typeof attributes.temperature === 'number'
    };

    this.render(stateObj, attributes);
  }

  private static async render(stateObj: any, attributes: any): Promise<void> {
    const s = this.state!;
    const entityName = attributes.friendly_name || s.entityId;
    const roomName = await this.getAreaName(s.hass, s.entityId);

    const backdrop = document.createElement('div');
    backdrop.className = 'climate-dialog-backdrop';

    const content = document.createElement('div');
    content.className = 'climate-dialog-content';

    // Header
    const header = document.createElement('div');
    header.className = 'climate-dialog-header';
    header.innerHTML = `
      <button class="climate-close ${LiquidGlassClasses.modalCancel}">
        <ha-icon icon="mdi:close"></ha-icon>
      </button>
      <div class="climate-dialog-titles">
        ${roomName ? `<p class="climate-dialog-room">${roomName}</p>` : ''}
        <p class="climate-dialog-name">${entityName}</p>
      </div>
      <button class="climate-settings ${LiquidGlassClasses.modalCancel}">
        <ha-icon icon="mdi:cog-outline"></ha-icon>
      </button>
    `;

    const tempUnit = attributes.unit_of_measurement || s.hass?.config?.unit_system?.temperature || '°C';
    const currentLine = document.createElement('p');
    currentLine.className = 'climate-dialog-current';
    currentLine.textContent = s.currentTemp !== null
      ? `${localize('climate_dialog.current')}: ${this.formatTemp(s.currentTemp)}${tempUnit}`
      : '';

    // Ring
    const ringWrap = document.createElement('div');
    ringWrap.className = 'climate-dialog-ring-wrap';
    ringWrap.innerHTML = this.buildRingSvg();

    // Mode pill
    const modePill = document.createElement('button');
    modePill.className = 'climate-dialog-mode-pill';
    modePill.innerHTML = `<span class="climate-dialog-mode-text"></span><ha-icon icon="mdi:unfold-more-horizontal"></ha-icon>`;

    content.appendChild(header);
    content.appendChild(currentLine);
    content.appendChild(ringWrap);
    content.appendChild(modePill);

    backdrop.appendChild(content);
    document.body.appendChild(backdrop);
    this.activeBackdrop = backdrop;

    // Wire references
    this.svgEl = ringWrap.querySelector('svg');
    this.fillPath = ringWrap.querySelector('.climate-dialog-ring-fill');
    this.thumbEl = ringWrap.querySelector('.climate-dialog-thumb');
    this.currentDotEl = ringWrap.querySelector('.climate-dialog-current-dot');
    this.centerLabelEl = ringWrap.querySelector('.climate-dialog-center-label');
    this.centerValueEl = ringWrap.querySelector('.climate-dialog-center-value');
    this.modePillTextEl = modePill.querySelector('.climate-dialog-mode-text');

    this.updateVisuals();

    // Close handlers
    const closeBtn = header.querySelector('.climate-close');
    const closeDialog = () => this.close();
    closeBtn?.addEventListener('click', closeDialog);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeDialog();
    });

    // Settings -> native more-info
    const settingsBtn = header.querySelector('.climate-settings');
    settingsBtn?.addEventListener('click', () => {
      const entityId = s.entityId;
      this.close();
      this.dispatchNativeMoreInfo(entityId);
    });

    // Mode pill -> cycle hvac_modes
    modePill.addEventListener('click', () => this.cycleMode());

    // Ring drag
    this.setupRingInteraction(ringWrap);

    requestAnimationFrame(() => backdrop.classList.add('show'));
  }

  private static buildRingSvg(): string {
    const cx = RING_VIEWBOX / 2;
    const cy = RING_VIEWBOX / 2;
    const trackD = this.describeArc(cx, cy, RING_RADIUS, 0, SWEEP_DEGREES);
    return `
      <svg viewBox="0 0 ${RING_VIEWBOX} ${RING_VIEWBOX}">
        <path class="climate-dialog-ring-track" d="${trackD}" stroke-width="${RING_STROKE}" />
        <path class="climate-dialog-ring-fill" d="" stroke-width="${RING_STROKE}" />
        <path class="climate-dialog-ring-hit" d="${trackD}" />
        <circle class="climate-dialog-current-dot" cx="${cx}" cy="${cy - RING_RADIUS}" r="4" />
        <circle class="climate-dialog-thumb" cx="${cx}" cy="${cy - RING_RADIUS}" r="${THUMB_RADIUS}" fill="#ffffff" />
        <text class="climate-dialog-center climate-dialog-center-label" x="${cx}" y="${cy - 12}"></text>
        <text class="climate-dialog-center climate-dialog-center-value" x="${cx}" y="${cy + 18}"></text>
      </svg>
    `;
  }

  /** Point on the ring for an angle expressed in "progress" degrees from START_ANGLE (clockwise). */
  private static pointAt(cx: number, cy: number, radius: number, progressDegrees: number): { x: number; y: number } {
    const angle = START_ANGLE + progressDegrees;
    const rad = (angle * Math.PI) / 180;
    return {
      x: cx + radius * Math.sin(rad),
      y: cy - radius * Math.cos(rad)
    };
  }

  private static describeArc(cx: number, cy: number, radius: number, fromProgress: number, toProgress: number): string {
    if (toProgress - fromProgress <= 0.001) return '';
    const start = this.pointAt(cx, cy, radius, fromProgress);
    const end = this.pointAt(cx, cy, radius, toProgress);
    const largeArc = toProgress - fromProgress > 180 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`;
  }

  private static valueToProgress(value: number): number {
    const s = this.state!;
    const clamped = Math.min(s.maxTemp, Math.max(s.minTemp, value));
    return ((clamped - s.minTemp) / (s.maxTemp - s.minTemp)) * SWEEP_DEGREES;
  }

  private static progressToValue(progress: number): number {
    const s = this.state!;
    const clamped = Math.min(SWEEP_DEGREES, Math.max(0, progress));
    const raw = s.minTemp + (clamped / SWEEP_DEGREES) * (s.maxTemp - s.minTemp);
    return Math.round(raw / s.step) * s.step;
  }

  private static angleFromPointer(clientX: number, clientY: number): number {
    const rect = this.svgEl!.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    return (deg + 360) % 360;
  }

  private static progressFromPointerAngle(pointerAngle: number): number {
    const raw = (pointerAngle - START_ANGLE + 360) % 360;
    if (raw <= SWEEP_DEGREES) return raw;
    // Pointer is within the bottom gap - snap to whichever end is closer.
    const distToMax = raw - SWEEP_DEGREES;
    const distToMin = 360 - raw;
    return distToMax < distToMin ? SWEEP_DEGREES : 0;
  }

  private static setupRingInteraction(ringWrap: HTMLElement): void {
    const s = this.state!;
    if (!s.supportsTarget || s.hvacMode === 'off') return; // matches the real app: ring is inert when off

    const startDrag = (clientX: number, clientY: number) => {
      this.dragging = true;
      this.applyPointer(clientX, clientY);
    };

    ringWrap.addEventListener('pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      startDrag(e.clientX, e.clientY);
    });

    this.boundPointerMove = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.applyPointer(e.clientX, e.clientY);
    };
    this.boundPointerUp = () => {
      if (!this.dragging) return;
      this.dragging = false;
      this.commitTargetTemp(true);
    };

    window.addEventListener('pointermove', this.boundPointerMove);
    window.addEventListener('pointerup', this.boundPointerUp);
  }

  private static applyPointer(clientX: number, clientY: number): void {
    const angle = this.angleFromPointer(clientX, clientY);
    const progress = this.progressFromPointerAngle(angle);
    const value = this.progressToValue(progress);
    this.state!.targetTemp = value;
    this.updateVisuals();
    this.commitTargetTemp(false);
  }

  private static commitTargetTemp(force: boolean): void {
    const s = this.state!;
    if (s.targetTemp === null) return;
    const now = Date.now();
    if (!force && now - this.lastServiceCallAt < SERVICE_CALL_THROTTLE_MS) return;
    this.lastServiceCallAt = now;
    s.hass.callService('climate', 'set_temperature', {
      entity_id: s.entityId,
      temperature: s.targetTemp
    });
  }

  private static cycleMode(): void {
    const s = this.state!;
    if (s.hvacModes.length < 2) return;
    const idx = s.hvacModes.indexOf(s.hvacMode);
    const next = s.hvacModes[(idx + 1) % s.hvacModes.length];
    s.hvacMode = next;
    s.hass.callService('climate', 'set_hvac_mode', {
      entity_id: s.entityId,
      hvac_mode: next
    });
    // The ring becomes interactive/inert depending on off vs active; re-render is simplest.
    this.updateVisuals();
    this.refreshRingInteractivity();
  }

  private static refreshRingInteractivity(): void {
    const ringWrap = this.activeBackdrop?.querySelector('.climate-dialog-ring-wrap') as HTMLElement | null;
    if (!ringWrap) return;
    ringWrap.style.opacity = this.state!.hvacMode === 'off' ? '0.5' : '1';
    ringWrap.style.pointerEvents = this.state!.hvacMode === 'off' ? 'none' : 'auto';
  }

  private static updateVisuals(): void {
    const s = this.state!;
    const color = (CLIMATE_MODE_COLORS as Record<string, string>)[s.hvacMode] || CLIMATE_MODE_COLORS.heat;
    const isOff = s.hvacMode === 'off';

    if (this.fillPath) {
      if (s.supportsTarget && s.targetTemp !== null && !isOff) {
        const progress = this.valueToProgress(s.targetTemp);
        this.fillPath.setAttribute('d', this.describeArc(RING_VIEWBOX / 2, RING_VIEWBOX / 2, RING_RADIUS, 0, progress));
        this.fillPath.setAttribute('stroke', color);
      } else {
        this.fillPath.setAttribute('d', '');
      }
    }

    if (this.thumbEl) {
      if (s.supportsTarget && s.targetTemp !== null) {
        const progress = this.valueToProgress(s.targetTemp);
        const p = this.pointAt(RING_VIEWBOX / 2, RING_VIEWBOX / 2, RING_RADIUS, progress);
        this.thumbEl.setAttribute('cx', String(p.x));
        this.thumbEl.setAttribute('cy', String(p.y));
        this.thumbEl.style.display = isOff ? 'none' : '';
      } else {
        this.thumbEl.style.display = 'none';
      }
    }

    if (this.currentDotEl) {
      if (s.currentTemp !== null) {
        const progress = this.valueToProgress(s.currentTemp);
        const p = this.pointAt(RING_VIEWBOX / 2, RING_VIEWBOX / 2, RING_RADIUS, progress);
        this.currentDotEl.setAttribute('cx', String(p.x));
        this.currentDotEl.setAttribute('cy', String(p.y));
        this.currentDotEl.style.display = '';
      } else {
        this.currentDotEl.style.display = 'none';
      }
    }

    if (this.centerLabelEl && this.centerValueEl) {
      if (isOff || !s.supportsTarget) {
        this.centerLabelEl.textContent = '';
        this.centerValueEl.textContent = this.modeLabel(isOff ? 'off' : s.hvacMode);
        this.centerValueEl.setAttribute('class', 'climate-dialog-center climate-dialog-center-off');
      } else {
        this.centerLabelEl.textContent = localize('climate_dialog.threshold');
        this.centerValueEl.textContent = this.formatTemp(s.targetTemp as number);
        this.centerValueEl.setAttribute('class', 'climate-dialog-center climate-dialog-center-value');
      }
    }

    if (this.modePillTextEl) {
      this.modePillTextEl.textContent = this.modeLabel(s.hvacMode);
    }
  }

  /**
   * Localized label for an hvac_mode. `heat_cool` and `auto` are the same concept under two
   * different names depending on the climate integration (same as CLIMATE_MODE_COLORS), and any
   * mode without a translation (e.g. a custom one) falls back to the raw mode string instead of
   * the untranslated "climate_dialog.xxx" key.
   */
  private static modeLabel(mode: string): string {
    const key = mode === 'heat_cool' ? 'auto' : mode;
    const translationKey = `climate_dialog.${key}`;
    const translated = localize(translationKey);
    return translated === translationKey ? mode : translated;
  }

  private static formatTemp(value: number): string {
    return value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  private static async getAreaName(hass: any, entityId: string): Promise<string | null> {
    try {
      const [areas, devices, entities] = await Promise.all([
        DataService.getAreas(hass),
        DataService.getDevices(hass),
        DataService.getEntities(hass)
      ]);
      const entity = entities.find((e: Entity) => e.entity_id === entityId);
      let areaId = entity?.area_id;
      if (!areaId && entity?.device_id) {
        const device = devices.find((d: Device) => d.id === entity.device_id);
        areaId = device?.area_id;
      }
      if (!areaId) return null;
      const area = areas.find((a: Area) => a.area_id === areaId);
      return area?.name || null;
    } catch {
      return null;
    }
  }

  private static dispatchNativeMoreInfo(entityId: string): void {
    const event = new CustomEvent('hass-more-info', {
      detail: { entityId },
      bubbles: true,
      composed: true
    });
    const targets = [
      document.querySelector('ha-app'),
      document.querySelector('home-assistant'),
      document.querySelector('hui-root'),
      document.querySelector('ha-panel-lovelace')
    ].filter(Boolean);
    if (targets.length > 0) {
      targets.forEach(t => t!.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId }, bubbles: true, composed: true })));
    } else {
      document.body.dispatchEvent(event);
    }
  }

  private static close(): void {
    if (this.boundPointerMove) window.removeEventListener('pointermove', this.boundPointerMove);
    if (this.boundPointerUp) window.removeEventListener('pointerup', this.boundPointerUp);
    this.boundPointerMove = undefined;
    this.boundPointerUp = undefined;
    this.dragging = false;

    const backdrop = this.activeBackdrop;
    if (!backdrop) return;
    backdrop.classList.remove('show');
    setTimeout(() => backdrop.remove(), 300);

    this.activeBackdrop = null;
    this.state = null;
    this.svgEl = null;
    this.fillPath = null;
    this.thumbEl = null;
    this.currentDotEl = null;
    this.centerLabelEl = null;
    this.centerValueEl = null;
    this.modePillTextEl = null;
  }
}
