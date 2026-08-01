import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

interface ClockWidgetProps {
  showHomeButton?: boolean;
}

function getPalestineDateParts(date: Date) {
  const time = new Intl.DateTimeFormat("ar-PS-u-nu-latn", {
    timeZone: "Asia/Hebron",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(date);

  const weekday = new Intl.DateTimeFormat("ar-PS", {
    timeZone: "Asia/Hebron",
    weekday: "long",
  }).format(date);

  const dateParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hebron",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);

  const values = Object.fromEntries(
    dateParts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return {
    time,
    weekday,
    fullDate: `${values.day}/${values.month}/${values.year}`,
  };
}

export default function ClockWidget({
  showHomeButton = true,
}: ClockWidgetProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  const dateParts = getPalestineDateParts(now);

  return (
    <div
      className="topbar-clock-card digital-clock-card"
      aria-label={`${dateParts.weekday} ${dateParts.fullDate} ${dateParts.time}`}
    >
      <div className="digital-clock-time" dir="rtl">
        {dateParts.time}
      </div>

      <div className="digital-clock-date">
        <strong>{dateParts.weekday}</strong>
        <span dir="ltr">{dateParts.fullDate}</span>
      </div>

      {showHomeButton && (
        <Link className="digital-clock-home" to="/">
          الرئيسية
        </Link>
      )}
    </div>
  );
}
