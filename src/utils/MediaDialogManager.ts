import { localize } from './LocalizationService';
import { createHSlider, openDialogShell } from './DialogBase';

/**
 * Apple Home style "now playing" dialog for media players.
 *
 * Artwork, title and artist, a seekable progress bar with elapsed and remaining time,
 * previous / play-pause / next and a volume slider. Every control only shows when the player
 * declares the matching feature, so a speaker without seek or volume simply has no bar.
 * Sources, sound modes, grouping and the like stay in the native dialog behind the gear icon.
 */

// MediaPlayerEntityFeature bit flags.
const FEATURE_PAUSE = 1;
const FEATURE_SEEK = 2;
const FEATURE_VOLUME_SET = 4;
const FEATURE_PREVIOUS_TRACK = 16;
const FEATURE_NEXT_TRACK = 32;
const FEATURE_TURN_ON = 128;
const FEATURE_STOP = 4096;
const FEATURE_PLAY = 16384;

const VOLUME_CALL_THROTTLE_MS = 200;
const OPTIMISTIC_HOLD_MS = 1500;

let stylesInjected = false;

function injectStyles(): void {
  if (stylesInjected) return;
  if (document.getElementById('ahd-media-styles')) {
    stylesInjected = true;
    return;
  }
  const style = document.createElement('style');
  style.id = 'ahd-media-styles';
  style.textContent = `
    .ahd-media-art {
      width: min(100%, 44vh);
      aspect-ratio: 1 / 1;
      margin: 0 auto 20px;
      border-radius: 22px;
      background: rgba(120, 120, 128, 0.32);
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    }

    .ahd-media-art img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .ahd-media-art ha-icon {
      --mdc-icon-size: 72px;
      color: rgba(255, 255, 255, 0.5);
    }

    .ahd-media-title {
      font-size: 20px;
      font-weight: 600;
      margin: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ahd-media-artist {
      font-size: 17px;
      color: rgba(255, 255, 255, 0.6);
      margin: 2px 0 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-height: 22px;
    }

    .ahd-media-progress {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 12px;
      font-size: 13px;
      color: rgba(255, 255, 255, 0.6);
      font-variant-numeric: tabular-nums;
    }

    .ahd-media-progress .ahd-hslider {
      flex: 1;
    }

    .ahd-media-time {
      min-width: 38px;
    }

    .ahd-media-time.remaining {
      text-align: end;
    }

    .ahd-media-controls {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 36px;
      margin-top: 12px;
    }

    .ahd-media-btn {
      background: none;
      border: none;
      color: #ffffff;
      cursor: pointer;
      padding: 8px;
      border-radius: 50%;
      --mdc-icon-size: 44px;
      display: flex;
    }

    .ahd-media-btn:active {
      background: rgba(255, 255, 255, 0.15);
    }

    .ahd-media-btn.main {
      --mdc-icon-size: 64px;
    }

    [dir="rtl"] .ahd-media-btn ha-icon[icon="mdi:rewind"],
    [dir="rtl"] .ahd-media-btn ha-icon[icon="mdi:fast-forward"] {
      transform: scaleX(-1);
    }

    .ahd-media-volume {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 8px;
      color: rgba(255, 255, 255, 0.6);
      --mdc-icon-size: 22px;
    }

    .ahd-media-volume .ahd-hslider {
      flex: 1;
    }
  `;
  document.head.appendChild(style);
  stylesInjected = true;
}

function formatTime(totalSeconds: number): string {
  const t = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export class MediaDialogManager {
  static isSupported(entityId: string): boolean {
    return entityId.startsWith('media_player.');
  }

  static open(hass: any, entityId: string): void {
    if (!hass?.states?.[entityId]) return;
    injectStyles();

    let currentHass = hass;
    let refresh: () => void = () => {};
    const shell = openDialogShell(hass, entityId, {
      onTick: (h) => {
        currentHass = h;
        refresh();
      }
    });
    if (!shell) return;

    const stateObj = () => currentHass?.states?.[entityId];
    const features = () => (stateObj()?.attributes?.supported_features as number) || 0;
    const supports = (flag: number) => (features() & flag) !== 0;
    const call = (service: string, data: Record<string, unknown> = {}) =>
      currentHass.callService('media_player', service, { entity_id: entityId, ...data });

    shell.body.innerHTML = `
      <div class="ahd-media-art"><ha-icon icon="mdi:music"></ha-icon></div>
      <p class="ahd-media-title"></p>
      <p class="ahd-media-artist"></p>
      <div class="ahd-media-progress">
        <span class="ahd-media-time elapsed"></span>
        <div class="ahd-media-seek"></div>
        <span class="ahd-media-time remaining"></span>
      </div>
      <div class="ahd-media-controls">
        <button class="ahd-media-btn prev"><ha-icon icon="mdi:rewind"></ha-icon></button>
        <button class="ahd-media-btn main"><ha-icon icon="mdi:pause"></ha-icon></button>
        <button class="ahd-media-btn next"><ha-icon icon="mdi:fast-forward"></ha-icon></button>
      </div>
      <div class="ahd-media-volume">
        <ha-icon icon="mdi:volume-low"></ha-icon>
        <div class="ahd-media-vol"></div>
        <ha-icon icon="mdi:volume-high"></ha-icon>
      </div>
    `;
    const q = <T extends HTMLElement>(sel: string) => shell.body.querySelector(sel) as T;
    const artBox = q<HTMLElement>('.ahd-media-art');
    const titleEl = q<HTMLElement>('.ahd-media-title');
    const artistEl = q<HTMLElement>('.ahd-media-artist');
    const progressRow = q<HTMLElement>('.ahd-media-progress');
    const elapsedEl = q<HTMLElement>('.ahd-media-time.elapsed');
    const remainingEl = q<HTMLElement>('.ahd-media-time.remaining');
    const prevBtn = q<HTMLButtonElement>('.ahd-media-btn.prev');
    const mainBtn = q<HTMLButtonElement>('.ahd-media-btn.main');
    const nextBtn = q<HTMLButtonElement>('.ahd-media-btn.next');
    const volumeRow = q<HTMLElement>('.ahd-media-volume');

    let lastArtUrl = '';
    let lastVolumeCall = 0;
    let lastUserVolumeAt = 0;

    const duration = () => {
      const d = stateObj()?.attributes?.media_duration;
      return typeof d === 'number' && d > 0 ? d : null;
    };

    const livePosition = (): number | null => {
      const so = stateObj();
      const a = so?.attributes || {};
      if (typeof a.media_position !== 'number') return null;
      let pos = a.media_position;
      if (so.state === 'playing' && a.media_position_updated_at) {
        pos += (Date.now() - new Date(a.media_position_updated_at).getTime()) / 1000;
      }
      const d = duration();
      return d ? Math.min(d, Math.max(0, pos)) : Math.max(0, pos);
    };

    const seek = createHSlider(q<HTMLElement>('.ahd-media-seek'), {
      onChange: (fraction, final) => {
        const d = duration();
        if (!d || !final) return;
        call('media_seek', { seek_position: Math.round(fraction * d) });
      }
    });

    const volume = createHSlider(q<HTMLElement>('.ahd-media-vol'), {
      onChange: (fraction, final) => {
        lastUserVolumeAt = Date.now();
        const now = Date.now();
        if (!final && now - lastVolumeCall < VOLUME_CALL_THROTTLE_MS) return;
        lastVolumeCall = now;
        call('volume_set', { volume_level: Math.round(fraction * 100) / 100 });
      }
    });

    const statusText = (state: string): string => {
      const key = state === 'buffering' ? 'playing' : state;
      const translated = localize(`status.${key}`);
      return translated === `status.${key}` ? state : translated;
    };

    const artUrl = (): string => {
      const a = stateObj()?.attributes || {};
      const url: string = a.entity_picture_local || a.entity_picture || '';
      if (!url) return '';
      return typeof currentHass.hassUrl === 'function' ? currentHass.hassUrl(url) : url;
    };

    refresh = () => {
      const so = stateObj();
      if (!so) return;
      const a = so.attributes || {};
      const state: string = so.state;
      const isOff = state === 'off' || state === 'standby' || state === 'unavailable' || state === 'unknown';
      const isPlaying = state === 'playing' || state === 'buffering';

      shell.setSubtitle(statusText(state));

      const url = isOff ? '' : artUrl();
      if (url !== lastArtUrl) {
        lastArtUrl = url;
        if (url) {
          const img = document.createElement('img');
          img.alt = '';
          img.onerror = () => { artBox.innerHTML = '<ha-icon icon="mdi:music"></ha-icon>'; };
          img.src = url;
          artBox.innerHTML = '';
          artBox.appendChild(img);
        } else {
          artBox.innerHTML = '<ha-icon icon="mdi:music"></ha-icon>';
        }
      }

      titleEl.textContent = isOff ? '' : (a.media_title || a.app_name || localize('media_dialog.nothing_playing'));
      artistEl.textContent = isOff ? '' : (a.media_artist || a.media_series_title || a.media_album_name || '');

      const d = duration();
      const pos = livePosition();
      const showProgress = !isOff && d !== null && pos !== null;
      progressRow.style.display = showProgress ? '' : 'none';
      if (showProgress) {
        if (!seek.isDragging()) seek.set(pos! / d!);
        elapsedEl.textContent = formatTime(pos!);
        remainingEl.textContent = `-${formatTime(d! - pos!)}`;
      }
      q<HTMLElement>('.ahd-media-seek').style.pointerEvents = supports(FEATURE_SEEK) ? '' : 'none';

      prevBtn.style.display = !isOff && supports(FEATURE_PREVIOUS_TRACK) ? '' : 'none';
      nextBtn.style.display = !isOff && supports(FEATURE_NEXT_TRACK) ? '' : 'none';
      const canToggle = isOff ? (supports(FEATURE_TURN_ON) || supports(FEATURE_PLAY)) : true;
      mainBtn.style.display = canToggle && state !== 'unavailable' ? '' : 'none';
      (mainBtn.querySelector('ha-icon') as HTMLElement).setAttribute(
        'icon',
        isOff ? 'mdi:power' : isPlaying ? 'mdi:pause' : 'mdi:play'
      );

      const vol = a.volume_level;
      const showVolume = !isOff && supports(FEATURE_VOLUME_SET) && typeof vol === 'number';
      volumeRow.style.display = showVolume ? '' : 'none';
      if (showVolume && !volume.isDragging() && Date.now() - lastUserVolumeAt > OPTIMISTIC_HOLD_MS) {
        volume.set(vol);
      }
    };

    prevBtn.addEventListener('click', () => call('media_previous_track'));
    nextBtn.addEventListener('click', () => call('media_next_track'));
    mainBtn.addEventListener('click', () => {
      const state: string = stateObj()?.state;
      if (state === 'off' || state === 'standby') {
        call(supports(FEATURE_TURN_ON) ? 'turn_on' : 'media_play');
      } else if (state === 'playing' || state === 'buffering') {
        call(supports(FEATURE_PAUSE) ? 'media_pause' : supports(FEATURE_STOP) ? 'media_stop' : 'media_play_pause');
      } else {
        call(supports(FEATURE_PLAY) ? 'media_play' : 'media_play_pause');
      }
    });

    refresh();
  }
}
