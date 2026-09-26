import { LiquidGlassClasses, liquidGlassCSS } from './LiquidGlassStyles';

/**
 * Shared shell for the Apple Home style entity dialogs (lights, switches, media players).
 *
 * Same look and size as the thermostat dialog: blurred backdrop, a bottom sheet on phones and a
 * centered card from 600px up (iPad, desktop), header with close button, name + status line and a
 * gear that falls back to the native Home Assistant more-info dialog.
 *
 * The shell also polls the live `hass` object once a second, because a dialog opened from a card
 * would otherwise keep the state it had when it was opened (track changes, progress, a light
 * switched on from a wall switch).
 */

const TICK_INTERVAL_MS = 1000;
const SLIDER_THROTTLE_MS = 250;

export interface DialogShell {
  /** Container for the dialog specific controls, below the header. */
  body: HTMLElement;
  setSubtitle(text: string): void;
  close(): void;
}

export interface DialogShellOptions {
  /** Called once a second with the freshest `hass` available. */
  onTick?: (hass: any) => void;
  onClose?: () => void;
}

let stylesInjected = false;

function injectStyles(): void {
  if (stylesInjected) return;
  if (document.getElementById('ahd-dialog-styles')) {
    stylesInjected = true;
    return;
  }
  const style = document.createElement('style');
  style.id = 'ahd-dialog-styles';
  style.textContent = `
    ${liquidGlassCSS}

    .ahd-backdrop {
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

    .ahd-backdrop.show {
      opacity: 1;
    }

    @media (min-width: 600px) {
      .ahd-backdrop {
        align-items: center;
      }
    }

    .ahd-content {
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
      .ahd-content {
        border-radius: 28px;
      }
    }

    .ahd-backdrop.show .ahd-content {
      transform: translateY(0);
    }

    .ahd-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 20px;
    }

    .ahd-titles {
      text-align: center;
      flex: 1;
      min-width: 0;
      padding: 0 8px;
    }

    .ahd-name {
      font-size: 20px;
      font-weight: 600;
      margin: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ahd-subtitle {
      font-size: 15px;
      color: rgba(255, 255, 255, 0.6);
      margin: 2px 0 0;
      min-height: 20px;
    }

    .ahd-hslider {
      position: relative;
      height: 28px;
      display: flex;
      align-items: center;
      touch-action: none;
      cursor: pointer;
    }

    .ahd-hslider-track {
      position: relative;
      width: 100%;
      height: 6px;
      border-radius: 3px;
      background: rgba(255, 255, 255, 0.2);
      overflow: hidden;
    }

    .ahd-hslider-fill {
      position: absolute;
      inset: 0 auto 0 0;
      width: 0;
      background: rgba(255, 255, 255, 0.75);
    }

    [dir="rtl"] .ahd-hslider-fill {
      inset: 0 0 0 auto;
    }
  `;
  document.head.appendChild(style);
  stylesInjected = true;
}

export function isDialogOpen(): boolean {
  return !!document.querySelector('.ahd-backdrop, .climate-dialog-backdrop');
}

export function openDialogShell(
  hass: any,
  entityId: string,
  options: DialogShellOptions = {}
): DialogShell | null {
  if (isDialogOpen()) return null;
  const stateObj = hass?.states?.[entityId];
  if (!stateObj) return null;
  injectStyles();

  const backdrop = document.createElement('div');
  backdrop.className = 'ahd-backdrop';

  const content = document.createElement('div');
  content.className = 'ahd-content';

  const header = document.createElement('div');
  header.className = 'ahd-header';
  header.innerHTML = `
    <button class="ahd-close ${LiquidGlassClasses.modalCancel}">
      <ha-icon icon="mdi:close"></ha-icon>
    </button>
    <div class="ahd-titles">
      <p class="ahd-name"></p>
      <p class="ahd-subtitle"></p>
    </div>
    <button class="ahd-settings ${LiquidGlassClasses.modalCancel}">
      <ha-icon icon="mdi:cog-outline"></ha-icon>
    </button>
  `;
  (header.querySelector('.ahd-name') as HTMLElement).textContent =
    stateObj.attributes?.friendly_name || entityId;
  const subtitleEl = header.querySelector('.ahd-subtitle') as HTMLElement;

  const body = document.createElement('div');
  body.className = 'ahd-body';

  content.appendChild(header);
  content.appendChild(body);
  backdrop.appendChild(content);
  document.body.appendChild(backdrop);

  let closed = false;
  let tickTimer: number | undefined;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') shell.close();
  };

  const shell: DialogShell = {
    body,
    setSubtitle(text: string) {
      subtitleEl.textContent = text;
    },
    close() {
      if (closed) return;
      closed = true;
      window.clearInterval(tickTimer);
      document.removeEventListener('keydown', onKeyDown);
      backdrop.classList.remove('show');
      setTimeout(() => backdrop.remove(), 300);
      options.onClose?.();
    }
  };

  header.querySelector('.ahd-close')?.addEventListener('click', () => shell.close());
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) shell.close();
  });
  header.querySelector('.ahd-settings')?.addEventListener('click', () => {
    shell.close();
    dispatchNativeMoreInfo(entityId);
  });
  document.addEventListener('keydown', onKeyDown);

  if (options.onTick) {
    tickTimer = window.setInterval(() => {
      options.onTick!(getLiveHass(hass));
    }, TICK_INTERVAL_MS);
  }

  requestAnimationFrame(() => backdrop.classList.add('show'));
  return shell;
}

/** The `hass` held by a card is a snapshot; the `home-assistant` element always has the latest. */
export function getLiveHass(fallback: any): any {
  return (document.querySelector('home-assistant') as any)?.hass ?? fallback;
}

export function dispatchNativeMoreInfo(entityId: string): void {
  const targets = [
    document.querySelector('ha-app'),
    document.querySelector('home-assistant'),
    document.querySelector('hui-root'),
    document.querySelector('ha-panel-lovelace')
  ].filter(Boolean) as Element[];
  if (targets.length > 0) {
    targets.forEach(t =>
      t.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId }, bubbles: true, composed: true }))
    );
  } else {
    document.body.dispatchEvent(
      new CustomEvent('hass-more-info', { detail: { entityId }, bubbles: true, composed: true })
    );
  }
}

export interface HSliderOptions {
  /** Called while dragging (throttled) and once on release with `final = true`. */
  onChange: (fraction: number, final: boolean) => void;
}

/**
 * Horizontal slider (progress bar, volume). Returns a setter that moves the fill without firing
 * `onChange`, and a flag telling whether the user is currently dragging it, so a live refresh does
 * not fight the finger.
 */
export function createHSlider(host: HTMLElement, options: HSliderOptions): {
  set: (fraction: number) => void;
  isDragging: () => boolean;
} {
  host.classList.add('ahd-hslider');
  host.innerHTML = `<div class="ahd-hslider-track"><div class="ahd-hslider-fill"></div></div>`;
  const track = host.querySelector('.ahd-hslider-track') as HTMLElement;
  const fill = host.querySelector('.ahd-hslider-fill') as HTMLElement;
  let dragging = false;
  let lastCall = 0;

  const set = (fraction: number) => {
    const f = Math.min(1, Math.max(0, fraction));
    fill.style.width = `${f * 100}%`;
  };

  const fractionFrom = (clientX: number): number => {
    const rect = track.getBoundingClientRect();
    const raw = (clientX - rect.left) / rect.width;
    const isRtl = getComputedStyle(host).direction === 'rtl';
    return Math.min(1, Math.max(0, isRtl ? 1 - raw : raw));
  };

  host.addEventListener('pointerdown', (e: PointerEvent) => {
    e.preventDefault();
    host.setPointerCapture?.(e.pointerId);
    dragging = true;
    const f = fractionFrom(e.clientX);
    set(f);
    lastCall = Date.now();
    options.onChange(f, false);
  });
  host.addEventListener('pointermove', (e: PointerEvent) => {
    if (!dragging) return;
    const f = fractionFrom(e.clientX);
    set(f);
    const now = Date.now();
    if (now - lastCall >= SLIDER_THROTTLE_MS) {
      lastCall = now;
      options.onChange(f, false);
    }
  });
  const finish = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    options.onChange(fractionFrom(e.clientX), true);
  };
  host.addEventListener('pointerup', finish);
  host.addEventListener('pointercancel', () => { dragging = false; });

  return { set, isDragging: () => dragging };
}
