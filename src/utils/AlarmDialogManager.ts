import { localize } from './LocalizationService';
import { getLiveHass, openDialogShell } from './DialogBase';

/**
 * Apple Home style dialog for alarm control panels.
 *
 * A tall vertical pill with the modes the panel supports (Home, Away, Night, ..., Off) and the
 * current one highlighted; tap another one to switch. Panels that need a code (`code_format`) get a
 * code field under the pill: it is required to disarm and, unless the panel says otherwise
 * (`code_arm_required`), to arm. Everything else stays in the native dialog behind the gear icon.
 */

// AlarmControlPanelEntityFeature bit flags.
const FEATURE_ARM_HOME = 1;
const FEATURE_ARM_AWAY = 2;
const FEATURE_ARM_NIGHT = 4;
const FEATURE_ARM_CUSTOM_BYPASS = 16;
const FEATURE_ARM_VACATION = 32;

/** After a tap, keep showing the chosen mode while the panel is arming / changing state. */
const OPTIMISTIC_HOLD_MS = 15000;

type AlarmMode = 'home' | 'away' | 'night' | 'vacation' | 'bypass' | 'off';

interface ModeDef {
  mode: AlarmMode;
  /** Home Assistant state the panel reports once the mode is active. */
  state: string;
  service: string;
  feature: number;
  label: string;
}

const MODES: ModeDef[] = [
  {
    mode: 'home',
    state: 'armed_home',
    service: 'alarm_arm_home',
    feature: FEATURE_ARM_HOME,
    label: 'alarm_dialog.home',
  },
  {
    mode: 'away',
    state: 'armed_away',
    service: 'alarm_arm_away',
    feature: FEATURE_ARM_AWAY,
    label: 'alarm_dialog.away',
  },
  {
    mode: 'night',
    state: 'armed_night',
    service: 'alarm_arm_night',
    feature: FEATURE_ARM_NIGHT,
    label: 'alarm_dialog.night',
  },
  {
    mode: 'vacation',
    state: 'armed_vacation',
    service: 'alarm_arm_vacation',
    feature: FEATURE_ARM_VACATION,
    label: 'alarm_dialog.vacation',
  },
  {
    mode: 'bypass',
    state: 'armed_custom_bypass',
    service: 'alarm_arm_custom_bypass',
    feature: FEATURE_ARM_CUSTOM_BYPASS,
    label: 'alarm_dialog.bypass',
  },
  { mode: 'off', state: 'disarmed', service: 'alarm_disarm', feature: 0, label: 'alarm_dialog.off' },
];

let stylesInjected = false;

function injectStyles(): void {
  if (stylesInjected) return;
  if (document.getElementById('ahd-alarm-styles')) {
    stylesInjected = true;
    return;
  }
  const style = document.createElement('style');
  style.id = 'ahd-alarm-styles';
  style.textContent = `
    .ahd-alarm-wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      padding: 8px 0 4px;
    }

    .ahd-alarm-pill {
      position: relative;
      width: 220px;
      border-radius: 40px;
      background: rgba(120, 120, 128, 0.28);
      padding: 6px;
      box-sizing: border-box;
    }

    .ahd-alarm-highlight {
      position: absolute;
      inset-inline: 6px;
      top: 6px;
      height: 68px;
      border-radius: 34px;
      background: rgba(28, 28, 32, 0.92);
      transition: transform 0.25s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.2s;
      opacity: 0;
      pointer-events: none;
    }

    .ahd-alarm-option {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 68px;
      border: none;
      background: none;
      color: #fff;
      font-size: 19px;
      cursor: pointer;
      z-index: 1;
    }

    .ahd-alarm-option + .ahd-alarm-option::before {
      content: '';
      position: absolute;
      top: 0;
      width: 100px;
      height: 1px;
      background: rgba(255, 255, 255, 0.18);
    }

    .ahd-alarm-option.next-to-selected::before,
    .ahd-alarm-option.selected::before {
      display: none;
    }

    .ahd-alarm-option:disabled {
      opacity: 0.4;
      cursor: default;
    }

    .ahd-alarm-code {
      width: 220px;
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

    .ahd-alarm-code::placeholder {
      color: rgba(255, 255, 255, 0.5);
    }

    .ahd-alarm-code.need {
      border-color: #ff453a;
      animation: ahd-alarm-shake 0.3s;
    }

    @keyframes ahd-alarm-shake {
      25% { transform: translateX(-6px); }
      75% { transform: translateX(6px); }
    }
  `;
  document.head.appendChild(style);
  stylesInjected = true;
}

export class AlarmDialogManager {
  static isSupported(entityId: string): boolean {
    return entityId.startsWith('alarm_control_panel.');
  }

  /** Modes the panel supports, in the order Apple shows them (Off last). */
  private static modesFor(stateObj: any): ModeDef[] {
    const features = (stateObj?.attributes?.supported_features as number) || 0;
    return MODES.filter((m) => m.feature === 0 || (features & m.feature) !== 0);
  }

  /** Status line: the mode name for the armed states, the regular status text for the rest. */
  private static subtitle(state: string | undefined): string {
    if (!state || state === 'unavailable' || state === 'unknown') return localize('status.unavailable');
    const mode = MODES.find((m) => m.state === state);
    if (mode) return localize(mode.label);
    return localize(`status.${state}`);
  }

  static open(hass: any, entityId: string): void {
    const initial = hass?.states?.[entityId];
    if (!initial) return;
    injectStyles();

    let currentHass = hass;
    let chosen: { mode: AlarmMode; at: number } | null = null;
    let refresh: () => void = () => {};
    const shell = openDialogShell(hass, entityId, {
      settingsAtBottom: true,
      onTick: (h) => {
        currentHass = getLiveHass(h);
        refresh();
      },
    });
    if (!shell) return;

    const stateOf = () => currentHass?.states?.[entityId];
    const modes = AlarmDialogManager.modesFor(initial);
    const codeFormat = initial.attributes?.code_format as string | null | undefined;
    const armNeedsCode = !!codeFormat && initial.attributes?.code_arm_required !== false;

    shell.body.innerHTML = `
      <div class="ahd-alarm-wrap">
        <div class="ahd-alarm-pill">
          <div class="ahd-alarm-highlight"></div>
        </div>
      </div>
    `;
    const wrap = shell.body.querySelector('.ahd-alarm-wrap') as HTMLElement;
    const pill = shell.body.querySelector('.ahd-alarm-pill') as HTMLElement;
    const highlight = shell.body.querySelector('.ahd-alarm-highlight') as HTMLElement;

    let codeInput: HTMLInputElement | null = null;
    if (codeFormat) {
      codeInput = document.createElement('input');
      codeInput.className = 'ahd-alarm-code';
      codeInput.type = 'password';
      codeInput.autocomplete = 'off';
      if (codeFormat === 'number') codeInput.inputMode = 'numeric';
      codeInput.placeholder = localize('alarm_dialog.code');
      wrap.appendChild(codeInput);
    }

    const buttons = new Map<AlarmMode, HTMLButtonElement>();
    modes.forEach((m) => {
      const btn = document.createElement('button');
      btn.className = 'ahd-alarm-option';
      btn.textContent = localize(m.label);
      btn.addEventListener('click', () => {
        const needsCode = !!codeInput && (m.mode === 'off' || armNeedsCode);
        const code = codeInput?.value.trim() || '';
        if (needsCode && !code) {
          codeInput!.classList.remove('need');
          void codeInput!.offsetWidth; // restart the shake animation
          codeInput!.classList.add('need');
          codeInput!.focus();
          return;
        }
        chosen = { mode: m.mode, at: Date.now() };
        currentHass.callService('alarm_control_panel', m.service, {
          entity_id: entityId,
          ...(code ? { code } : {}),
        });
        refresh();
      });
      buttons.set(m.mode, btn);
      pill.appendChild(btn);
    });
    codeInput?.addEventListener('input', () => codeInput!.classList.remove('need'));

    /** The mode to highlight: the one just tapped while the panel catches up, else the reported one. */
    const currentMode = (): AlarmMode | null => {
      const state = stateOf()?.state as string | undefined;
      const reported = MODES.find((m) => m.state === state)?.mode ?? null;
      if (chosen) {
        const expired = Date.now() - chosen.at > OPTIMISTIC_HOLD_MS;
        const reachedOrFailed = reported === chosen.mode || (reported !== null && Date.now() - chosen.at > 3000);
        if (!expired && !reachedOrFailed) return chosen.mode;
        chosen = null;
      }
      return reported;
    };

    refresh = () => {
      const st = stateOf();
      const unavailable = !st || st.state === 'unavailable' || st.state === 'unknown';
      shell.setSubtitle(AlarmDialogManager.subtitle(st?.state));
      const selected = currentMode();
      const index = modes.findIndex((m) => m.mode === selected);
      highlight.style.opacity = index >= 0 ? '1' : '0';
      if (index >= 0) highlight.style.transform = `translateY(${index * 68}px)`;
      modes.forEach((m, i) => {
        const btn = buttons.get(m.mode)!;
        btn.disabled = unavailable;
        btn.classList.toggle('selected', i === index);
        btn.classList.toggle('next-to-selected', index >= 0 && i === index + 1);
      });
    };
    refresh();
  }
}
