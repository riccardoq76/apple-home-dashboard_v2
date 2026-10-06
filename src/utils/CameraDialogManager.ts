import { localize } from './LocalizationService';
import { dispatchNativeMoreInfo, openDialogShell } from './DialogBase';

/**
 * Apple Home style camera dialog.
 *
 * Full-screen dark view on phones and a large centered card from 600px up, like the real app:
 * name and "live" status at the top, mute and a "..." menu (Picture in Picture, camera settings)
 * at the top right, the video in the middle and, at the bottom left, the button that shows the
 * accessories in the same room as the camera (lights, switches, locks...) as quick-toggle cards.
 *
 * The live view is Home Assistant's own `picture-entity` card in `live` mode, created through
 * `loadCardHelpers()`: it already handles HLS / WebRTC and falls back to a refreshing still image
 * when the camera has no stream, so none of that is reimplemented here. If the card helpers are not
 * available (an old frontend, the local harness) a plain image refreshed every few seconds is shown.
 * Mute and Picture in Picture act on the `<video>` element inside that card (not available for
 * still images). The recordings timeline and the clips list of the real app have no generic
 * Home Assistant equivalent and are left out.
 */

// CameraEntityFeature.STREAM
const FEATURE_STREAM = 2;

const FALLBACK_REFRESH_TICKS = 3;

/** Domains shown in the "nearby accessories" panel. */
const NEARBY_DOMAINS = [
  'alarm_control_panel',
  'light',
  'switch',
  'lock',
  'cover',
  'fan',
  'climate',
  'media_player',
  'humidifier',
];

let stylesInjected = false;

function injectStyles(): void {
  if (stylesInjected) return;
  if (document.getElementById('ahd-camera-styles')) {
    stylesInjected = true;
    return;
  }
  const style = document.createElement('style');
  style.id = 'ahd-camera-styles';
  style.textContent = `
    .ahd-cam-view {
      position: relative;
      width: 100%;
      aspect-ratio: 16 / 9;
      border-radius: 0;
      overflow: hidden;
      background: #000;
      display: flex;
      align-items: center;
      justify-content: center;
      --ha-card-background: transparent;
      --ha-card-border-radius: 0;
      --ha-card-box-shadow: none;
      --ha-card-border-width: 0;
    }

    .ahd-cam-view > * {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }

    .ahd-cam-view > img {
      z-index: 0;
    }

    .ahd-cam-view > :not(img) {
      z-index: 1;
    }

    .ahd-cam-view img {
      object-fit: contain;
      display: block;
    }

    .ahd-cam-off {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: rgba(255, 255, 255, 0.6);
      font-size: 15px;
    }

    .ahd-cam-off ha-icon {
      --mdc-icon-size: 40px;
    }

    .ahd-cam-bar {
      z-index: 3;
      pointer-events: none;
      position: absolute;
      inset: auto 0 0 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .ahd-cam-round-btn {
      pointer-events: auto;
      width: 56px;
      height: 56px;
      border: none;
      border-radius: 50%;
      background: rgba(120, 120, 128, 0.32);
      color: #fff;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .ahd-cam-nearby {
      position: absolute;
      inset-inline: -8px;
      bottom: -8px;
      height: 60%;
      display: none;
      flex-direction: column;
      border-radius: 34px;
      background: rgba(44, 44, 48, 0.88);
      backdrop-filter: blur(30px) saturate(1.4);
      -webkit-backdrop-filter: blur(30px) saturate(1.4);
      box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.4);
      padding: 10px 16px 16px;
      box-sizing: border-box;
      z-index: 4;
    }

    .ahd-cam-nearby.open {
      display: flex;
    }

    .ahd-cam-sheet-handle {
      width: 44px;
      height: 5px;
      border-radius: 3px;
      background: rgba(255, 255, 255, 0.35);
      margin: 0 auto 10px;
      flex-shrink: 0;
    }

    .ahd-cam-sheet-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
      flex-shrink: 0;
    }

    .ahd-cam-done {
      width: 44px;
      height: 44px;
      border: none;
      border-radius: 50%;
      background: #ff9f0a;
      color: #fff;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .ahd-cam-nearby-empty {
      grid-column: 1 / -1;
      margin: 8px 0;
      color: rgba(255, 255, 255, 0.65);
      font-size: 15px;
      line-height: 1.4;
    }

    .ahd-cam-nearby-title {
      margin: 0;
      font-size: 20px;
      font-weight: 600;
    }

    .ahd-cam-nearby-grid apple-home-card {
      display: block;
      height: 84px;
      border-radius: 22px;
      overflow: hidden;
      --apple-card-radius: 22px;
    }

    .ahd-cam-nearby-grid {
      overflow-y: auto;
      flex: 1;
      min-height: 0;
      align-content: start;
    }

    .ahd-cam-nearby-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 12px;
    }

    .ahd-cam-menu {
      position: absolute;
      top: 64px;
      inset-inline-end: 16px;
      min-width: 230px;
      border-radius: 22px;
      background: rgba(58, 58, 62, 0.96);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
      padding: 6px 0;
      z-index: 5;
      display: none;
    }

    .ahd-cam-menu.open {
      display: block;
    }

    .ahd-cam-menu-item {
      display: flex;
      align-items: center;
      gap: 14px;
      width: 100%;
      padding: 14px 20px;
      border: none;
      background: none;
      color: #fff;
      font-size: 17px;
      text-align: start;
      cursor: pointer;
    }

    .ahd-cam-menu-item + .ahd-cam-menu-item {
      border-top: 1px solid rgba(255, 255, 255, 0.12);
    }

    @media (min-width: 600px) {
      .ahd-cam-bar {
        position: relative;
        margin-top: 16px;
      }

      .ahd-cam-nearby {
        inset-inline: 0;
        bottom: 72px;
        height: auto;
        max-height: 75%;
        border-radius: 22px;
      }

      .ahd-cam-menu {
        top: 72px;
        inset-inline-end: 24px;
      }
    }
  `;
  document.head.appendChild(style);
  stylesInjected = true;
}

function pictureUrl(hass: any, stateObj: any): string {
  const picture = stateObj?.attributes?.entity_picture as string | undefined;
  if (!picture) return '';
  const base = typeof hass?.hassUrl === 'function' ? hass.hassUrl(picture) : picture;
  return `${base}${base.includes('?') ? '&' : '?'}_t=${Date.now()}`;
}

function isUnavailable(stateObj: any): boolean {
  const s = stateObj?.state;
  return !s || s === 'unavailable' || s === 'unknown';
}

/** First element matching `selector`, looking through nested shadow roots. */
function deepFind(root: ParentNode, selector: string): HTMLElement | null {
  const direct = root.querySelector(selector) as HTMLElement | null;
  if (direct) return direct;
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (el.shadowRoot) {
      const found = deepFind(el.shadowRoot, selector);
      if (found) return found;
    }
  }
  return null;
}

export class CameraDialogManager {
  static isSupported(entityId: string): boolean {
    return entityId.startsWith('camera.');
  }

  private static areaOf(hass: any, entityId: string): string | undefined {
    const entry = hass?.entities?.[entityId];
    return entry?.area_id || hass?.devices?.[entry?.device_id]?.area_id || undefined;
  }

  /** Area of the camera: from the display registry, else asking the entity registry directly. */
  private static async resolveArea(hass: any, entityId: string): Promise<string | undefined> {
    const known = CameraDialogManager.areaOf(hass, entityId);
    if (known) return known;
    try {
      const entry = await hass.callWS({ type: 'config/entity_registry/get', entity_id: entityId });
      return entry?.area_id || hass?.devices?.[entry?.device_id]?.area_id || undefined;
    } catch {
      return undefined;
    }
  }

  /** Controllable, visible entities in an area. */
  private static nearbyEntities(hass: any, area: string): string[] {
    return Object.keys(hass.entities || {}).filter((id) => {
      const entry = hass.entities[id];
      return (
        NEARBY_DOMAINS.includes(id.split('.')[0]) &&
        !entry.hidden &&
        !entry.entity_category &&
        hass.states?.[id] &&
        CameraDialogManager.areaOf(hass, id) === area
      );
    });
  }

  static open(hass: any, entityId: string): void {
    if (!hass?.states?.[entityId]) return;
    injectStyles();

    let currentHass = hass;
    let ticks = 0;
    let refresh: () => void = () => {};
    const nearbyCards: any[] = [];
    const shell = openDialogShell(hass, entityId, {
      fullscreen: true,
      settingsIcon: 'mdi:dots-horizontal',
      onSettings: () => menu.classList.toggle('open'),
      onTick: (h) => {
        currentHass = h;
        ticks++;
        refresh();
      },
    });
    if (!shell) return;

    shell.body.innerHTML = `
      <div class="ahd-cam-view"></div>
      <div class="ahd-cam-nearby">
        <div class="ahd-cam-sheet-handle"></div>
        <div class="ahd-cam-sheet-head">
          <p class="ahd-cam-nearby-title"></p>
          <button class="ahd-cam-done"><ha-icon icon="mdi:check"></ha-icon></button>
        </div>
        <div class="ahd-cam-nearby-grid"></div>
      </div>
      <div class="ahd-cam-bar">
        <button class="ahd-cam-round-btn ahd-cam-nearby-btn"><ha-icon icon="mdi:view-grid"></ha-icon></button>
      </div>
    `;
    const view = shell.body.querySelector('.ahd-cam-view') as HTMLElement;
    const nearby = shell.body.querySelector('.ahd-cam-nearby') as HTMLElement;
    const nearbyBtn = shell.body.querySelector('.ahd-cam-nearby-btn') as HTMLElement;
    (shell.body.querySelector('.ahd-cam-nearby-title') as HTMLElement).textContent = localize(
      'camera_dialog.nearby_accessories'
    );

    // --- "..." menu: Picture in Picture and camera settings -------------------------------------
    const menu = document.createElement('div');
    menu.className = 'ahd-cam-menu';
    menu.innerHTML = `
      <button class="ahd-cam-menu-item pip"><ha-icon icon="mdi:picture-in-picture-bottom-right"></ha-icon><span></span></button>
      <button class="ahd-cam-menu-item settings"><ha-icon icon="mdi:cog-outline"></ha-icon><span></span></button>
    `;
    (menu.querySelector('.pip span') as HTMLElement).textContent = localize('camera_dialog.pip');
    (menu.querySelector('.settings span') as HTMLElement).textContent = localize('camera_dialog.settings');
    shell.content.appendChild(menu);
    shell.content.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (!menu.contains(t) && !shell.settingsButton.contains(t)) menu.classList.remove('open');
    });

    const findVideo = () => deepFind(view, 'video') as HTMLVideoElement | null;

    menu.querySelector('.pip')!.addEventListener('click', async () => {
      menu.classList.remove('open');
      const video = findVideo() as any;
      try {
        if (document.pictureInPictureElement) await (document as any).exitPictureInPicture();
        else if (video?.requestPictureInPicture) await video.requestPictureInPicture();
      } catch {
        // Not allowed or not supported for this stream: nothing to do.
      }
    });
    menu.querySelector('.settings')!.addEventListener('click', () => {
      shell.close();
      dispatchNativeMoreInfo(entityId);
    });

    // --- Mute ----------------------------------------------------------------------------------
    const muteBtn = shell.addHeaderButton('mdi:volume-off', () => {
      const video = findVideo();
      if (video) video.muted = !video.muted;
      updateMute();
    });
    const updateMute = () => {
      const video = findVideo();
      if (video) muteBtn.style.removeProperty('display');
      else muteBtn.style.setProperty('display', 'none', 'important');
      const icon = muteBtn.querySelector('ha-icon');
      if (video && icon) icon.setAttribute('icon', video.muted ? 'mdi:volume-off' : 'mdi:volume-high');
      const pip = menu.querySelector('.pip') as HTMLElement;
      pip.style.display = video && (document as any).pictureInPictureEnabled ? '' : 'none';
    };

    const stateOf = () => currentHass?.states?.[entityId];

    // --- Live view -----------------------------------------------------------------------------
    let liveCard: any = null;
    let fallbackImg: HTMLImageElement | null = null;
    let renderToken = 0;

    const showOff = () => {
      liveCard = null;
      fallbackImg = null;
      view.innerHTML = `
        <div class="ahd-cam-off">
          <ha-icon icon="mdi:camera-off"></ha-icon>
          <span>${localize('camera_dialog.unavailable')}</span>
        </div>`;
    };

    // A still image sits under the live card: it is what you see while the stream is starting
    // (cameras like Eufy can take many seconds) and when it never starts.
    const showFallbackImage = () => {
      liveCard = null;
      view.innerHTML = '<img class="ahd-cam-still" alt="" />';
      fallbackImg = view.querySelector('img');
      fallbackImg!.src = pictureUrl(currentHass, stateOf());
    };

    const renderView = async () => {
      const token = ++renderToken;
      if (isUnavailable(stateOf())) {
        showOff();
        return;
      }
      const helpersLoader = (window as any).loadCardHelpers;
      if (typeof helpersLoader !== 'function') {
        showFallbackImage();
        return;
      }
      try {
        const helpers = await helpersLoader();
        const card = await helpers.createCardElement({
          type: 'picture-entity',
          entity: entityId,
          camera_image: entityId,
          camera_view: 'live',
          fit_mode: 'contain',
          show_name: false,
          show_state: false,
          tap_action: { action: 'none' },
          hold_action: { action: 'none' },
        });
        // The dialog may have been closed while the helpers were loading.
        if (token !== renderToken || !view.isConnected) return;
        card.hass = currentHass;
        showFallbackImage();
        view.appendChild(card);
        liveCard = card;
      } catch {
        if (token === renderToken) showFallbackImage();
      }
    };

    // --- Nearby accessories --------------------------------------------------------------------
    // The button is always there, like in the real app; the panel explains when there is nothing to show.
    const grid = shell.body.querySelector('.ahd-cam-nearby-grid') as HTMLElement;
    let nearbyBuilt = false;
    const buildNearby = async () => {
      if (nearbyBuilt) return;
      nearbyBuilt = true;
      const area = await CameraDialogManager.resolveArea(hass, entityId);
      const ids = area ? CameraDialogManager.nearbyEntities(hass, area) : [];
      if (ids.length === 0) {
        grid.innerHTML = '<p class="ahd-cam-nearby-empty"></p>';
        (grid.firstElementChild as HTMLElement).textContent = localize(
          area ? 'camera_dialog.no_nearby' : 'camera_dialog.no_area'
        );
        return;
      }
      ids.forEach((id) => {
        const card: any = document.createElement('apple-home-card');
        card.setConfig({
          type: 'custom:apple-home-card',
          entity: id,
          name: hass.states[id].attributes?.friendly_name || id,
        });
        card.hass = currentHass;
        nearbyCards.push(card);
        grid.appendChild(card);
      });
    };
    nearbyBtn.addEventListener('click', () => {
      nearby.classList.toggle('open');
      buildNearby();
    });
    shell.body.querySelector('.ahd-cam-done')!.addEventListener('click', () => nearby.classList.remove('open'));

    // --- Status line ---------------------------------------------------------------------------
    /** True once a `<video>` is really playing (the stream started). */
    const isPlaying = () => {
      const v = findVideo();
      return !!v && !v.paused && v.readyState >= 2;
    };

    const updateSubtitle = () => {
      const st = stateOf();
      if (isUnavailable(st)) {
        shell.setSubtitle(localize('camera_dialog.unavailable'));
      } else if (
        liveCard ? isPlaying() : (((st?.attributes?.supported_features as number) || 0) & FEATURE_STREAM) !== 0
      ) {
        shell.setSubtitle(localize('camera_dialog.live'));
      } else {
        shell.setSubtitle(localize('camera_dialog.snapshot'));
      }
    };

    refresh = () => {
      const st = stateOf();
      if (!st) return;
      // The camera went (un)available while the dialog is open: rebuild the view.
      if (isUnavailable(st) !== !!view.querySelector('.ahd-cam-off')) renderView();
      if (liveCard) liveCard.hass = currentHass;
      if (fallbackImg) {
        // Hide the still once the video plays; keep it fresh while it is what the user sees.
        const playing = liveCard ? isPlaying() : false;
        fallbackImg.style.display = playing ? 'none' : '';
        if (!playing && ticks % FALLBACK_REFRESH_TICKS === 0) fallbackImg.src = pictureUrl(currentHass, st);
      }
      nearbyCards.forEach((c) => {
        c.hass = currentHass;
      });
      updateSubtitle();
      updateMute();
    };

    updateSubtitle();
    updateMute();
    renderView();
  }
}
