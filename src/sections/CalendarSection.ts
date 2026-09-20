import { CustomizationManager } from '../utils/CustomizationManager';
import { localize } from '../utils/LocalizationService';
import { navigateToDashboardPath } from '../utils/Navigation';

export interface CalendarEvent {
  calendarId: string;
  calendarName: string;
  color: string;
  title: string;
  location?: string;
  start: Date;
  end: Date;
  allDay: boolean;
}

// One color per selected calendar, in selection order
const CALENDAR_COLORS = ['#0A84FF', '#30D158', '#FF9F0A', '#BF5AF2', '#FF453A', '#64D2FF'];
const HOME_DAYS = 3;
const PAGE_DAYS = 30;
const MAX_HOME_EVENTS = 5;
const CACHE_TTL = 5 * 60 * 1000;

export class CalendarSection {
  private customizationManager: CustomizationManager;
  private cache: Map<string, { events: any[]; timestamp: number }> = new Map();

  constructor(customizationManager: CustomizationManager) {
    this.customizationManager = customizationManager;
  }

  static getAvailableCalendars(hass: any): { entityId: string; name: string }[] {
    return Object.keys(hass?.states || {})
      .filter(id => id.startsWith('calendar.'))
      .map(id => ({ entityId: id, name: hass.states[id].attributes?.friendly_name || id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async hasCalendars(hass: any): Promise<boolean> {
    const selected = await this.customizationManager.getCalendarEntities();
    return selected.some(id => !!hass.states[id]);
  }

  async render(container: HTMLElement, hass: any, context: 'home' | 'page' = 'home'): Promise<void> {
    const selected = (await this.customizationManager.getCalendarEntities()).filter(id => !!hass.states[id]);
    if (selected.length === 0) return;

    this.injectStyles(container);

    const card = document.createElement('div');
    card.className = `apple-calendar-card${context === 'page' ? ' calendar-page-card' : ''}`;
    if (context === 'home') {
      card.addEventListener('click', () => navigateToDashboardPath('calendar'));
    }

    // The page already has the "Calendar" title, so only the home card needs a header
    if (context === 'home') {
      const header = document.createElement('div');
      header.className = 'calendar-header';
      header.innerHTML = `
        <div class="calendar-header-left">
          <ha-icon icon="mdi:calendar-month" class="calendar-header-icon"></ha-icon>
          <span class="calendar-label">${localize('section_titles.calendar')}</span>
        </div>`;
      card.appendChild(header);
    }

    const body = document.createElement('div');
    body.className = 'calendar-body';
    body.innerHTML = `<div class="calendar-empty">…</div>`;
    card.appendChild(body);
    container.appendChild(card);

    // Fill in after the fetch so a slow calendar never blocks the rest of the page
    const days = context === 'page' ? PAGE_DAYS : HOME_DAYS;
    const events = await this.fetchEvents(hass, selected, days);
    if (!card.isConnected) return;
    this.renderEvents(body, events, hass, context);
  }

  private async fetchEvents(hass: any, calendarIds: string[], days: number): Promise<CalendarEvent[]> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + days * 24 * 3600 * 1000);
    const now = Date.now();

    const perCalendar = await Promise.all(calendarIds.map(async (id, index) => {
      const cacheKey = `${id}|${days}`;
      const cached = this.cache.get(cacheKey);
      let raw: any[];
      if (cached && now - cached.timestamp < CACHE_TTL) {
        raw = cached.events;
      } else {
        try {
          raw = await hass.callApi('GET', `calendars/${id}?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`);
          this.cache.set(cacheKey, { events: raw, timestamp: now });
        } catch (error) {
          console.error(`🏠 APPLE HOME: Failed to load calendar ${id}:`, error);
          raw = cached?.events || [];
        }
      }
      const name = hass.states[id]?.attributes?.friendly_name || id;
      const color = CALENDAR_COLORS[index % CALENDAR_COLORS.length];
      return (raw || []).map(e => this.toEvent(e, id, name, color)).filter((e): e is CalendarEvent => !!e);
    }));

    // Drop events that already ended, then sort by start (all-day first within a day)
    return perCalendar.flat()
      .filter(e => e.end.getTime() > now)
      .sort((a, b) => a.start.getTime() - b.start.getTime() || Number(b.allDay) - Number(a.allDay));
  }

  private toEvent(raw: any, calendarId: string, calendarName: string, color: string): CalendarEvent | null {
    const startValue = raw?.start?.dateTime || raw?.start?.date;
    const endValue = raw?.end?.dateTime || raw?.end?.date;
    if (!startValue || !endValue) return null;

    const allDay = !raw.start.dateTime;
    // Date-only values are local days; `new Date('2026-09-21')` would parse them as UTC
    const parse = (value: string, dateOnly: boolean) => dateOnly ? new Date(`${value}T00:00:00`) : new Date(value);
    return {
      calendarId, calendarName, color,
      title: raw.summary || localize('calendar.no_title'),
      location: raw.location || undefined,
      start: parse(startValue, allDay),
      end: parse(endValue, allDay),
      allDay,
    };
  }

  private renderEvents(body: HTMLElement, events: CalendarEvent[], hass: any, context: 'home' | 'page'): void {
    body.innerHTML = '';
    const locale = hass.locale?.language || hass.language || 'en';

    if (events.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'calendar-empty';
      empty.textContent = localize('calendar.no_events');
      body.appendChild(empty);
      return;
    }

    const visible = context === 'home' ? events.slice(0, MAX_HOME_EVENTS) : events;
    const timeFormat = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: hass.locale?.time_format === '12' });

    let lastDay = '';
    for (const event of visible) {
      // Multi-day events that already started show up under today
      const displayDay = event.start.getTime() < Date.now() ? new Date() : event.start;
      const dayKey = displayDay.toDateString();
      if (dayKey !== lastDay) {
        lastDay = dayKey;
        const dayLabel = document.createElement('div');
        dayLabel.className = 'calendar-day';
        dayLabel.textContent = this.formatDay(displayDay, locale);
        body.appendChild(dayLabel);
      }

      const row = document.createElement('div');
      row.className = 'calendar-event';
      row.style.setProperty('--calendar-color', event.color);
      row.innerHTML = `
        <span class="calendar-event-bar"></span>
        <div class="calendar-event-text">
          <span class="calendar-event-title"></span>
          <span class="calendar-event-sub"></span>
        </div>
        <span class="calendar-event-time"></span>`;
      // textContent: event titles come from external calendars and must never be parsed as markup
      row.querySelector('.calendar-event-title')!.textContent = event.title;
      row.querySelector('.calendar-event-sub')!.textContent = [event.location, event.calendarName].filter(Boolean).join(' · ');
      row.querySelector('.calendar-event-time')!.textContent = event.allDay
        ? localize('calendar.all_day')
        : `${timeFormat.format(event.start)}`;
      body.appendChild(row);
    }

    if (context === 'home' && events.length > visible.length) {
      const more = document.createElement('div');
      more.className = 'calendar-more';
      more.textContent = `+${events.length - visible.length}`;
      body.appendChild(more);
    }
  }

  private formatDay(date: Date, locale: string): string {
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diffDays = Math.round((startOfDay(date) - startOfDay(new Date())) / (24 * 3600 * 1000));
    if (diffDays === 0) return localize('calendar.today');
    if (diffDays === 1) return localize('calendar.tomorrow');
    return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
  }

  private injectStyles(container: HTMLElement): void {
    const shadowRoot = container.getRootNode() as ShadowRoot;
    if (!shadowRoot || !(shadowRoot instanceof ShadowRoot)) return;
    if (shadowRoot.querySelector('#apple-calendar-section-styles')) return;

    const style = document.createElement('style');
    style.id = 'apple-calendar-section-styles';
    style.textContent = `
      .apple-calendar-card {
        border-radius: var(--apple-card-radius, 22px);
        padding: 16px 20px;
        margin-top: 20px;
        color: white;
        cursor: pointer;
        position: relative;
        overflow: hidden;
        background: var(--apple-card-bg-inactive, rgba(0, 0, 0, 0.3));
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.08);
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
        font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif;
        transition: transform 0.2s ease;
        -webkit-tap-highlight-color: transparent;
      }
      .apple-calendar-card:active { transform: scale(0.99); }
      .apple-calendar-card.calendar-page-card { cursor: default; margin-top: 6px; }
      .apple-calendar-card.calendar-page-card:active { transform: none; }

      .calendar-header { display: flex; justify-content: space-between; align-items: center; }
      .calendar-header-left { display: flex; align-items: center; gap: 8px; }
      .calendar-header-icon { --mdc-icon-size: 22px; color: #FF453A; }
      .calendar-label { font-size: 15px; font-weight: 600; }

      .calendar-body { margin-top: 8px; }
      .calendar-page-card .calendar-body { margin-top: 0; }
      .calendar-page-card .calendar-day:first-child { margin-top: 4px; }
      .calendar-day {
        margin: 12px 0 4px;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.4px;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.55);
      }
      .calendar-event {
        display: grid;
        grid-template-columns: 4px minmax(0, 1fr) auto;
        align-items: center;
        gap: 12px;
        padding: 6px 0;
      }
      .calendar-event-bar {
        align-self: stretch;
        border-radius: 2px;
        background: var(--calendar-color, #0A84FF);
      }
      .calendar-event-text { display: flex; flex-direction: column; min-width: 0; }
      .calendar-event-title, .calendar-event-sub {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .calendar-event-title { font-size: 15px; font-weight: 500; }
      .calendar-event-sub { font-size: 12px; color: rgba(255, 255, 255, 0.55); }
      .calendar-event-sub:empty { display: none; }
      .calendar-event-time {
        font-size: 14px;
        color: rgba(255, 255, 255, 0.75);
        font-variant-numeric: tabular-nums;
      }
      .calendar-empty, .calendar-more {
        padding: 8px 0 2px;
        font-size: 14px;
        color: rgba(255, 255, 255, 0.55);
      }
    `;
    shadowRoot.appendChild(style);
  }
}
