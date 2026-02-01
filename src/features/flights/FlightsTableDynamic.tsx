import React from "react";
import { ActionIcon, Group, Select, Text } from "@mantine/core";
import { IconEye, IconTrash } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { FlightRecordDetails } from "./flights.types";
import { useFlightsStore } from "./store/flights.store";


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

function pad2(n: number): string {
    return String(n).padStart(2, "0");
}
function formatLocalYmdHm(iso: string | null): string {
    if (!iso) return "-";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "-";
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(
        d.getHours()
    )}:${pad2(d.getMinutes())}`;
}
function formatLocalHm(iso: string | null): string {
    if (!iso) return "--:--";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "--:--";
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
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

function SortHeaderBare({
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
        <span
            onClick={onClick}
            style={{
                cursor: "pointer",
                userSelect: "none",
                whiteSpace: "nowrap",
                fontWeight: 600,
                fontSize: 13,
            }}
        >
            {label}
            {active ? (dir === "asc" ? " ▲" : " ▼") : ""}
        </span>
    );
}

export interface FlightsTableBareVirtualProps {
    flights: FlightRecordDetails[];
    deletingId?: number | null;
    onDelete: (id: number) => void;
}

type NormalizedFlight = FlightRecordDetails & {
    _flightDateKey: number;
    _uploadedAtKey: number;
    _takeoffKey: number;
    _landingKey: number;
};

export function FlightsTableBareVirtual({
    flights,
    deletingId = null,
    onDelete,
}: FlightsTableBareVirtualProps) {
    const navigate = useNavigate();

    const [visibility, setVisibility] = React.useState<
        FlightRecordDetails["visibility"] | "all"
    >("all");
    const [verified, setVerified] = React.useState<"all" | "yes" | "no">("all");

    // ✅ Hover-State (Row-Highlight)
    const [hoveredId, setHoveredId] = React.useState<number | null>(null);

    const sortDir = useFlightsStore((s) => s.sortDir);
    const sortKey = useFlightsStore((s) => s.sortKey);
    const setSortDir = useFlightsStore((s) => s.setSortDir);
    const setSortKey = useFlightsStore((s) => s.setSortKey);

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

    const sortedVirtual = React.useMemo(() => {
        const copy = [...filtered];
        const mul = sortDir === "asc" ? 1 : -1;

        copy.sort((a, b) => {
            switch (sortKey as SortKey) {
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
                        String((a as any)[sortKey] ?? "").localeCompare(String((b as any)[sortKey] ?? "")) * mul
                    );
            }
        });

        return copy;
    }, [filtered, sortKey, sortDir]);

    const deferredRows = React.useDeferredValue(sortedVirtual);

    function toggleSort(key: SortKey) {
        if (sortKey === key) {
            setSortDir(sortDir === "asc" ? "desc" : "asc");
        } else {
            setSortKey(key);
            setSortDir(key === "pilotName" || key === "gliderType" || key === "visibility" ? "asc" : "desc");
        }
    }

    // ---- Grid widths (px) ----
    const COL_W = React.useMemo(
        () => [70, 110, 160, 160, 320, 110, 140, 120, 120, 140, 140, 140, 90, 190, 120],
        []
    );
    const GRID_COLS = React.useMemo(() => COL_W.map((n) => `${n}px`).join(" "), [COL_W]);
    const tableWidthPx = React.useMemo(() => COL_W.reduce((a, b) => a + b, 0), [COL_W]);

    // ---- Virtualizer ----
    const parentRef = React.useRef<HTMLDivElement | null>(null);
    const EST_ROW_H = 40;

    // eslint-disable-next-line react-hooks/incompatible-library
    const rowVirtualizer = useVirtualizer({
        count: deferredRows.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => EST_ROW_H,
        overscan: 12,
    });

    const bodyHeightCss = "calc(100vh - 260px)";

    // ---- Styles ----
    const headerStyle: React.CSSProperties = {
        display: "grid",
        gridTemplateColumns: GRID_COLS,
        position: "sticky",
        top: 0,
        zIndex: 2,
        background: "var(--mantine-color-body)",
        borderBottom: "1px solid rgba(0,0,0,0.12)",
        width: tableWidthPx,
    };

    const cellHeader: React.CSSProperties = {
        padding: "8px 10px",
        fontSize: 13,
        fontWeight: 600,
        whiteSpace: "nowrap",
        borderRight: "1px solid rgba(0,0,0,0.08)",
        display: "flex",
        alignItems: "center",
        minWidth: 0,
    };

    const cell: React.CSSProperties = {
        padding: "7px 10px",
        fontSize: 13,
        borderRight: "1px solid rgba(0,0,0,0.08)",
        display: "flex",
        alignItems: "center",
        minWidth: 0,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    };

    const scheme =
        (typeof document !== "undefined" &&
            document.documentElement.getAttribute("data-mantine-color-scheme")) ||
        "light";

    // ✅ Base row backgrounds (opak)
    const ROW_BG_ODD = "var(--mantine-color-body)";
    const ROW_BG_EVEN =
        scheme === "dark"
            ? "var(--mantine-color-dark-6)"
            : "var(--mantine-color-gray-0)";

    // ✅ Hover backgrounds (opak, dezent)
    const ROW_HOVER_BG =
        scheme === "dark"
            ? "var(--mantine-color-dark-5)"
            : "var(--mantine-color-gray-1)";

    function getRowBg(index: number, isHovered: boolean): string {
        if (isHovered) return ROW_HOVER_BG;
        return index % 2 === 0 ? ROW_BG_EVEN : ROW_BG_ODD;
    }

    const actionsHeaderCell: React.CSSProperties = {
        ...cellHeader,
        position: "sticky",
        right: 0,
        zIndex: 5,
        borderRight: "none",
        justifyContent: "flex-end",
        background: "var(--mantine-color-body)",
        boxShadow: "-10px 0 10px rgba(0,0,0,0.06)",
    };

    function actionsRowCell(bg: string): React.CSSProperties {
        return {
            ...cell,
            position: "sticky",
            right: 0,
            zIndex: 3,
            borderRight: "none",
            justifyContent: "flex-end",
            gap: 6,
            backgroundColor: bg, // ✅ muss der HOVER-BG sein, damit sticky spalte mitzieht
            boxShadow: "-10px 0 10px rgba(0,0,0,0.06)",
        };
    }

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
            </Group>

            {/* ONE scroll container for X + Y */}
            <div
                ref={parentRef}
                style={{
                    height: bodyHeightCss,
                    overflow: "auto",
                    border: "1px solid rgba(0,0,0,0.12)",
                    borderRadius: 8,
                    background: "var(--mantine-color-body)",
                }}
            >
                {/* Content width defines horizontal scroll range */}
                <div style={{ width: tableWidthPx, minWidth: "100%" }}>
                    {/* Sticky header */}
                    <div style={headerStyle}>
                        <div style={cellHeader}>ID</div>

                        <div style={cellHeader}>
                            <SortHeaderBare
                                label="Date"
                                active={sortKey === "flightDate"}
                                dir={sortDir}
                                onClick={() => toggleSort("flightDate")}
                            />
                        </div>

                        <div style={cellHeader}>
                            <SortHeaderBare
                                label="Pilot"
                                active={sortKey === "pilotName"}
                                dir={sortDir}
                                onClick={() => toggleSort("pilotName")}
                            />
                        </div>

                        <div style={cellHeader}>
                            <SortHeaderBare
                                label="Glider"
                                active={sortKey === "gliderType"}
                                dir={sortDir}
                                onClick={() => toggleSort("gliderType")}
                            />
                        </div>

                        <div style={cellHeader}>
                            <SortHeaderBare
                                label="Time"
                                active={sortKey === "takeoffTime"}
                                dir={sortDir}
                                onClick={() => toggleSort("takeoffTime")}
                            />
                        </div>

                        <div style={cellHeader}>
                            <SortHeaderBare
                                label="Duration"
                                active={sortKey === "durationSeconds"}
                                dir={sortDir}
                                onClick={() => toggleSort("durationSeconds")}
                            />
                        </div>

                        <div style={cellHeader}>
                            <SortHeaderBare
                                label="Distance (km)"
                                active={sortKey === "distanceKm"}
                                dir={sortDir}
                                onClick={() => toggleSort("distanceKm")}
                            />
                        </div>

                        <div style={cellHeader}>
                            <SortHeaderBare
                                label="Max alt (m)"
                                active={sortKey === "maxAltitudeM"}
                                dir={sortDir}
                                onClick={() => toggleSort("maxAltitudeM")}
                            />
                        </div>

                        <div style={cellHeader}>
                            <SortHeaderBare
                                label="Min alt (m)"
                                active={sortKey === "minAltitudeM"}
                                dir={sortDir}
                                onClick={() => toggleSort("minAltitudeM")}
                            />
                        </div>

                        <div style={cellHeader}>
                            <SortHeaderBare
                                label="Max climb (m/s)"
                                active={sortKey === "maxClimbRateMs"}
                                dir={sortDir}
                                onClick={() => toggleSort("maxClimbRateMs")}
                            />
                        </div>

                        <div style={cellHeader}>
                            <SortHeaderBare
                                label="Max sink (m/s)"
                                active={sortKey === "maxSinkRateMs"}
                                dir={sortDir}
                                onClick={() => toggleSort("maxSinkRateMs")}
                            />
                        </div>

                        <div style={cellHeader}>
                            <SortHeaderBare
                                label="Avg climb (m/s)"
                                active={sortKey === "avgClimbRateMs"}
                                dir={sortDir}
                                onClick={() => toggleSort("avgClimbRateMs")}
                            />
                        </div>

                        <div style={cellHeader}>
                            <SortHeaderBare
                                label="Fixes"
                                active={sortKey === "fixCount"}
                                dir={sortDir}
                                onClick={() => toggleSort("fixCount")}
                            />
                        </div>

                        <div style={cellHeader}>
                            <SortHeaderBare
                                label="Uploaded"
                                active={sortKey === "uploadedAt"}
                                dir={sortDir}
                                onClick={() => toggleSort("uploadedAt")}
                            />
                        </div>

                        <div style={actionsHeaderCell}>Actions</div>
                    </div>

                    {/* Virtual body */}
                    <div
                        style={{
                            position: "relative",
                            height: rowVirtualizer.getTotalSize(),
                            width: tableWidthPx,
                            background: "var(--mantine-color-body)",
                        }}
                    >
                        {rowVirtualizer.getVirtualItems().map((vrow) => {
                            const f = deferredRows[vrow.index];
                            const isHovered = hoveredId === f.id;
                            const bg = getRowBg(vrow.index, isHovered);

                            return (
                                <div
                                    key={f.id}
                                    onMouseEnter={() => setHoveredId(f.id)}
                                    onMouseLeave={() => setHoveredId((cur) => (cur === f.id ? null : cur))}
                                    style={{
                                        position: "absolute",
                                        top: 0,
                                        left: 0,
                                        transform: `translateY(${vrow.start}px)`,
                                        display: "grid",
                                        gridTemplateColumns: GRID_COLS,
                                        width: tableWidthPx,
                                        height: vrow.size,
                                        borderBottom: "1px solid rgba(0,0,0,0.06)",
                                        backgroundColor: bg,
                                        transition: "background-color 120ms ease",
                                        cursor: "default",
                                    }}
                                >
                                    <div style={cell}>{f.id}</div>
                                    <div style={cell}>{f.flightDate ?? "-"}</div>
                                    <div style={cell}>{f.pilotName ?? "-"}</div>
                                    <div style={cell}>{f.gliderType ?? "-"}</div>

                                    <div style={cell}>
                                        {f.takeoffTime ? formatLocalYmdHm(f.takeoffTime) : "-"} –{" "}
                                        {f.landingTime ? formatLocalHm(f.landingTime) : "-"}
                                    </div>

                                    <div style={cell}>{formatDuration(f.durationSeconds)}</div>
                                    <div style={cell}>{formatNum(f.distanceKm, 1)}</div>
                                    <div style={cell}>{formatInt(f.maxAltitudeM)}</div>
                                    <div style={cell}>{formatInt(f.minAltitudeM)}</div>
                                    <div style={cell}>{formatNum(f.maxClimbRateMs, 2)}</div>
                                    <div style={cell}>{formatNum(f.maxSinkRateMs, 2)}</div>
                                    <div style={cell}>{formatNum(f.avgClimbRateMs, 2)}</div>
                                    <div style={cell}>
                                        {Number.isFinite(f.fixCount as number) ? String(f.fixCount) : "-"}
                                    </div>
                                    <div style={cell}>{f.uploadedAt ? formatLocalYmdHm(f.uploadedAt) : "-"}</div>

                                    <div style={actionsRowCell(bg)}>
                                        <ActionIcon
                                            variant="light"
                                            aria-label="Details"
                                            onClick={() =>
                                                navigate({ to: "/flights/$id", params: { id: String(f.id) } })
                                            }
                                        >
                                            <IconEye size={16} />
                                        </ActionIcon>

                                        <ActionIcon
                                            variant="light"
                                            color="red"
                                            aria-label="Delete flight"
                                            loading={deletingId === f.id}
                                            disabled={deletingId !== null}
                                            onClick={() => onDelete(f.id)}
                                        >
                                            <IconTrash size={16} />
                                        </ActionIcon>
                                    </div>
                                </div>
                            );
                        })}

                        {deferredRows.length === 0 && (
                            <div style={{ padding: 12 }}>
                                <Text c="dimmed" size="sm">
                                    No flights found.
                                </Text>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
