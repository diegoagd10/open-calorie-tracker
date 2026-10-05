import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Link, useNavigate } from "react-router";

import { addLocalDays, formatLocalDate, getNearbyLocalDates } from "./shared/local-date";
import styles from "./food-log.module.css";

export type DateRailDay = {
  calories?: {
    label: string;
    progress?: string;
    tone: "incomplete" | "logged" | "over" | "within";
  };
  date: string;
  isFuture: boolean;
  isSelected: boolean;
};

function DateWeek({ days, preview = false }: { days: DateRailDay[]; preview?: boolean }) {
  return (
    <div className={styles.dateRail} aria-hidden={preview || undefined}>
      {days.map((day) => {
        const content = (
          <>
            <small>{formatLocalDate(day.date, { weekday: "short" })}</small>
            <strong>{formatLocalDate(day.date, { day: "numeric" })}</strong>
            {day.calories ? (
              <em className={styles.dateCalories} data-calorie-tone={day.calories.tone}>
                {day.calories.label}
              </em>
            ) : null}
            {day.calories?.progress ? (
              <span
                aria-hidden="true"
                className={styles.dateProgress}
                data-calorie-tone={day.calories.tone}
                style={{ "--progress": day.calories.progress } as CSSProperties}
              >
                <span />
              </span>
            ) : null}
          </>
        );
        const className = day.isFuture
          ? styles.futureDate
          : `${styles.dateButton} ${day.isSelected ? styles.selectedDate : ""}`;
        if (preview) {
          return <span className={className} key={day.date}>{content}</span>;
        }
        return day.isFuture ? (
          <button className={className} disabled key={day.date} type="button">{content}</button>
        ) : (
          <Link
            aria-current={day.isSelected ? "date" : undefined}
            className={className}
            key={day.date}
            to={`/?date=${day.date}`}
            preventScrollReset
          >
            {content}
          </Link>
        );
      })}
    </div>
  );
}

export function DateRail({ nearbyDates, selectedDate, today }: {
  nearbyDates: DateRailDay[];
  selectedDate: string;
  today: string;
}) {
  const navigate = useNavigate();
  const [dragX, setDragX] = useState(0);
  const [settling, setSettling] = useState(false);
  const [destination, setDestination] = useState<string | null>(null);
  const swipe = useRef<{
    pointerId: number;
    x: number;
    y: number;
    width: number;
    horizontal: boolean;
  } | null>(null);
  const swiped = useRef(false);
  const previousDate = addLocalDays(selectedDate, -7);
  const followingDate = addLocalDays(selectedDate, 7);
  const nextDate = followingDate > today ? today : followingDate;
  const canGoForward = getNearbyLocalDates(followingDate, today)[0].date <= today;

  useEffect(() => {
    if (!destination) return;
    // Keep the outgoing week in place until the next Food Log finishes loading.
    const reducedMotion = typeof window !== "undefined"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timeout = setTimeout(() => {
      void navigate(`/?date=${destination}`, { preventScrollReset: true });
    }, reducedMotion ? 0 : 220);
    return () => clearTimeout(timeout);
  }, [destination, navigate]);

  function startSwipe(event: PointerEvent<HTMLDivElement>) {
    if (destination || !event.isPrimary) return;
    swiped.current = false;
    if (event.pointerType !== "touch") return;
    setSettling(false);
    swipe.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      width: event.currentTarget.getBoundingClientRect().width,
      horizontal: false,
    };
  }

  function moveSwipe(event: PointerEvent<HTMLDivElement>) {
    const start = swipe.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.horizontal) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dy) >= Math.abs(dx)) {
        swipe.current = null;
        return;
      }
      start.horizontal = true;
      swiped.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const offset = dx < 0 && !canGoForward
      ? Math.max(dx * 0.2, -start.width * 0.12)
      : dx;
    setDragX(Math.max(-start.width, Math.min(start.width, offset)));
  }

  function endSwipe(event: PointerEvent<HTMLDivElement>) {
    const start = swipe.current;
    if (!start || start.pointerId !== event.pointerId) return;
    swipe.current = null;
    if (!start.horizontal) return;
    const dx = event.clientX - start.x;
    const changeWeek = Math.abs(dx) >= Math.min(64, start.width * 0.2)
      && (dx > 0 || canGoForward);
    setSettling(true);
    setDragX(changeWeek ? (dx < 0 ? -start.width : start.width) : 0);
    if (changeWeek) setDestination(dx > 0 ? previousDate : nextDate);
  }

  function cancelSwipe(event: PointerEvent<HTMLDivElement>) {
    if (swipe.current?.pointerId !== event.pointerId) return;
    swipe.current = null;
    setSettling(true);
    setDragX(0);
  }

  return (
    <div className={styles.dateRailWrap}>
      <Link aria-label="Browse past dates" className={styles.dateArrow} to={`/?date=${previousDate}`} preventScrollReset>‹</Link>
      <div
        className={styles.dateViewport}
        aria-label="Nearby dates"
        onClickCapture={(event) => {
          if (destination || (swiped.current && event.detail !== 0)) event.preventDefault();
        }}
        onPointerDown={startSwipe}
        onPointerMove={moveSwipe}
        onPointerUp={endSwipe}
        onPointerCancel={cancelSwipe}
        onLostPointerCapture={(event) => {
          // Taking capture from the touched date link also bubbles a lost event.
          if (event.target === event.currentTarget) cancelSwipe(event);
        }}
      >
        <div
          className={`${styles.dateTrack} ${settling ? styles.dateTrackSettling : ""}`}
          style={{ transform: `translateX(calc(-100% + ${dragX}px))` }}
        >
          <DateWeek days={getNearbyLocalDates(previousDate, today)} preview />
          <DateWeek days={nearbyDates} />
          <DateWeek days={canGoForward ? getNearbyLocalDates(nextDate, today) : []} preview />
        </div>
      </div>
      <Link aria-label="Open calendar" className={styles.dateArrow} to={`/?date=${selectedDate}&calendar=${selectedDate.slice(0, 7)}`}>›</Link>
    </div>
  );
}
