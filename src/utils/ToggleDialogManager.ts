import { localize } from './LocalizationService';
import { DialogShell, getLiveHass, openDialogShell } from './DialogBase';

/**
 * Apple Home style dialog for lights and switches.
 *
 * - Lights that support brightness get a tall vertical pill: drag (or tap) to set the brightness,
 *   tap the icon to switch on/off. Lights with color support also get a row of color circles.
 *   The circles are the light's "favorite colors" from Home Assistant (stored in the entity
 *   registry options, `light.favorite_colors`, the same ones its own dialog shows), or the same
 *   defaults Home Assistant computes when none were saved.
 * - Switches, and lights that can only be switched on/off, get a tall vertical toggle.
 *
 * Anything else (effects, transitions, editing the favorite colors) is left to the native dialog
 * behind the gear icon.
 */

const COLOR_TEMP_COUNT = 4;
const DEFAULT_COLORED_COLORS: LightColor[] = [
  { rgb_color: [127, 172, 255] },
  { rgb_color: [215, 150, 255] },
  { rgb_color: [255, 158, 243] },
  { rgb_color: [255, 110, 84] }
];
const COLOR_MODES_WITH_COLOR = ['hs', 'xy', 'rgb', 'rgbw', 'rgbww'];
const SERVICE_CALL_THROTTLE_MS = 250;
/** After the user acts, ignore the polled state for a moment so the control does not jump back. */
const OPTIMISTIC_HOLD_MS = 1500;
const DRAG_THRESHOLD_PX = 4;
const WARM_WHITE = 'rgb(255, 236, 190)';

type LightColor =
  | { color_temp_kelvin: number }
  | { hs_color: [number, number] }
  | { rgb_color: [number, number, number] }
  | { rgbw_color: [number, number, number, number] }
  | { rgbww_color: [number, number, number, number, number] };

let stylesInjected = false;

function injectStyles(): void {
  if (stylesInjected) return;
  if (document.getElementById('ahd-toggle-styles')) {
    stylesInjected = true;
    return;
  }
  const style = document.createElement('style');
  style.id = 'ahd-toggle-styles';
  style.textContent = `
    .ahd-slider-wrap {
      display: flex;
      justify-content: center;
      margin-bottom: 8px;
    }

    .ahd-slider {
      position: relative;
      width: 140px;
      height: min(330px, 46vh);
      border-radius: 44px;
      background: rgba(120, 120, 128, 0.32);
      overflow: hidden;
      touch-action: none;
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
    }

    .ahd-slider.unavailable {
      opacity: 0.4;
      pointer-events: none;
    }

    .ahd-slider-fill {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 0;
      background: ${WARM_WHITE};
      transition: height 0.15s ease, background 0.3s ease;
    }

    .ahd-slider.dragging .ahd-slider-fill {
      transition: none;
    }

    .ahd-slider-icon {
      position: absolute;
      left: 50%;
      bottom: 22px;
      transform: translateX(-50%);
      --mdc-icon-size: 34px;
      color: #ffd60a;
      transition: color 0.2s ease;
    }

    .ahd-slider.on .ahd-slider-icon {
      color: rgba(0, 0, 0, 0.55);
    }

    .ahd-switch {
      position: relative;
      width: 140px;
      height: min(330px, 46vh);
      border-radius: 44px;
      background: rgba(120, 120, 128, 0.32);
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
    }

    .ahd-switch.unavailable {
      opacity: 0.4;
      pointer-events: none;
    }

    .ahd-switch-knob {
      position: absolute;
      left: 8px;
      right: 8px;
      height: calc(46% - 8px);
      top: calc(54% + 0px);
      border-radius: 36px;
      background: rgba(30, 30, 35, 0.75);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: top 0.25s cubic-bezier(0.32, 0.72, 0, 1), background 0.25s ease;
    }

    .ahd-switch.on .ahd-switch-knob {
      top: 8px;
      background: #f5f5f7;
    }

    .ahd-switch-face {
      position: relative;
      width: 38px;
      height: 38px;
      border-radius: 50%;
      background: #ffd60a;
    }

    .ahd-switch-face::before,
    .ahd-switch-face::after {
      content: '';
      position: absolute;
      top: 15px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.7);
    }

    .ahd-switch-face::before { left: 9px; }
    .ahd-switch-face::after { right: 9px; }

    .ahd-swatches {
      display: flex;
      gap: 14px;
      margin: 20px -24px 0;
      padding: 4px 24px;
      overflow-x: auto;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
    }

    .ahd-swatches::-webkit-scrollbar {
      display: none;
    }

    .ahd-swatch {
      flex: 0 0 auto;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, 0.25);
      padding: 0;
      cursor: pointer;
      box-sizing: border-box;
    }

    .ahd-swatch.selected {
      box-shadow: 0 0 0 3px rgba(40, 40, 46, 1), 0 0 0 5px #ffffff;
    }
  `;
  document.head.appendChild(style);
  stylesInjected = true;
}

// --- color helpers -------------------------------------------------------------------------

const clamp255 = (v: number) => Math.round(Math.min(255, Math.max(0, v)));

/** Approximation of the color of a black body at `kelvin` (Tanner Helland). */
function kelvinToRgb(kelvin: number): [number, number, number] {
  const t = kelvin / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66
    ? 99.4708025861 * Math.log(t) - 161.1195681661
    : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [clamp255(r), clamp255(g), clamp255(b)];
}

/** Hue (0-360) and saturation (0-100) at full value to RGB. */
function hsToRgb(hue: number, sat: number): [number, number, number] {
  const s = sat / 100;
  const h = ((hue % 360) + 360) % 360 / 60;
  const c = s;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = 1 - c;
  const [r1, g1, b1] =
    h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return [clamp255((r1 + m) * 255), clamp255((g1 + m) * 255), clamp255((b1 + m) * 255)];
}

function favoriteToRgb(color: LightColor): [number, number, number] {
  if ('color_temp_kelvin' in color) return kelvinToRgb(color.color_temp_kelvin);
  if ('hs_color' in color) return hsToRgb(color.hs_color[0], color.hs_color[1]);
  const c = (color as { rgb_color?: number[]; rgbw_color?: number[]; rgbww_color?: number[] });
  const rgb = c.rgb_color || c.rgbw_color || c.rgbww_color || [255, 255, 255];
  return [rgb[0], rgb[1], rgb[2]];
}

const cssRgb = (rgb: number[]) => `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;

// --- dialog --------------------------------------------------------------------------------

interface ToggleState {
  hass: any;
  entityId: string;
  domain: 'light' | 'switch';
  dimmable: boolean;
  on: boolean;
  unavailable: boolean;
  brightnessPct: number;
  lastUserActionAt: number;
  lastServiceCallAt: number;
}

export class ToggleDialogManager {
  static isSupported(entityId: string): boolean {
    return entityId.startsWith('light.') || entityId.startsWith('switch.');
  }

  static open(hass: any, entityId: string): void {
    const stateObj = hass?.states?.[entityId];
    if (!stateObj) return;
    injectStyles();

    const domain = entityId.startsWith('light.') ? 'light' : 'switch';
    const modes: string[] = stateObj.attributes?.supported_color_modes || [];
    const dimmable = domain === 'light' && modes.some(m => m !== 'onoff');

    const s: ToggleState = {
      hass,
      entityId,
      domain,
      dimmable,
      on: false,
      unavailable: false,
      brightnessPct: 0,
      lastUserActionAt: 0,
      lastServiceCallAt: 0
    };

    let refresh: () => void = () => {};
    const shell = openDialogShell(hass, entityId, {
      onTick: (h) => {
        s.hass = h;
        if (Date.now() - s.lastUserActionAt < OPTIMISTIC_HOLD_MS) return;
        this.readState(s);
        refresh();
      }
    });
    if (!shell) return;

    const wrap = document.createElement('div');
    wrap.className = 'ahd-slider-wrap';
    shell.body.appendChild(wrap);

    if (dimmable) {
      refresh = this.buildSlider(wrap, shell, s);
    } else {
      refresh = this.buildSwitch(wrap, shell, s);
    }

    if (domain === 'light' && modes.some(m => m === 'color_temp' || COLOR_MODES_WITH_COLOR.includes(m))) {
      this.buildSwatches(shell, s);
    }

    this.readState(s);
    refresh();
  }

  private static readState(s: ToggleState): void {
    const stateObj = s.hass?.states?.[s.entityId];
    s.unavailable = !stateObj || stateObj.state === 'unavailable' || stateObj.state === 'unknown';
    s.on = stateObj?.state === 'on';
    const b = stateObj?.attributes?.brightness;
    s.brightnessPct = s.on && typeof b === 'number' ? Math.max(1, Math.round((b / 255) * 100)) : 0;
  }

  private static subtitle(s: ToggleState): string {
    if (s.unavailable) return localize('status.unavailable');
    if (!s.on) return localize('status.off');
    return s.dimmable ? `${localize('status.on')} · ${s.brightnessPct}%` : localize('status.on');
  }

  private static fillColor(s: ToggleState): string {
    const attrs = s.hass?.states?.[s.entityId]?.attributes || {};
    const mode = attrs.color_mode;
    if (COLOR_MODES_WITH_COLOR.includes(mode) && Array.isArray(attrs.rgb_color)) return cssRgb(attrs.rgb_color);
    if (mode === 'color_temp' && typeof attrs.color_temp_kelvin === 'number') {
      return cssRgb(kelvinToRgb(attrs.color_temp_kelvin));
    }
    return WARM_WHITE;
  }

  private static callThrottled(s: ToggleState, service: string, data: Record<string, unknown>, force: boolean): void {
    const now = Date.now();
    s.lastUserActionAt = now;
    if (!force && now - s.lastServiceCallAt < SERVICE_CALL_THROTTLE_MS) return;
    s.lastServiceCallAt = now;
    s.hass.callService(s.domain, service, { entity_id: s.entityId, ...data });
  }

  /** Vertical brightness pill for dimmable lights. Returns the function that redraws it. */
  private static buildSlider(wrap: HTMLElement, shell: DialogShell, s: ToggleState): () => void {
    const pill = document.createElement('div');
    pill.className = 'ahd-slider';
    pill.innerHTML = `
      <div class="ahd-slider-fill"></div>
      <ha-icon class="ahd-slider-icon" icon="mdi:lightbulb"></ha-icon>
    `;
    wrap.appendChild(pill);
    const fill = pill.querySelector('.ahd-slider-fill') as HTMLElement;

    const refresh = () => {
      pill.classList.toggle('unavailable', s.unavailable);
      pill.classList.toggle('on', s.on);
      fill.style.height = s.on ? `${s.brightnessPct}%` : '0';
      fill.style.background = this.fillColor(s);
      shell.setSubtitle(this.subtitle(s));
    };

    const pctFromPointer = (clientY: number): number => {
      const rect = pill.getBoundingClientRect();
      return Math.min(100, Math.max(0, Math.round(((rect.bottom - clientY) / rect.height) * 100)));
    };

    const applyLevel = (pct: number, force: boolean) => {
      if (pct <= 0) {
        s.on = false;
        s.brightnessPct = 0;
        refresh();
        this.callThrottled(s, 'turn_off', {}, force);
        return;
      }
      s.on = true;
      s.brightnessPct = pct;
      refresh();
      this.callThrottled(s, 'turn_on', { brightness_pct: pct }, force);
    };

    let startY = 0;
    let pressed = false;
    let moved = false;

    pill.addEventListener('pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      pill.setPointerCapture?.(e.pointerId);
      pressed = true;
      moved = false;
      startY = e.clientY;
    });
    pill.addEventListener('pointermove', (e: PointerEvent) => {
      if (!pressed) return;
      if (!moved && Math.abs(e.clientY - startY) < DRAG_THRESHOLD_PX) return;
      moved = true;
      pill.classList.add('dragging');
      applyLevel(pctFromPointer(e.clientY), false);
    });
    pill.addEventListener('pointerup', (e: PointerEvent) => {
      if (!pressed) return;
      pressed = false;
      pill.classList.remove('dragging');
      if (moved) {
        applyLevel(pctFromPointer(e.clientY), true);
      } else if ((e.target as Element).closest('.ahd-slider-icon')) {
        // Tap on the icon: plain on/off toggle, like the icon of the card itself.
        s.on = !s.on;
        s.brightnessPct = s.on ? Math.max(s.brightnessPct, 100) : 0;
        refresh();
        this.callThrottled(s, s.on ? 'turn_on' : 'turn_off', {}, true);
      } else {
        // Tap on the pill: jump to that level.
        applyLevel(Math.max(1, pctFromPointer(e.clientY)), true);
      }
    });
    pill.addEventListener('pointercancel', () => {
      pressed = false;
      pill.classList.remove('dragging');
    });

    return refresh;
  }

  /** Vertical on/off toggle for switches and on/off-only lights. Returns the function that redraws it. */
  private static buildSwitch(wrap: HTMLElement, shell: DialogShell, s: ToggleState): () => void {
    const toggle = document.createElement('div');
    toggle.className = 'ahd-switch';
    toggle.innerHTML = `<div class="ahd-switch-knob"><div class="ahd-switch-face"></div></div>`;
    wrap.appendChild(toggle);

    const refresh = () => {
      toggle.classList.toggle('unavailable', s.unavailable);
      toggle.classList.toggle('on', s.on);
      shell.setSubtitle(this.subtitle(s));
    };

    toggle.addEventListener('click', () => {
      s.on = !s.on;
      refresh();
      this.callThrottled(s, s.on ? 'turn_on' : 'turn_off', {}, true);
    });

    return refresh;
  }

  // --- color circles -----------------------------------------------------------------------

  private static async loadFavorites(s: ToggleState): Promise<LightColor[]> {
    try {
      const entry = await s.hass.callWS({ type: 'config/entity_registry/get', entity_id: s.entityId });
      const saved = entry?.options?.light?.favorite_colors;
      if (Array.isArray(saved) && saved.length > 0) return saved as LightColor[];
    } catch {
      // Not in the registry (YAML light) or the user is not an admin: use the defaults.
    }
    return this.defaultFavorites(s);
  }

  /** Same defaults as the Home Assistant frontend uses when no favorite colors were saved. */
  private static defaultFavorites(s: ToggleState): LightColor[] {
    const attrs = s.hass?.states?.[s.entityId]?.attributes || {};
    const modes: string[] = attrs.supported_color_modes || [];
    const supportsTemp = modes.includes('color_temp');
    const supportsColor = modes.some(m => COLOR_MODES_WITH_COLOR.includes(m));
    const colors: LightColor[] = [];
    if (supportsTemp && typeof attrs.min_color_temp_kelvin === 'number' && typeof attrs.max_color_temp_kelvin === 'number') {
      const min = attrs.min_color_temp_kelvin;
      const step = (attrs.max_color_temp_kelvin - min) / (COLOR_TEMP_COUNT - 1);
      for (let i = 0; i < COLOR_TEMP_COUNT; i++) {
        colors.push({ color_temp_kelvin: Math.round(min + step * i) });
      }
    } else if (supportsColor) {
      const step = (6500 - 2000) / (COLOR_TEMP_COUNT - 1);
      for (let i = 0; i < COLOR_TEMP_COUNT; i++) {
        colors.push({ rgb_color: kelvinToRgb(Math.round(2000 + step * i)) });
      }
    }
    if (supportsColor) colors.push(...DEFAULT_COLORED_COLORS);
    return colors;
  }

  private static isSelected(s: ToggleState, color: LightColor): boolean {
    const attrs = s.hass?.states?.[s.entityId]?.attributes || {};
    if (!s.on) return false;
    if ('color_temp_kelvin' in color) {
      return attrs.color_mode === 'color_temp' && attrs.color_temp_kelvin === color.color_temp_kelvin;
    }
    if ('hs_color' in color) {
      const cur = attrs.hs_color;
      return Array.isArray(cur) && Math.abs(cur[0] - color.hs_color[0]) < 1 && Math.abs(cur[1] - color.hs_color[1]) < 1;
    }
    const key = Object.keys(color)[0] as 'rgb_color' | 'rgbw_color' | 'rgbww_color';
    const want = (color as any)[key] as number[];
    const cur = attrs[key];
    return Array.isArray(cur) && want.every((v, i) => Math.abs(cur[i] - v) <= 1);
  }

  private static async buildSwatches(shell: DialogShell, s: ToggleState): Promise<void> {
    const colors = await this.loadFavorites(s);
    if (colors.length === 0) return;

    const row = document.createElement('div');
    row.className = 'ahd-swatches';
    const buttons = colors.map(color => {
      const btn = document.createElement('button');
      btn.className = 'ahd-swatch';
      btn.style.background = cssRgb(favoriteToRgb(color));
      btn.addEventListener('click', () => {
        s.on = true;
        s.lastUserActionAt = Date.now();
        s.hass.callService('light', 'turn_on', { entity_id: s.entityId, ...color });
        buttons.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
      row.appendChild(btn);
      return btn;
    });
    shell.body.appendChild(row);

    const syncSelection = () => {
      colors.forEach((color, i) => buttons[i].classList.toggle('selected', this.isSelected(s, color)));
    };
    syncSelection();
    // The dialog polls state once a second; follow it so the ring tracks external changes too.
    const timer = window.setInterval(() => {
      if (!row.isConnected) {
        window.clearInterval(timer);
        return;
      }
      s.hass = getLiveHass(s.hass);
      if (Date.now() - s.lastUserActionAt >= OPTIMISTIC_HOLD_MS) syncSelection();
    }, 1000);
  }
}
