// src/features/flights/FlightsTableFast.tsx
import React from "react";
import {
    ActionIcon,
    Box,
    Checkbox,
    Group,
    Select,
    Text,
    Tooltip,
} from "@mantine/core";
import { IconEye, IconTrash } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";

import type { FlightRecordDetails } from "./flights.types";
import { useFlightsStore } from "./store/flights.store";

/* eslint-disable @typescript-eslint/no-explicit-any */

type SortKey =
    | "flightDate"
    | "pilotName"
    | "gliderType"
    | "takeoffTime"
    | "landingTime"
    | "durationSeconds"
    | "distanceKm"
    | "maxAltitudeM"
    | "minAltitudeM"
    | "uploadedAt"
    | "visibility"
    | "isVerified"
    | "fixCount"
    | "avgClimbRateMs"
    | "maxClimbRateMs"
    | "maxSinkRateMs";

// ---------------- helpers ----------------

function pad2(n: number): string {
    return String(n).padStart(2, "0");
}

function formatLocalYmdHm(iso: string | null): string {
    if (!iso) return "-";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "-";
    const y = d.getFullYear();
    const m = pad2(d.getMonth() + 1);
    const day = pad2(d.getDate());
    const hh = pad2(d.getHours());
    const mm = pad2(d.getMinutes());
    return `${y}-${m}-${day} ${hh}:${mm}`;
}

function formatLocalHm(iso: string | null): string {
    if (!iso) return "--:--";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "--:--";
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function sameLocalDate(aIso: string | null, bIso: string | null): boolean {
    if (!aIso || !bIso) return false;
    const a = new Date(aIso);
    const b = new Date(bIso);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    );
}

function toLocalSeconds(iso: string | null): number | null {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

function TimeRangeBar({
    takeoffTime,
    landingTime,
}: {
    takeoffTime: string | null;
    landingTime: string | null;
}) {
    const s = toLocalSeconds(takeoffTime);
    const e = toLocalSeconds(landingTime);

    const startPct = s == null ? null : (s / 86400) * 100;
    const endPct = e == null ? null : (e / 86400) * 100;

    const tint = "rgba(0, 110, 255, 0.35)";
    const marker = "rgba(0, 0, 0, 0.25)";
    const base = "rgba(0, 0, 0, 0.05)";

    const intervalLayer =
        startPct != null && endPct != null && endPct > startPct
            ? `linear-gradient(to right,
          ${base} 0%,
          ${base} ${startPct}%,
          ${tint} ${startPct}%,
          ${tint} ${endPct}%,
          ${base} ${endPct}%,
          ${base} 100%
        )`
            : `linear-gradient(to right, ${base} 0%, ${base} 100%)`;

    const markerLayer = `linear-gradient(to right,
      ${marker} 0%, ${marker} 0.4%, transparent 0.4%, transparent 24.6%,
      ${marker} 25%, ${marker} 25.4%, transparent 25.4%, transparent 49.6%,
      ${marker} 50%, ${marker} 50.4%, transparent 50.4%, transparent 74.6%,
      ${marker} 75%, ${marker} 75.4%, transparent 75.4%, transparent 99.6%,
      ${marker} 100%, ${marker} 100.4%
    )`;

    return (
        <Box
            style={{
                height: 8,
                borderRadius: 4,
                backgroundImage: `${intervalLayer}, ${markerLayer}`,
                marginBottom: 4,
            }}
        />
    );
}

function TimeRangeLabel({
    takeoffIso,
    landingIso,
}: {
    takeoffIso: string | null;
    landingIso: string | null;
}) {
    if (!takeoffIso && !landingIso) return <Text size="sm">-</Text>;

    const sameDay = sameLocalDate(takeoffIso, landingIso);

    const startDate = formatLocalYmdHm(takeoffIso).slice(0, 10);
    const startTime = formatLocalYmdHm(takeoffIso).slice(11);

    if (sameDay) {
        const endTime = formatLocalHm(landingIso);
        return (
            <Text size="sm" style={{ whiteSpace: "nowrap" }}>
                {startDate} <b>{startTime}</b> - <b>{endTime}</b>
            </Text>
        );
    }

    const endDate = formatLocalYmdHm(landingIso).slice(0, 10);
    const endTime = formatLocalYmdHm(landingIso).slice(11);

    return (
        <Text size="sm" style={{ whiteSpace: "nowrap" }}>
            {startDate} <b>{startTime}</b> - {endDate} <b>{endTime}</b>
        </Text>
    );
}

function parseFlightDateLocal(flightDate: string | null): Date | null {
    if (!flightDate) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(flightDate.trim());
    if (m) {
        const y = Number(m[1]);
        const mo = Number(m[2]) - 1;
        const d = Number(m[3]);
        const dt = new Date(y, mo, d);
        return Number.isNaN(dt.getTime()) ? null : dt;
    }
    const dt = new Date(flightDate);
    return Number.isNaN(dt.getTime()) ? null : dt;
}

function dayOfYearLocal(d: Date): number {
    const start = new Date(d.getFullYear(), 0, 1);
    const diffMs = d.getTime() - start.getTime();
    return Math.floor(diffMs / 86400000) + 1;
}

function daysInYear(year: number): number {
    const isLeap = new Date(year, 1, 29).getMonth() === 1;
    return isLeap ? 366 : 365;
}

function YearMarkerBar({ flightDate }: { flightDate: string | null }) {
    const dt = parseFlightDateLocal(flightDate);
    const marker = "rgba(0, 0, 0, 0.25)";
    const base = "rgba(0, 0, 0, 0.05)";

    let posPct: number | null = null;
    if (dt) {
        const doy = dayOfYearLocal(dt);
        const total = daysInYear(dt.getFullYear());
        posPct = (doy / total) * 100;
    }

    const monthMarkersLayer = `linear-gradient(to right,
      ${marker} 0%, ${marker} 0.4%, transparent 0.4%, transparent 24.6%,
      ${marker} 25%, ${marker} 25.4%, transparent 25.4%, transparent 49.6%,
      ${marker} 50%, ${marker} 50.4%, transparent 50.4%, transparent 74.6%,
      ${marker} 75%, ${marker} 75.4%, transparent 75.4%, transparent 99.6%,
      ${marker} 100%, ${marker} 100.4%
    )`;

    const strongTint = "rgba(0, 110, 255, 0.85)";

    const flightMarkerLayer =
        posPct == null
            ? `linear-gradient(to right, transparent 0%, transparent 100%)`
            : `linear-gradient(to right,
          transparent 0%,
          transparent calc(${posPct}% - 0.6%),
          ${strongTint} calc(${posPct}% - 0.6%),
          ${strongTint} calc(${posPct}% + 0.6%),
          transparent calc(${posPct}% + 0.6%),
          transparent 100%
        )`;

    const baseLayer = `linear-gradient(to right, ${base} 0%, ${base} 100%)`;

    return (
        <Box
            style={{
                height: 8,
                borderRadius: 4,
                backgroundImage: `${flightMarkerLayer}, ${baseLayer}, ${monthMarkersLayer}`,
                marginTop: 4,
            }}
        />
    );
}

function formatDuration(seconds: number | null): string {
    if (!Number.isFinite(seconds) || (seconds as number) < 0) return "-";
    const s0 = seconds as number;
    const h = Math.floor(s0 / 3600);
    const m = Math.floor((s0 % 3600) / 60);
    const s = Math.floor(s0 % 60);
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

function formatNum(v: number | null, digits = 1): string {
    if (!Number.isFinite(v as number)) return "-";
    return (v as number).toFixed(digits);
}

function formatInt(v: number | null): string {
    if (!Number.isFinite(v as number)) return "-";
    return String(Math.round(v as number));
}

function SortHeader({
    label,
    active,
    dir,
    onClick,
}: {
    label: string;
    active: boolean;
    dir: "asc" | "desc";
    onClick: () => void;
}) {
    return (
        <Text
            size="sm"
            fw={600}
            style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
            onClick={onClick}
        >
            {label}
            {active ? (dir === "asc" ? " ▲" : " ▼") : ""}
        </Text>
    );
}

// ---------------- component ----------------

export interface FlightsTableFastProps {
    flights: FlightRecordDetails[];
    deletingId?: number | null;
    onDelete: (id: number, originalFilename?: string | null) => void;
}

type NormalizedFlight = FlightRecordDetails & {
    _flightDateKey: number;
    _uploadedAtKey: number;
    _takeoffKey: number;
    _landingKey: number;
};

export function FlightsTableFast({
    flights,
    deletingId = null,
    onDelete,
}: FlightsTableFastProps) {
    const navigate = useNavigate();

    const [visibility, setVisibility] = React.useState<
        FlightRecordDetails["visibility"] | "all"
    >("all");
    const [verified, setVerified] = React.useState<"all" | "yes" | "no">("all");

    const sortDir = useFlightsStore((s) => s.sortDir);
    const sortKey = useFlightsStore((s) => s.sortKey);

    const setSortDir = useFlightsStore((s) => s.setSortDir);
    const setSortKey = useFlightsStore((s) => s.setSortKey);

    const [sortBusy, setSortBusy] = React.useState(false);

    const normalized = React.useMemo<NormalizedFlight[]>(() => {
        return flights.map((f) => {
            const flightDateKey = f.flightDate ? Date.parse(f.flightDate) : NaN;
            const uploadedAtKey = Date.parse(f.uploadedAt);
            const takeoffKey = f.takeoffTime ? Date.parse(f.takeoffTime) : NaN;
            const landingKey = f.landingTime ? Date.parse(f.landingTime) : NaN;

            return {
                ...f,
                _flightDateKey: Number.isNaN(flightDateKey) ? 0 : flightDateKey,
                _uploadedAtKey: Number.isNaN(uploadedAtKey) ? 0 : uploadedAtKey,
                _takeoffKey: Number.isNaN(takeoffKey) ? 0 : takeoffKey,
                _landingKey: Number.isNaN(landingKey) ? 0 : landingKey,
            };
        });
    }, [flights]);

    const filtered = React.useMemo(() => {
        return normalized.filter((f) => {
            if (visibility !== "all" && f.visibility !== visibility) return false;
            if (verified !== "all") {
                const want = verified === "yes";
                if (f.isVerified !== want) return false;
            }
            return true;
        });
    }, [normalized, visibility, verified]);

    React.useEffect(() => {
        if (!sortBusy) return;
        requestAnimationFrame(() => setSortBusy(false));
    }, [sortKey, sortDir, sortBusy]);

    const sorted = React.useMemo(() => {
        const copy = [...filtered];
        const mul = sortDir === "asc" ? 1 : -1;

        copy.sort((a, b) => {
            switch (sortKey) {
                case "flightDate":
                    return (a._flightDateKey - b._flightDateKey) * mul;
                case "uploadedAt":
                    return (a._uploadedAtKey - b._uploadedAtKey) * mul;
                case "takeoffTime":
                    return (a._takeoffKey - b._takeoffKey) * mul;
                case "landingTime":
                    return (a._landingKey - b._landingKey) * mul;

                case "isVerified":
                    return (Number(a.isVerified) - Number(b.isVerified)) * mul;

                case "distanceKm":
                case "maxAltitudeM":
                case "minAltitudeM":
                case "durationSeconds":
                case "fixCount":
                case "avgClimbRateMs":
                case "maxClimbRateMs":
                case "maxSinkRateMs":
                    return (((a as any)[sortKey] ?? 0) - ((b as any)[sortKey] ?? 0)) * mul;

                default:
                    return (
                        String((a as any)[sortKey] ?? "").localeCompare(
                            String((b as any)[sortKey] ?? "")
                        ) * mul
                    );
            }
        });

        return copy;
    }, [filtered, sortKey, sortDir]);

    function toggleSort(key: SortKey) {
        setSortBusy(true);
        requestAnimationFrame(() => {
            if (sortKey === key) {
                const dir = sortDir === "asc" ? "desc" : "asc";
                setSortDir(dir);
            } else {
                setSortKey(key);
                setSortDir(
                    key === "pilotName" || key === "gliderType" || key === "visibility"
                        ? "asc"
                        : "desc"
                );
            }
        });
    }

    // ---- virtualizer ----
    const ROW_COUNT = sorted.length;
    const enableTooltips = ROW_COUNT <= 200;

    const [showTimeline, setShowTimeline] = React.useState(ROW_COUNT <= 150);
    React.useEffect(() => {
        setShowTimeline((prev) => (ROW_COUNT <= 150 ? true : prev));
    }, [ROW_COUNT]);

    const parentRef = React.useRef<HTMLDivElement | null>(null);
    const rowHeight = showTimeline ? 92 : 48;

    const rowVirtualizer = useVirtualizer({
        count: ROW_COUNT,
        getScrollElement: () => parentRef.current,
        estimateSize: () => rowHeight,
        overscan: 10,
    });

    // ---- grid table styling ----
    const GRID_COLS =
        "70px 110px 160px 160px 360px 110px 140px 120px 120px 140px 140px 140px 90px 170px 130px";

    const cellBase: React.CSSProperties = {
        padding: "8px 10px",
        borderRight: "1px solid rgba(0,0,0,0.08)",
        display: "flex",
        alignItems: "center",
        minWidth: 0,
    };

    const headerCell: React.CSSProperties = {
        ...cellBase,
        background: "white",
        position: "sticky",
        top: 0,
        zIndex: 2,
        borderBottom: "1px solid rgba(0,0,0,0.12)",
    };

    const bodyHeightCss = "calc(100vh - 260px)";
    const minBodyHeight = 320;
    const maxBodyHeight = 900;

    return (
        <>
            <Group gap="sm" mb="sm" align="end">
                <Select
                    label="Visibility"
                    value={visibility}
                    onChange={(v) => setVisibility((v as any) ?? "all")}
                    data={[
                        { value: "all", label: "All" },
                        { value: "private", label: "Private" },
                        { value: "club", label: "Club" },
                        { value: "public", label: "Public" },
                    ]}
                    w={160}
                />

                <Select
                    label="Verified"
                    value={verified}
                    onChange={(v) => setVerified((v as any) ?? "all")}
                    data={[
                        { value: "all", label: "All" },
                        { value: "yes", label: "Yes" },
                        { value: "no", label: "No" },
                    ]}
                    w={140}
                />

                <Checkbox
                    label="Timeline"
                    checked={showTimeline}
                    onChange={(e) => setShowTimeline(e.currentTarget.checked)}
                />
            </Group>

            <Box style={{ width: "100%" }}>
                {/* Header (same width as rows) */}
                <Box
                    style={{
                        display: "grid",
                        gridTemplateColumns: GRID_COLS,
                        width: "max-content",
                        minWidth: "100%",
                        border: "1px solid rgba(0,0,0,0.12)",
                        borderBottom: "none",
                        borderTopLeftRadius: 8,
                        borderTopRightRadius: 8,
                        overflow: "hidden",
                    }}
                >
                    <Box style={headerCell}>
                        <Text size="sm" fw={600} style={{ whiteSpace: "nowrap" }}>
                            ID
                        </Text>
                    </Box>

                    <Box style={headerCell}>
                        <SortHeader
                            label="Date"
                            active={sortKey === "flightDate"}
                            dir={sortDir}
                            onClick={() => toggleSort("flightDate")}
                        />
                    </Box>

                    <Box style={headerCell}>
                        <SortHeader
                            label="Pilot"
                            active={sortKey === "pilotName"}
                            dir={sortDir}
                            onClick={() => toggleSort("pilotName")}
                        />
                    </Box>

                    <Box style={headerCell}>
                        <SortHeader
                            label="Glider"
                            active={sortKey === "gliderType"}
                            dir={sortDir}
                            onClick={() => toggleSort("gliderType")}
                        />
                    </Box>

                    <Box style={headerCell}>
                        <SortHeader
                            label="Time"
                            active={sortKey === "takeoffTime"}
                            dir={sortDir}
                            onClick={() => toggleSort("takeoffTime")}
                        />
                    </Box>

                    <Box style={headerCell}>
                        <SortHeader
                            label="Duration"
                            active={sortKey === "durationSeconds"}
                            dir={sortDir}
                            onClick={() => toggleSort("durationSeconds")}
                        />
                    </Box>

                    <Box style={headerCell}>
                        <SortHeader
                            label="Distance (km)"
                            active={sortKey === "distanceKm"}
                            dir={sortDir}
                            onClick={() => toggleSort("distanceKm")}
                        />
                    </Box>

                    <Box style={headerCell}>
                        <SortHeader
                            label="Max alt (m)"
                            active={sortKey === "maxAltitudeM"}
                            dir={sortDir}
                            onClick={() => toggleSort("maxAltitudeM")}
                        />
                    </Box>

                    <Box style={headerCell}>
                        <SortHeader
                            label="Min alt (m)"
                            active={sortKey === "minAltitudeM"}
                            dir={sortDir}
                            onClick={() => toggleSort("minAltitudeM")}
                        />
                    </Box>

                    <Box style={headerCell}>
                        <SortHeader
                            label="Max climb (m/s)"
                            active={sortKey === "maxClimbRateMs"}
                            dir={sortDir}
                            onClick={() => toggleSort("maxClimbRateMs")}
                        />
                    </Box>

                    <Box style={headerCell}>
                        <SortHeader
                            label="Max sink (m/s)"
                            active={sortKey === "maxSinkRateMs"}
                            dir={sortDir}
                            onClick={() => toggleSort("maxSinkRateMs")}
                        />
                    </Box>

                    <Box style={headerCell}>
                        <SortHeader
                            label="Avg climb (m/s)"
                            active={sortKey === "avgClimbRateMs"}
                            dir={sortDir}
                            onClick={() => toggleSort("avgClimbRateMs")}
                        />
                    </Box>

                    <Box style={headerCell}>
                        <SortHeader
                            label="Fixes"
                            active={sortKey === "fixCount"}
                            dir={sortDir}
                            onClick={() => toggleSort("fixCount")}
                        />
                    </Box>

                    <Box style={headerCell}>
                        <SortHeader
                            label="Uploaded"
                            active={sortKey === "uploadedAt"}
                            dir={sortDir}
                            onClick={() => toggleSort("uploadedAt")}
                        />
                    </Box>

                    <Box style={{ ...headerCell, justifyContent: "flex-end", borderRight: "none" }}>
                        <Text size="sm" fw={600} style={{ whiteSpace: "nowrap" }}>
                            Actions
                        </Text>
                    </Box>
                </Box>

                {/* Body (virtualized) */}
                <Box
                    ref={parentRef}
                    style={{
                        height: bodyHeightCss,
                        minHeight: minBodyHeight,
                        maxHeight: maxBodyHeight,
                        overflow: "auto", // X + Y
                        border: "1px solid rgba(0,0,0,0.12)",
                        borderTop: "none",
                        borderBottomLeftRadius: 8,
                        borderBottomRightRadius: 8,
                        position: "relative",
                        background: "white",
                    }}
                >
                    {/* inner width = content width -> no "mixing" of last columns */}
                    <Box
                        style={{
                            width: "max-content",
                            minWidth: "100%",
                            height: rowVirtualizer.getTotalSize(),
                            position: "relative",
                        }}
                    >
                        {rowVirtualizer.getVirtualItems().map((vrow) => {
                            const f = sorted[vrow.index];
                            const isEven = vrow.index % 2 === 0;

                            return (
                                <Box
                                    key={f.id}
                                    style={{
                                        position: "absolute",
                                        top: 0,
                                        left: 0,
                                        transform: `translateY(${vrow.start}px)`,
                                        display: "grid",
                                        gridTemplateColumns: GRID_COLS,
                                        width: "max-content",
                                        minWidth: "100%",
                                        borderBottom: "1px solid rgba(0,0,0,0.08)",
                                        background: isEven ? "rgba(0,0,0,0.02)" : "white",
                                    }}
                                >
                                    <Box style={cellBase}>
                                        <Text size="sm">{f.id}</Text>
                                    </Box>

                                    <Box style={cellBase}>
                                        <Text size="sm">{f.flightDate ?? "-"}</Text>
                                    </Box>

                                    <Box style={cellBase}>
                                        <Text size="sm" lineClamp={1}>
                                            {f.pilotName ?? "-"}
                                        </Text>
                                    </Box>

                                    <Box style={cellBase}>
                                        <Text size="sm" lineClamp={1}>
                                            {f.gliderType ?? "-"}
                                        </Text>
                                    </Box>

                                    <Box style={{ ...cellBase, alignItems: "flex-start" }}>
                                        {showTimeline ? (
                                            <Box style={{ width: "100%" }}>
                                                <TimeRangeBar takeoffTime={f.takeoffTime} landingTime={f.landingTime} />
                                                <TimeRangeLabel takeoffIso={f.takeoffTime} landingIso={f.landingTime} />
                                                <YearMarkerBar flightDate={f.flightDate} />
                                            </Box>
                                        ) : (
                                            <Text size="sm" style={{ whiteSpace: "nowrap" }}>
                                                {f.takeoffTime ? formatLocalYmdHm(f.takeoffTime) : "-"} –{" "}
                                                {f.landingTime ? formatLocalHm(f.landingTime) : "-"}
                                            </Text>
                                        )}
                                    </Box>

                                    <Box style={cellBase}>
                                        <Text size="sm">{formatDuration(f.durationSeconds)}</Text>
                                    </Box>

                                    <Box style={cellBase}>
                                        <Text size="sm">{formatNum(f.distanceKm, 1)}</Text>
                                    </Box>

                                    <Box style={cellBase}>
                                        <Text size="sm">{formatInt(f.maxAltitudeM)}</Text>
                                    </Box>

                                    <Box style={cellBase}>
                                        <Text size="sm">{formatInt(f.minAltitudeM)}</Text>
                                    </Box>

                                    <Box style={cellBase}>
                                        <Text size="sm">{formatNum(f.maxClimbRateMs, 2)}</Text>
                                    </Box>

                                    <Box style={cellBase}>
                                        <Text size="sm">{formatNum(f.maxSinkRateMs, 2)}</Text>
                                    </Box>

                                    <Box style={cellBase}>
                                        <Text size="sm">{formatNum(f.avgClimbRateMs, 2)}</Text>
                                    </Box>

                                    <Box style={cellBase}>
                                        <Text size="sm">
                                            {Number.isFinite(f.fixCount as number) ? String(f.fixCount) : "-"}
                                        </Text>
                                    </Box>

                                    <Box style={cellBase}>
                                        <Text size="sm" style={{ whiteSpace: "nowrap" }}>
                                            {f.uploadedAt ? formatLocalYmdHm(f.uploadedAt) : "-"}
                                        </Text>
                                    </Box>

                                    <Box style={{ ...cellBase, justifyContent: "flex-end", borderRight: "none" }}>
                                        <Group gap={6} justify="end" wrap="nowrap">
                                            {enableTooltips ? (
                                                <Tooltip label="Details">
                                                    <ActionIcon
                                                        variant="light"
                                                        onClick={() =>
                                                            navigate({ to: "/flights/$id", params: { id: String(f.id) } })
                                                        }
                                                    >
                                                        <IconEye size={16} />
                                                    </ActionIcon>
                                                </Tooltip>
                                            ) : (
                                                <ActionIcon
                                                    variant="light"
                                                    aria-label="Details"
                                                    onClick={() =>
                                                        navigate({ to: "/flights/$id", params: { id: String(f.id) } })
                                                    }
                                                >
                                                    <IconEye size={16} />
                                                </ActionIcon>
                                            )}

                                            {enableTooltips ? (
                                                <Tooltip label="Delete flight">
                                                    <ActionIcon
                                                        variant="light"
                                                        color="red"
                                                        loading={deletingId === f.id}
                                                        disabled={deletingId !== null}
                                                        onClick={() => onDelete(f.id, f.originalFilename)}
                                                    >
                                                        <IconTrash size={16} />
                                                    </ActionIcon>
                                                </Tooltip>
                                            ) : (
                                                <ActionIcon
                                                    variant="light"
                                                    color="red"
                                                    aria-label="Delete flight"
                                                    loading={deletingId === f.id}
                                                    disabled={deletingId !== null}
                                                    onClick={() => onDelete(f.id, f.originalFilename)}
                                                >
                                                    <IconTrash size={16} />
                                                </ActionIcon>
                                            )}
                                        </Group>
                                    </Box>
                                </Box>
                            );
                        })}

                        {sorted.length === 0 && (
                            <Box style={{ padding: 16 }}>
                                <Text c="dimmed" size="sm">
                                    No flights found.
                                </Text>
                            </Box>
                        )}
                    </Box>
                </Box>
            </Box>
        </>
    );
}
