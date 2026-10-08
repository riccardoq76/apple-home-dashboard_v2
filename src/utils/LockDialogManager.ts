import { localize } from './LocalizationService';
import { getLiveHass, openDialogShell } from './DialogBase';

/**
 * Apple Home style dialog for locks.
 *
 * A tall vertical toggle like the one of switches: the knob rests at the bottom with a green
 * closed padlock when the lock is locked, and slides to the top with an orange open padlock when it
 * is unlocked. Tap anywhere on it to lock / unlock. Locks that declare a `code_format` get a code
 * field under the toggle (required, the same way as in Home Assistant's own dialog). While the lock
 * is moving (locking / unlocking) the knob already shows where it is going. Everything else stays in
 * the native dialog behind the gear icon.
 */

/** After a tap, keep showing the chosen position while the lock catches up (locks can be slow). */
const OPTIMISTIC_HOLD_MS = 15000;

const LOCKED_COLOR = '#63d8c4';
const UNLOCKED_COLOR = '#ff9f0a';
const JAMMED_COLOR = '#ff453a';

let stylesInjected = false;

function injectStyles(): void {
  if (stylesInjected) return;
  if (document.getElementById('ahd-lock-styles')) {
    stylesInjected = true;
    return;
  }
  const style = document.createElement('style');
  style.id = 'ahd-lock-styles';
  style.textContent = `
    .ahd-lock-wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      margin-bottom: 8px;
    }

    .ahd-lock {
      position: relative;
      width: 140px;
      height: min(330px, 46vh);
      border-radius: 44px;
      background: rgba(120, 120, 128, 0.32);
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
    }

    .ahd-lock.unavailable {
      opacity: 0.4;
      pointer-events: none;
    }

    .ahd-lock-knob {
      position: absolute;
      left: 8px;
      right: 8px;
      height: calc(46% - 8px);
      top: 54%;
      border-radius: 36px;
      background: rgba(30, 30, 35, 0.75);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: top 0.25s cubic-bezier(0.32, 0.72, 0, 1), background 0.25s ease;
    }

    .ahd-lock.up .ahd-lock-knob {
      top: 8px;
      background: #f5f5f7;
    }

    .ahd-lock-knob ha-icon {
      --mdc-icon-size: 44px;
    }

    .ahd-lock-code {
      width: 180px;
      box-sizing: border-box;
      padding: 12px 16px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 16px;
      background: rgba(120, 120, 128, 0.22);
      color: #fff;
      font-size: 17px;
      text-align: center;
      outline: none;
    }

    .ahd-lock-code::placeholder {
      color: rgba(255, 255, 255, 0.5);
    }

    .ahd-lock-code.need {
      border-color: #ff453a;
      animation: ahd-lock-shake 0.3s;
    }

    @keyframes ahd-lock-shake {
      25% { transform: translateX(-6px); }
      75% { transform: translateX(6px); }
    }
  `;
  document.head.appendChild(style);
  stylesInjected = true;
}

export class LockDialogManager {
  static isSupported(entityId: string): boolean {
    return entityId.startsWith('lock.');
  }

  /** Status line: the lock's state, with the moving states spelled out. */
  private static subtitle(state: string | undefined): string {
    if (!state || state === 'unavailable' || state === 'unknown') return localize('status.unavailable');
    if (state === 'locking' || state === 'unlocking' || state === 'opening') return localize(`lock_dialog.${state}`);
    return localize(`status.${state}`);
  }

  static open(hass: any, entityId: string): void {
    const initial = hass?.states?.[entityId];
    if (!initial) return;
    injectStyles();

    let currentHass = hass;
    // 'lock' = the user asked for locked, 'unlock' = asked for unlocked.
    let chosen: { target: 'lock' | 'unlock'; at: number } | null = null;
    let refresh: () => void = () => {};
    const shell = openDialogShell(hass, entityId, {
      onTick: (h) => {
        currentHass = getLiveHass(h);
        refresh();
      },
    });
    if (!shell) return;

    const stateOf = () => currentHass?.states?.[entityId];
    const needsCode = !!initial.attributes?.code_format;

    shell.body.innerHTML = `
      <div class="ahd-lock-wrap">
        <div class="ahd-lock">
          <div class="ahd-lock-knob"><ha-icon icon="mdi:lock"></ha-icon></div>
        </div>
      </div>
    `;
    const wrap = shell.body.querySelector('.ahd-lock-wrap') as HTMLElement;
    const toggle = shell.body.querySelector('.ahd-lock') as HTMLElement;
    const icon = shell.body.querySelector('.ahd-lock-knob ha-icon') as HTMLElement;

    let codeInput: HTMLInputElement | null = null;
    if (needsCode) {
      codeInput = document.createElement('input');
      codeInput.className = 'ahd-lock-code';
      codeInput.type = 'password';
      codeInput.autocomplete = 'off';
      codeInput.placeholder = localize('alarm_dialog.code');
      codeInput.addEventListener('input', () => codeInput!.classList.remove('need'));
      wrap.appendChild(codeInput);
    }

    /** Where the knob should be: 'locked' (bottom) or 'unlocked' (top). */
    const visualPosition = (): 'locked' | 'unlocked' => {
      const state = stateOf()?.state as string | undefined;
      const reported = state === 'locked' || state === 'locking' || state === 'jammed' ? 'locked' : 'unlocked';
      if (chosen) {
        const target = chosen.target === 'lock' ? 'locked' : 'unlocked';
        const settled = state === 'locked' || state === 'unlocked' || state === 'open';
        const expired = Date.now() - chosen.at > OPTIMISTIC_HOLD_MS;
        // Done (the lock reports a settled state that is the target) or given up: trust the lock again.
        if (!expired && !(settled && reported === target)) return target;
        chosen = null;
      }
      return reported;
    };

    toggle.addEventListener('click', () => {
      const position = visualPosition();
      const code = codeInput?.value.trim() || '';
      if (needsCode && !code) {
        codeInput!.classList.remove('need');
        void codeInput!.offsetWidth; // restart the shake animation
        codeInput!.classList.add('need');
        codeInput!.focus();
        return;
      }
      const target = position === 'locked' ? 'unlock' : 'lock';
      chosen = { target, at: Date.now() };
      currentHass.callService('lock', target, {
        entity_id: entityId,
        ...(code ? { code } : {}),
      });
      refresh();
    });

    refresh = () => {
      const st = stateOf();
      const unavailable = !st || st.state === 'unavailable' || st.state === 'unknown';
      shell.setSubtitle(LockDialogManager.subtitle(st?.state));
      toggle.classList.toggle('unavailable', unavailable);
      const position = visualPosition();
      toggle.classList.toggle('up', position === 'unlocked');
      const jammed = st?.state === 'jammed';
      icon.setAttribute(
        'icon',
        jammed ? 'mdi:lock-alert' : position === 'locked' ? 'mdi:lock' : 'mdi:lock-open-variant'
      );
      icon.style.color = jammed ? JAMMED_COLOR : position === 'locked' ? LOCKED_COLOR : UNLOCKED_COLOR;
    };
    refresh();
  }
}
