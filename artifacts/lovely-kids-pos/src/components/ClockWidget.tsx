import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";

interface ClockWidgetProps {
  showHomeButton: boolean;
}

interface ClockParts {
  hour: number;
  minute: number;
  second: number;
}

function getClockParts(date: Date): ClockParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hebron",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return {
    hour: Number(values.hour ?? 0),
    minute: Number(values.minute ?? 0),
    second: Number(values.second ?? 0),
  };
}

function rotationStyle(degrees: number): CSSProperties {
  return {
    "--rotation": `${degrees}deg`,
  } as CSSProperties;
}

export default function ClockWidget({ showHomeButton }: ClockWidgetProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const clock = useMemo(() => getClockParts(now), [now]);

  const hourRotation = (clock.hour % 12) * 30 + clock.minute * 0.5;

  const minuteRotation = clock.minute * 6 + clock.second * 0.1;

  const secondRotation = clock.second * 6;

  const dayLabel = new Intl.DateTimeFormat("ar-PS", {
    weekday: "long",
    timeZone: "Asia/Hebron",
  }).format(now);

  const dateLabel = new Intl.DateTimeFormat("ar-PS", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Hebron",
  }).format(now);

  return (
    <div className="topbar-clock-card">
      <div className="analog-clock" aria-label={`${dayLabel} ${dateLabel}`}>
        {Array.from({ length: 12 }, (_, index) => (
          <span
            className="clock-tick"
            key={index}
            style={
              {
                "--tick-rotation": `${index * 30}deg`,
              } as CSSProperties
            }
          >
            <i />
          </span>
        ))}

        <span
          className="clock-hand clock-hour-hand"
          style={rotationStyle(hourRotation)}
        />

        <span
          className="clock-hand clock-minute-hand"
          style={rotationStyle(minuteRotation)}
        />

        <span
          className="clock-hand clock-second-hand"
          style={rotationStyle(secondRotation)}
        />

        <span className="clock-center-dot" />
      </div>

      <div className="clock-date">
        <strong>{dayLabel}</strong>
        <span dir="ltr">{dateLabel}</span>
      </div>

      {showHomeButton && (
        <Link className="clock-home-button" to="/">
          الرئيسية
        </Link>
      )}
    </div>
  );
}
