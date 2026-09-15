import { useEffect, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
function read(key: string, fallback: number) {
  try {
    return Number(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}
export function useSplit(
  key: string,
  fallback: number,
  min: number,
  max: number,
) {
  const [value, update] = useState(() => clamp(read(key, fallback), min, max));
  useEffect(() => update((v) => clamp(v, min, max)), [min, max]);
  const set = (next: number) => {
    const v = clamp(next, min, max);
    update(v);
    try {
      localStorage.setItem(key, String(v));
    } catch {
      /* Session layout still works without storage. */
    }
  };
  return [value, set] as const;
}
export function Splitter({
  orientation,
  label,
  value,
  min,
  max,
  defaultValue,
  onChange,
}: {
  orientation: "vertical" | "horizontal";
  label: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  onChange: (value: number) => void;
}) {
  function drag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const el = event.currentTarget;
    const vertical = orientation === "vertical";
    const start = vertical ? event.clientX : event.clientY;
    const extent = el.parentElement?.clientHeight ?? window.innerHeight;
    el.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) =>
      onChange(
        value +
          (vertical ? start - e.clientX : ((e.clientY - start) * 100) / extent),
      );
    const stop = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("lostpointercapture", stop);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("lostpointercapture", stop);
  }
  return (
    <div
      className={`separator ${orientation}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={`${String(Math.round(value))}${orientation === "vertical" ? " 像素" : "%"}`}
      onPointerDown={drag}
      onDoubleClick={() => onChange(defaultValue)}
      onKeyDown={(e) => {
        const delta =
          orientation === "vertical"
            ? e.key === "ArrowLeft"
              ? 16
              : e.key === "ArrowRight"
                ? -16
                : 0
            : e.key === "ArrowDown"
              ? 3
              : e.key === "ArrowUp"
                ? -3
                : 0;
        if (delta || ["Home", "End", "Enter"].includes(e.key)) {
          e.preventDefault();
          onChange(
            e.key === "Home"
              ? min
              : e.key === "End"
                ? max
                : e.key === "Enter"
                  ? defaultValue
                  : value + delta,
          );
        }
      }}
    >
      <span />
    </div>
  );
}
