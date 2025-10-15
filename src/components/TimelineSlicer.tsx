import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  type ReactElement,
} from "react";
import {
  client,
  useConfig,
  useElementData,
  useElementColumns,
} from "@sigmacomputing/plugin";

/** ---------- Types ---------- */
interface DateRange {
  start: Date;
  end: Date;
}

interface GranularityOption {
  key: string;
  value: "day" | "month" | "quarter" | "year";
}

interface DateUtils {
  clampDate(d: Date, min: Date, max: Date): Date;
  startOfDay(d: Date): Date;
  startOfMonth(d: Date): Date;
  startOfQuarter(d: Date): Date;
  startOfYear(d: Date): Date;
  floorToGranularity(d: Date, g: "day" | "month" | "quarter" | "year"): Date;
  ceilToGranularity(d: Date, g: "day" | "month" | "quarter" | "year"): Date;
  formatShort(d: Date, g: "day" | "month" | "quarter" | "year"): string;
}

interface TimelineSlicerProps {
  min: Date;
  max: Date;
  value?: DateRange;
  onChange?: (range: DateRange) => void;
  granularityProp?: "day" | "month" | "quarter" | "year";
  snap?: boolean;
  className?: string;
}

interface PluginConfig {
  source?: string;
  dateColumn?: string;
}

/** ---------- Sigma Editor Panel ---------- */
client.config.configureEditorPanel([
  { name: "source", type: "element", label: "Data Source" },
  {
    name: "dateColumn",
    type: "column",
    source: "source",
    label: "Date Column",
    allowMultiple: false,
  },
]);

/** ---------- Runtime Type Guards / Helpers ---------- */
function isRecordOfArrays(x: unknown): x is Record<string, unknown[]> {
  return (
    !!x &&
    typeof x === "object" &&
    Object.values(x as Record<string, unknown[]>).every(Array.isArray)
  );
}

function getColumnArray(
  data: unknown,
  columnId: string | undefined
): unknown[] | null {
  if (!columnId) return null;
  if (!isRecordOfArrays(data)) return null;
  const col = (data as Record<string, unknown[]>)[columnId];
  return Array.isArray(col) ? col : null;
}

/** ---------- Timeline Slicer ---------- */
const TimelineSlicer: React.FC<TimelineSlicerProps> = ({
  min,
  max,
  value,
  onChange,
  granularityProp = "month",
  snap = true,
  className = "",
}) => {
  const [granularity, setGranularity] = useState<
    "day" | "month" | "quarter" | "year"
  >(granularityProp);

  const range = value || { start: min, end: max };

  // Date utility functions
  const dateUtils: DateUtils = {
    clampDate: (d: Date, minD: Date, maxD: Date) => {
      if (d < minD) return minD;
      if (d > maxD) return maxD;
      return d;
    },
    startOfDay: (d: Date) =>
      new Date(d.getFullYear(), d.getMonth(), d.getDate()),
    startOfMonth: (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1),
    startOfQuarter: (d: Date) => {
      const quarter = Math.floor(d.getMonth() / 3);
      return new Date(d.getFullYear(), quarter * 3, 1);
    },
    startOfYear: (d: Date) => new Date(d.getFullYear(), 0, 1),
    floorToGranularity: (d: Date, g) => {
      if (g === "day")
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
      if (g === "month") return new Date(d.getFullYear(), d.getMonth(), 1);
      if (g === "quarter") {
        const q = Math.floor(d.getMonth() / 3) * 3;
        return new Date(d.getFullYear(), q, 1);
      }
      if (g === "year") return new Date(d.getFullYear(), 0, 1);
      return d;
    },
    ceilToGranularity: (d: Date, g) => {
      const floored = dateUtils.floorToGranularity(d, g);
      if (floored.getTime() === d.getTime()) return d;

      if (g === "day")
        return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      if (g === "month")
        return new Date(floored.getFullYear(), floored.getMonth() + 1, 1);
      if (g === "quarter")
        return new Date(floored.getFullYear(), floored.getMonth() + 3, 1);
      if (g === "year") return new Date(floored.getFullYear() + 1, 0, 1);
      return d;
    },
    formatShort: (d: Date, g) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");

      if (g === "day") return `${year}-${month}-${day}`;
      if (g === "month") return `${year}-${month}`;
      if (g === "quarter") {
        const q = Math.floor(d.getMonth() / 3) + 1;
        return `${year} Q${q}`;
      }
      if (g === "year") return year.toString();
      return d.toDateString();
    },
  };

  const normalizedRange = useMemo<DateRange>(() => {
    let s = dateUtils.clampDate(new Date(range.start), min, max);
    let e = dateUtils.clampDate(new Date(range.end), min, max);
    if (s.getTime() > e.getTime()) {
      [s, e] = [e, s];
    }
    if (snap) {
      s = dateUtils.floorToGranularity(s, granularity);
      e = dateUtils.ceilToGranularity(e, granularity);
      s = dateUtils.clampDate(s, min, max);
      e = dateUtils.clampDate(e, min, max);
    }
    return { start: s, end: e };
  }, [range.start, range.end, min, max, snap, granularity]);

  const setRange = useCallback(
    (r: DateRange) => {
      onChange?.(r);
    },
    [onChange]
  );

  const total = Math.max(1, max.getTime() - min.getTime());
  const toPct = useCallback(
    (d: Date) => (100 * (d.getTime() - min.getTime())) / total,
    [min, total]
  );

  const fromPct = useCallback(
    (pct: number) => new Date(min.getTime() + (pct / 100) * total),
    [min, total]
  );

  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<"start" | "end" | "range" | null>(null);
  const raf = useRef<number | null>(null);

  const percentStart = toPct(normalizedRange.start);
  const percentEnd = toPct(normalizedRange.end);

  const commitDrag = useCallback(
    (newStart: Date, newEnd: Date) => {
      let s = new Date(newStart.getTime());
      let e = new Date(newEnd.getTime());

      if (s.getTime() > e.getTime()) {
        [s, e] = [e, s];
      }

      if (snap) {
        s = dateUtils.floorToGranularity(s, granularity);
        e = dateUtils.ceilToGranularity(e, granularity);
      }

      s = dateUtils.clampDate(s, min, max);
      e = dateUtils.clampDate(e, min, max);

      if (s.getTime() > e.getTime()) {
        [s, e] = [e, s];
      }

      setRange({ start: s, end: e });
    },
    [granularity, snap, min, max, setRange]
  );

  const pointerToPct = (clientX: number): number => {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const clampedX = Math.max(0, Math.min(x, rect.width));
    return (clampedX / rect.width) * 100;
  };

  const onPointerDown = (
    e: React.PointerEvent,
    which: "start" | "end" | "range"
  ) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragging.current = which;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current || !trackRef.current) return;
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const pct = pointerToPct(e.clientX);
      const dateAt = fromPct(pct);

      if (dragging.current === "start") {
        commitDrag(dateAt, normalizedRange.end);
      } else if (dragging.current === "end") {
        commitDrag(normalizedRange.start, dateAt);
      } else if (dragging.current === "range") {
        const span =
          normalizedRange.end.getTime() - normalizedRange.start.getTime();
        const minTime = min.getTime();
        const maxTime = max.getTime();

        let center = dateAt.getTime();
        let s = center - span / 2;
        let e2 = center + span / 2;

        if (s < minTime) {
          e2 = e2 + (minTime - s);
          s = minTime;
        }
        if (e2 > maxTime) {
          s = s - (e2 - maxTime);
          e2 = maxTime;
        }

        commitDrag(new Date(s), new Date(e2));
      }
    }) as unknown as number;
  };

  const onPointerUp = (e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    dragging.current = null;
  };

  useEffect(() => {
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, []);

  const handleGranularityChange = (
    newGranularity: "day" | "month" | "quarter" | "year"
  ) => {
    setGranularity(newGranularity);
    const s = dateUtils.floorToGranularity(
      normalizedRange.start,
      newGranularity
    );
    const e = dateUtils.ceilToGranularity(normalizedRange.end, newGranularity);
    setRange({
      start: dateUtils.clampDate(s, min, max),
      end: dateUtils.clampDate(e, min, max),
    });
  };

  const stripes = useMemo<ReactElement[]>(() => {
    const stripeElements: ReactElement[] = [];
    let current = dateUtils.floorToGranularity(min, granularity);

    while (current <= max) {
      let nextCurrent: Date;

      if (granularity === "month") {
        nextCurrent = new Date(
          current.getFullYear(),
          current.getMonth() + 1,
          1
        );
      } else if (granularity === "quarter") {
        nextCurrent = new Date(
          current.getFullYear(),
          current.getMonth() + 3,
          1
        );
      } else if (granularity === "year") {
        nextCurrent = new Date(current.getFullYear() + 1, 0, 1);
      } else if (granularity === "day") {
        nextCurrent = new Date(
          current.getFullYear(),
          current.getMonth(),
          current.getDate() + 1
        );
      } else {
        nextCurrent = new Date(current.getTime() + 86400000);
      }

      const startPct = toPct(current);

      stripeElements.push(
        <div
          key={current.getTime()}
          style={{
            position: "absolute",
            height: "100%",
            width: 1,
            background: "rgba(0,0,0,0.3)",
            left: `${startPct}%`,
          }}
        />
      );

      current = nextCurrent;
    }
    return stripeElements;
  }, [min, max, granularity, toPct]);

  const granularityOptions: GranularityOption[] = [
    { key: "Y", value: "year" },
    { key: "Q", value: "quarter" },
    { key: "M", value: "month" },
    { key: "D", value: "day" },
  ];

  return (
    <div className={`w-full ${className}`} style={{ width: "100%" }}>
      {/* Header */}
      <div
        style={{
          fontSize: 12,
          color: "#374151",
          marginBottom: 8,
          textAlign: "center",
          fontWeight: 500,
        }}
      >
        {`${dateUtils.formatShort(
          normalizedRange.start,
          granularity
        )} - ${dateUtils.formatShort(normalizedRange.end, granularity)}`}
      </div>

      {/* Granularity buttons */}
      <div
        style={{
          marginBottom: 12,
          display: "flex",
          gap: 6,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {granularityOptions.map((opt) => {
          const isActive = opt.value === granularity;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => handleGranularityChange(opt.value)}
              style={{
                padding: "2px 6px",
                fontSize: 12,
                fontWeight: 600,
                border: "0",
                borderBottom: `2px solid ${
                  isActive ? "#2563EB" : "transparent"
                }`,
                color: isActive ? "#2563EB" : "#9CA3AF",
                background: "transparent",
                cursor: "pointer",
              }}
            >
              {opt.key}
            </button>
          );
        })}
      </div>

      {/* Track */}
      <div
        ref={trackRef}
        style={{
          position: "relative",
          width: "100%",
          height: 48,
          marginTop: 12,
          borderRadius: 9999,
          overflow: "hidden",
          background: "#fff",
          border: "1px solid #d1d5db",
          boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* Stripes */}
        <div style={{ position: "absolute", inset: 0 as unknown as number }}>
          {stripes}
        </div>

        {/* Selected region (now draggable) */}
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${Math.min(percentStart, percentEnd)}%`,
            right: `${100 - Math.max(percentStart, percentEnd)}%`,
            background: "#93C5FD",
            opacity: 0.5,
            zIndex: 10,
            pointerEvents: "auto",
            cursor: "grab",
          }}
          onPointerDown={(e) => onPointerDown(e, "range")}
        />

        {/* Start handle */}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Start handle"
          style={{
            position: "absolute",
            top: "50%",
            left: `${percentStart}%`,
            width: 24,
            height: 40,
            transform: "translate(-50%, -50%)",
            background: "linear-gradient(to right, #9ca3af, #6b7280)",
            borderRadius: 12,
            cursor: "ew-resize",
            border: "1px solid #374151",
            boxShadow: "0 1px 2px rgba(0,0,0,0.15)",
            zIndex: 20,
          }}
          onPointerDown={(e) => onPointerDown(e, "start")}
        />

        {/* End handle */}
        <div
          role="slider"
          tabIndex={0}
          aria-label="End handle"
          style={{
            position: "absolute",
            top: "50%",
            left: `${percentEnd}%`,
            width: 24,
            height: 40,
            transform: "translate(-50%, -50%)",
            background: "linear-gradient(to left, #9ca3af, #6b7280)",
            borderRadius: 12,
            cursor: "ew-resize",
            border: "1px solid #374151",
            boxShadow: "0 1px 2px rgba(0,0,0,0.15)",
            zIndex: 20,
          }}
          onPointerDown={(e) => onPointerDown(e, "end")}
        />
      </div>
    </div>
  );
};

/** ---------- Main Plugin Component ---------- */
const SigmaTimelinePlugin: React.FC = () => {
  const config = useConfig() as PluginConfig;

  // Always call hooks (Rules of Hooks). Use empty string when not configured.
  const sourceId = config.source ?? "";
  const sigmaData = useElementData(sourceId);
  const columnInfo = useElementColumns(sourceId) as Record<
    string,
    { name: string }
  >;

  const dateColumnId = config.dateColumn;
  const dateColumnName =
    dateColumnId && columnInfo?.[dateColumnId]
      ? columnInfo[dateColumnId].name
      : null;

  // Extract min and max dates safely
  const { minDate, maxDate } = useMemo(() => {
    const col = getColumnArray(sigmaData, dateColumnId);
    if (!col || col.length === 0) {
      return { minDate: new Date(2024, 0, 1), maxDate: new Date(2024, 11, 31) };
    }

    const dates = col
      .map((d) => new Date(d as string | number | Date))
      .filter((d) => d instanceof Date && !isNaN(d.getTime()));

    if (dates.length === 0) {
      return { minDate: new Date(2024, 0, 1), maxDate: new Date(2024, 11, 31) };
    }

    return {
      minDate: new Date(Math.min(...dates.map((d) => d.getTime()))),
      maxDate: new Date(Math.max(...dates.map((d) => d.getTime()))),
    };
  }, [sigmaData, dateColumnId]);

  // Range state + keep it clamped if bounds shift
  const [dateRange, setDateRange] = useState<DateRange>(() => ({
    start: minDate,
    end: maxDate,
  }));

  useEffect(() => {
    setDateRange((prev) => {
      const start =
        prev.start < minDate
          ? minDate
          : prev.start > maxDate
          ? minDate
          : prev.start;
      const end =
        prev.end > maxDate ? maxDate : prev.end < minDate ? maxDate : prev.end;
      return { start, end };
    });
  }, [minDate, maxDate]);

  // Filter data based on selected date range
  const filteredData = useMemo(() => {
    const col = getColumnArray(sigmaData, dateColumnId);
    if (!col) return [];
    const out: number[] = [];
    for (let i = 0; i < col.length; i++) {
      const d = new Date(col[i] as string | number | Date);
      if (!isNaN(d.getTime()) && d >= dateRange.start && d <= dateRange.end) {
        out.push(i);
      }
    }
    return out;
  }, [sigmaData, dateColumnId, dateRange]);

  const totalCount = getColumnArray(sigmaData, dateColumnId)?.length ?? 0;

  // Friendly guards (UI)
  if (!config.source) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "#6B7280" }}>
        Please select a data source in the configuration panel.
      </div>
    );
  }

  if (!dateColumnId) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "#6B7280" }}>
        Please select a date column in the configuration panel.
      </div>
    );
  }

  return (
    <div style={{ width: "100%", padding: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
        Timeline Slicer
      </h1>
      {dateColumnName && (
        <p style={{ fontSize: 12, color: "#6B7280", marginBottom: 16 }}>
          Filtering by:{" "}
          <span style={{ fontWeight: 600 }}>{dateColumnName}</span>
        </p>
      )}

      <div
        style={{
          marginBottom: 24,
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 16,
          background: "#fff",
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
          Select Date Range
        </h2>
        <TimelineSlicer
          min={minDate}
          max={maxDate}
          value={dateRange}
          onChange={setDateRange}
          snap={true}
          granularityProp="month"
        />
      </div>

      <div>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
          Results
        </h2>
        <p style={{ fontSize: 12, color: "#4B5563", marginBottom: 16 }}>
          Showing {filteredData.length} of {totalCount} records
        </p>
      </div>
    </div>
  );
};

export default SigmaTimelinePlugin;
