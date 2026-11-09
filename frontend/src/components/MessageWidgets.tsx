import { memo, useEffect, useId, useState, type ReactElement, type ReactNode } from "react";
import type { ClockWidget, ConversionWidget, WeatherWidget, Widget } from "./api";

/** Cards above an assistant reply, from the backend's tools (backend/actions) */
export const MessageWidgets = memo(function MessageWidgets({
  widgets,
}: {
  widgets: Widget[];
}) {
  return (
    <div className="msg-widgets">
      {widgets.map((w, i) =>
        w.kind === "clock" ? (
          <ClockCard key={i} widget={w} />
        ) : w.kind === "weather" ? (
          <WeatherCard key={i} widget={w} />
        ) : w.kind === "conversion" ? (
          <ConversionCard key={i} widget={w} />
        ) : null,
      )}
    </div>
  );
});

/** The current time, ticking over on each minute */
function useMinute(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let interval: number | undefined;
    // Line up with the turn of the minute, then step a minute at a time
    const timeout = window.setTimeout(
      () => {
        setNow(new Date());
        interval = window.setInterval(() => setNow(new Date()), 60_000);
      },
      60_000 - (Date.now() % 60_000),
    );
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, []);
  return now;
}

/** Minutes ahead of UTC from "GMT+9", "GMT-3:30" or "GMT" */
function offsetMinutes(label: string): number {
  const match = label.match(/([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === "-" ? -minutes : minutes;
}

/** "14 hours ahead of you", "2 hours 30 minutes behind you", or "Same time as you" */
function gapText(minutes: number): string {
  if (minutes === 0) return "Same time as you";
  const hours = Math.floor(Math.abs(minutes) / 60);
  const rest = Math.abs(minutes) % 60;
  const amount =
    (hours ? `${hours} hour${hours === 1 ? "" : "s"}` : "") +
    (rest ? `${hours ? " " : ""}${rest} minutes` : "");
  return `${amount} ${minutes > 0 ? "ahead of" : "behind"} you`;
}

function readClock(now: Date, tz: string) {
  try {
    const part = (options: Intl.DateTimeFormatOptions, type: string) =>
      new Intl.DateTimeFormat("en-US", { timeZone: tz, ...options })
        .formatToParts(now)
        .find((p) => p.type === type)?.value ?? "";
    const time = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).formatToParts(now);
    const get = (type: string) => time.find((p) => p.type === type)?.value ?? "";
    const offsetLabel = part({ timeZoneName: "shortOffset" }, "timeZoneName");
    const offset = offsetMinutes(offsetLabel);
    return {
      hour: get("hour"),
      minute: get("minute"),
      period: get("dayPeriod"),
      hour24: Number(part({ hour: "numeric", hourCycle: "h23" }, "hour")),
      date: new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: "long",
        month: "long",
        day: "numeric",
      }).format(now),
      zone: part({ timeZoneName: "long" }, "timeZoneName"),
      utc: offsetLabel.replace("GMT", "UTC").replace(/^UTC$/, "UTC+0"),
      // The browser's own offset, so the gap stays right wherever the chat is opened
      gap: offset - -now.getTimezoneOffset(),
    };
  } catch {
    // An unknown zone name: no card rather than a wrong one
    return null;
  }
}

function ClockCard({ widget }: { widget: ClockWidget }) {
  const now = useMinute();
  const clock = readClock(now, widget.tz);
  if (!clock) return null;
  const isDay = clock.hour24 >= 6 && clock.hour24 < 18;
  const own = widget.place === "Your time";

  return (
    <div
      className={`clock-card${isDay ? " is-day" : " is-night"}`}
      role="group"
      aria-label={`Time in ${widget.place}: ${clock.hour}:${clock.minute} ${clock.period}, ${clock.date}`}
    >
      <div className="clock-card-head">
        <span className="clock-card-sky" aria-hidden="true">
          <SkyIcon sky="clear" night={!isDay} size={15} weight={2} />
        </span>
        <span className="clock-card-place">{widget.place}</span>
      </div>
      <div className="clock-card-time" aria-hidden="true">
        {clock.hour}
        <span className="clock-card-colon">:</span>
        {clock.minute}
        <span className="clock-card-period">{clock.period}</span>
      </div>
      <div className="clock-card-date">
        {clock.date}
        {!own && ` · ${gapText(clock.gap)}`}
      </div>
      <div className="clock-card-zone">
        {clock.zone} · {clock.utc}
      </div>
    </div>
  );
}

// ----- Weather -----

type Sky = "clear" | "partly" | "cloudy" | "fog" | "rain" | "snow" | "storm";

/** The sky a WMO weather code looks like */
function skyOf(code: number): Sky {
  if (code <= 1) return "clear";
  if (code === 2) return "partly";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  return "rain";
}

/** "Today", then "Mon", "Tue" from the place's own dates */
function dayLabel(date: string, index: number): string {
  if (index === 0) return "Today";
  // Noon UTC, so the weekday is the same in every browser zone
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
}

/** When the card was read, in the viewer's own time: "1:45 PM", or "Nov 8, 1:45 PM" on a later day */
function readAt(observed: string): string {
  const at = new Date(observed);
  if (Number.isNaN(at.getTime())) return "";
  const sameDay = at.toDateString() === new Date().toDateString();
  return at.toLocaleString("en-US", {
    ...(sameDay ? {} : { month: "short", day: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
}

function WeatherCard({ widget }: { widget: WeatherWidget }) {
  const sky = skyOf(widget.code);
  const today = widget.days[0];
  const at = readAt(widget.observed);

  return (
    <div
      className={`weather-card sky-${sky}${widget.day ? " is-day" : " is-night"}`}
      role="group"
      aria-label={`Weather in ${widget.place}: ${widget.temp} degrees, ${widget.condition}`}
    >
      <div className="weather-card-now">
        <div className="weather-card-where">
          <span className="weather-card-place">{widget.place}</span>
          {widget.region && <span className="weather-card-region">{widget.region}</span>}
        </div>
        <span className="weather-card-icon" aria-hidden="true">
          <FilledSkyIcon sky={sky} night={!widget.day} size={34} />
        </span>
      </div>

      <div className="weather-card-temp" aria-hidden="true">
        {widget.temp}
        <span className="weather-card-deg">°{widget.unit}</span>
      </div>
      <div className="weather-card-condition">{widget.condition}</div>
      <div className="weather-card-range">
        {today && `H ${today.high}° L ${today.low}° · `}Feels like {widget.feels}°
      </div>

      {widget.days.length > 0 && (
        <ul className="weather-card-days">
          {widget.days.map((d, i) => (
            <li key={d.date} className="weather-card-day">
              <span className="weather-card-day-name">{dayLabel(d.date, i)}</span>
              <FilledSkyIcon sky={skyOf(d.code)} size={22} />
              <span className="weather-card-day-temps">
                {d.high}°<span className="weather-card-low"> {d.low}°</span>
              </span>
              <span className="weather-card-day-rain">
                {d.rain ? `${d.rain}% ${skyOf(d.code) === "snow" ? "snow" : "rain"}` : "\u00a0"}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="weather-card-foot">
        Humidity {widget.humidity}% · Wind {widget.wind}
        {at && ` · As of ${at}`}
      </div>
    </div>
  );
}

// A cloud on its own, one raised to make room for what falls from it, and a small one in front of the sun
const CLOUD = "M7 18.5h9.5a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.4A3.3 3.3 0 0 0 7 18.5z";
const CLOUD_HIGH = "M7 14.5h9.5a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.4A3.3 3.3 0 0 0 7 14.5z";
const CLOUD_SMALL = "M8.5 19h8a3.4 3.4 0 0 0 .3-6.8 4.6 4.6 0 0 0-8.9 1.2A2.8 2.8 0 0 0 8.5 19z";

const SUN = (
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
  </>
);
const MOON = <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />;
const SMALL_SUN = (
  <>
    <circle cx="8.5" cy="8" r="3" />
    <path d="M8.5 2v1.2M3.4 3.9l.8.8M2.5 8h1.2M13.6 3.9l-.8.8" />
  </>
);
const SMALL_MOON = <path d="M11 7.5A3.6 3.6 0 0 1 6.3 2.8a3.6 3.6 0 1 0 4.7 4.7z" />;

const FALLING: Record<"fog" | "rain" | "snow" | "storm", ReactElement> = {
  fog: <path d="M4 18h16M6.5 21.5h11" />,
  rain: <path d="M8.5 17.5l-1 3M12.5 17.5l-1 3M16.5 17.5l-1 3" />,
  snow: <path d="M8 18h.01M12 18h.01M16 18h.01M10 21.5h.01M14 21.5h.01" strokeWidth="2.4" />,
  storm: <path d="M12.5 15.5l-2 3.5h3l-2 3.5" />,
};

/** The sun, the moon, clouds and what falls from them, drawn in the card's own color */
function SkyIcon({
  sky,
  night = false,
  size,
  weight = 1.8,
}: {
  sky: Sky;
  night?: boolean;
  size: number;
  weight?: number;
}) {
  return (
    <Icon size={size} weight={weight}>
      {sky === "clear" ? (
        night ? MOON : SUN
      ) : sky === "partly" ? (
        <>
          {night ? SMALL_MOON : SMALL_SUN}
          <path d={CLOUD_SMALL} />
        </>
      ) : sky === "cloudy" ? (
        <path d={CLOUD} />
      ) : (
        <>
          <path d={CLOUD_HIGH} />
          {FALLING[sky]}
        </>
      )}
    </Icon>
  );
}

// Filled shapes for the weather card: solid bodies, with a thin cut where the cloud covers the sun
const SUN_RAYS = "M12 2.4v1.1M12 20.5v1.1M2.4 12h1.1M20.5 12h1.1M5.2 5.2l.8.8M18 18l.8.8M5.2 18.8l.8-.8M18 6l.8-.8";
const SMALL_SUN_RAYS = "M8.5 1.8v.8M4.1 3.6l.6.6M2.3 8h.8M12.9 3.6l-.6.6";
const RAIN_DROP = (x: number, y: number) =>
  `M${x} ${y}c-.9 1.3-1.4 2.2-1.4 2.9a1.4 1.4 0 0 0 2.8 0c0-.7-.5-1.6-1.4-2.9z`;

const FILLED_FALLING: Record<"fog" | "rain" | "snow" | "storm", ReactElement> = {
  fog: <path d="M4 18h16M6.5 21.5h11" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />,
  rain: <path d={`${RAIN_DROP(8, 16.8)}${RAIN_DROP(12, 18.2)}${RAIN_DROP(16, 16.8)}`} />,
  snow: (
    <>
      <circle cx="8" cy="18" r="1.3" />
      <circle cx="12" cy="18" r="1.3" />
      <circle cx="16" cy="18" r="1.3" />
      <circle cx="10" cy="21.5" r="1.3" />
      <circle cx="14" cy="21.5" r="1.3" />
    </>
  ),
  storm: <path d="M13.4 15.6h-3.1l-1.7 4.1h2.5l-1 3.6 4.6-5.3h-2.6z" strokeLinejoin="round" />,
};

/** The weather card's sky icons, filled in the card's own color */
function FilledSkyIcon({ sky, night = false, size }: { sky: Sky; night?: boolean; size: number }) {
  const cut = useId();
  const smallSun = night ? (
    SMALL_MOON
  ) : (
    <>
      <circle cx="8.5" cy="8" r="3.2" />
      <path d={SMALL_SUN_RAYS} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </>
  );

  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      {sky === "clear" ? (
        night ? (
          MOON
        ) : (
          <>
            <circle cx="12" cy="12" r="5.2" />
            <path d={SUN_RAYS} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />
          </>
        )
      ) : sky === "partly" ? (
        <>
          <mask id={cut} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
            <rect width="24" height="24" fill="#fff" />
            <path d={CLOUD_SMALL} fill="#000" stroke="#000" strokeWidth={3} strokeLinejoin="round" />
          </mask>
          <g mask={`url(#${cut})`}>{smallSun}</g>
          <path d={CLOUD_SMALL} />
        </>
      ) : sky === "cloudy" ? (
        <path d={CLOUD} />
      ) : (
        <>
          <path d={CLOUD_HIGH} />
          {FILLED_FALLING[sky]}
        </>
      )}
    </svg>
  );
}

function Icon({ size, weight, children }: { size: number; weight: number; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

// ----- Conversions -----

/** Currency and unit conversions, laid out like the clock: the answer large on the center line */
function ConversionCard({ widget }: { widget: ConversionWidget }) {
  return (
    <div
      className="clock-card"
      role="group"
      aria-label={`${widget.from} is ${widget.value} ${widget.unit}`}
    >
      <div className="clock-card-head">
        <span className="clock-card-sky" aria-hidden="true">
          <SwapIcon />
        </span>
        <span className="clock-card-place">{widget.title}</span>
      </div>
      <div className="conversion-card-from">{widget.from} =</div>
      <div className="clock-card-time conversion-card-value" aria-hidden="true">
        <span className="conversion-card-figure">{widget.value}</span>
        <span className="clock-card-period">{widget.unit}</span>
      </div>
      {widget.note && <div className="clock-card-zone">{widget.note}</div>}
    </div>
  );
}

function SwapIcon() {
  return (
    <Icon size={15} weight={2}>
      <path d="M4 8h15l-4-4M20 16H5l4 4" />
    </Icon>
  );
}
