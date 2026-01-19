import {
    ActionIcon,
    Badge,
    Button,
    CopyButton,
    Divider,
    Drawer,
    Group,
    ScrollArea,
    Select,
    Stack,
    Table,
    Text,
    TextInput,
    Tooltip,
    LoadingOverlay,
    Box,
    Code,
} from "@mantine/core";
import type { FlightRecordDetails } from "./flights.types";
import React from "react";
import { IconCheck, IconCopy, IconEye, IconSearch, IconTrash } from "@tabler/icons-react";
import type { FlightMetrics } from "./igc";
import { useNavigate } from "@tanstack/react-router";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Keep sorting manageable, but display ALL fields as columns.
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
    | "maxSinkRateMs"
    ;

// --- Add these helpers (top of file, near other helpers) ---

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

    const tint = "rgba(0, 110, 255, 0.35)";   // stronger, still light
    const marker = "rgba(0, 0, 0, 0.25)";    // visible marker lines
    const base = "rgba(0, 0, 0, 0.05)";      // faint baseline

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

    // 0 / 6 / 12 / 18 / 24 hour markers (2px)
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

    // If it's "YYYY-MM-DD", parse as local date (avoid UTC shifting).
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(flightDate.trim());
    if (m) {
        const y = Number(m[1]);
        const mo = Number(m[2]) - 1;
        const d = Number(m[3]);
        const dt = new Date(y, mo, d);
        return Number.isNaN(dt.getTime()) ? null : dt;
    }

    // Otherwise try Date parsing (ISO etc.)
    const dt = new Date(flightDate);
    return Number.isNaN(dt.getTime()) ? null : dt;
}

function dayOfYearLocal(d: Date): number {
    const start = new Date(d.getFullYear(), 0, 1);
    const diffMs = d.getTime() - start.getTime();
    return Math.floor(diffMs / 86400000) + 1; // 1..365/366
}

function daysInYear(year: number): number {
    // Leap year check
    const isLeap = new Date(year, 1, 29).getMonth() === 1;
    return isLeap ? 366 : 365;
}

/**
 * Bottom 8px bar:
 * - Month markers at 0/3/6/9/12 months (0/25/50/75/100%)
 * - A single marker for the flight's day-of-year (based on flightDate)
 */
function YearMarkerBar({ flightDate }: { flightDate: string | null }) {
    const dt = parseFlightDateLocal(flightDate);
    const marker = "rgba(0, 0, 0, 0.25)";      // visible marker lines
    const base = "rgba(0, 0, 0, 0.05)";        // faint baseline

    let posPct: number | null = null;
    if (dt) {
        const doy = dayOfYearLocal(dt);
        const total = daysInYear(dt.getFullYear());
        posPct = (doy / total) * 100;
    }

    // Month markers at 0,3,6,9,12 -> 0,25,50,75,100 (2px-ish)
    const monthMarkersLayer = `linear-gradient(to right,
    ${marker} 0%, ${marker} 0.4%, transparent 0.4%, transparent 24.6%,
    ${marker} 25%, ${marker} 25.4%, transparent 25.4%, transparent 49.6%,
    ${marker} 50%, ${marker} 50.4%, transparent 50.4%, transparent 74.6%,
    ${marker} 75%, ${marker} 75.4%, transparent 75.4%, transparent 99.6%,
    ${marker} 100%, ${marker} 100.4%
  )`;

    // Single marker for flight day-of-year (2px-ish)
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

function formatDateTime(d: string | null | undefined): string {
    if (!d) return "-";
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return "-";
    return dt.toLocaleString("sv-SE").replace(",", "");
}


function VisibilityBadge({ value }: { value: FlightRecordDetails["visibility"] }) {
    if (value === "public") return <Badge variant="light">public</Badge>;
    if (value === "club") return <Badge variant="light">club</Badge>;
    return <Badge variant="light">private</Badge>;
}

function VerifiedBadge({ value }: { value: boolean }) {
    return value ? <Badge variant="light">verified</Badge> : <Badge variant="light">unverified</Badge>;
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

export interface FlightsTableProps {
    flights: FlightRecordDetails[];
    deletingId?: number | null;
    onDelete: (id: number, originalFilename?: string | null) => void;

    onOpenDetails?: (flight: FlightRecordDetails) => void; // optional

    selectedMetrics?: FlightMetrics | null;
    metricsBusy?: boolean;
    metricsError?: string | null;
}

export function FlightsTable({
    flights,
    deletingId = null,
    onDelete,
    selectedMetrics = null,
    metricsBusy = false,
    metricsError = null,
}: FlightsTableProps) {

    const navigate = useNavigate();
    const [q, setQ] = React.useState("");
    const [visibility, setVisibility] = React.useState<FlightRecordDetails["visibility"] | "all">("all");
    const [verified, setVerified] = React.useState<"all" | "yes" | "no">("all");

    const [sortKey, setSortKey] = React.useState<SortKey>("flightDate");
    const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");

    const [opened, setOpened] = React.useState(false);
    const [selected] = React.useState<FlightRecordDetails | null>(null);

    const [sortBusy, setSortBusy] = React.useState(false);

    type NormalizedFlight = FlightRecordDetails & {
        _searchHay: string;
        _flightDateKey: number;
        _uploadedAtKey: number;
        _takeoffKey: number;
        _landingKey: number;
        _takeoffLabel: string;
        _landingLabel: string;
        _uploadedLabel: string;
    };

    const normalized = React.useMemo<NormalizedFlight[]>(() => {
        return flights.map((f) => {
            const flightDateKey = f.flightDate ? Date.parse(f.flightDate) : NaN;
            const uploadedAtKey = Date.parse(f.uploadedAt);
            const takeoffKey = f.takeoffTime ? Date.parse(f.takeoffTime) : NaN;
            const landingKey = f.landingTime ? Date.parse(f.landingTime) : NaN;

            // Include all fields (stringified) for search.
            const hay = [
                f.id,
                f.userId,
                f.fileHash,
                f.uploadedAt,
                f.originalFilename,
                f.pilotName,
                f.gliderType,
                f.gliderRegistration,
                f.gliderCallsign,
                f.flightDate,
                f.loggerModel,
                f.lxDeviceJwt ? "lxDeviceJwt" : "",
                f.lxActivityId,
                f.isVerified ? "verified" : "unverified",
                f.takeoffTime,
                f.landingTime,
                f.durationSeconds,
                f.distanceKm,
                f.maxAltitudeM,
                f.minAltitudeM,
                f.maxClimbRateMs,
                f.maxSinkRateMs,
                f.avgClimbRateMs,
                f.fixCount,
                f.visibility,
            ]
                .filter((x) => x !== null && x !== undefined && x !== "")
                .join(" ")
                .toLowerCase();

            return {
                ...f,
                _searchHay: hay,
                _flightDateKey: Number.isNaN(flightDateKey) ? 0 : flightDateKey,
                _uploadedAtKey: Number.isNaN(uploadedAtKey) ? 0 : uploadedAtKey,
                _takeoffKey: Number.isNaN(takeoffKey) ? 0 : takeoffKey,
                _landingKey: Number.isNaN(landingKey) ? 0 : landingKey,
                _takeoffLabel: formatDateTime(f.takeoffTime ?? null),
                _landingLabel: formatDateTime(f.landingTime ?? null),
                _uploadedLabel: formatDateTime(f.uploadedAt),
            };
        });
    }, [flights]);

    const filtered = React.useMemo(() => {
        const needle = q.trim().toLowerCase();

        return normalized.filter((f) => {
            if (visibility !== "all" && f.visibility !== visibility) return false;
            if (verified !== "all") {
                const want = verified === "yes";
                if (f.isVerified !== want) return false;
            }
            if (!needle) return true;
            return f._searchHay.includes(needle);
        });
    }, [normalized, q, visibility, verified]);

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
                    return String((a as any)[sortKey] ?? "").localeCompare(String((b as any)[sortKey] ?? "")) * mul;
            }
        });

        return copy;
    }, [filtered, sortKey, sortDir]);

    function toggleSort(key: SortKey) {
        setSortBusy(true);
        requestAnimationFrame(() => {
            if (sortKey === key) {
                setSortDir((d) => (d === "asc" ? "desc" : "asc"));
            } else {
                setSortKey(key);
                setSortDir(key === "pilotName" || key === "gliderType" || key === "visibility" ? "asc" : "desc");
            }
        });
    }

    // function openDetails(f: FlightRecordDetails) {
    //     setSelected(f);
    //     setOpened(true);
    //     onOpenDetails?.(f);
    // }

    // Count table columns: keep this in sync with <Table.Th> count below.
    const TABLE_COLS = 26;

    return (
        <>
            <Group gap="sm" mb="sm" align="end">
                <TextInput
                    leftSection={<IconSearch size={16} />}
                    placeholder="Search (all fields)"
                    value={q}
                    onChange={(e) => setQ(e.currentTarget.value)}
                    style={{ flex: 1, minWidth: 260 }}
                />

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

            <Box pos="relative">
                <LoadingOverlay visible={sortBusy} />

                {/* Horizontal + vertical scrolling for many columns */}
                <ScrollArea type="auto" scrollbarSize={10} offsetScrollbars>
                    <Table striped highlightOnHover withTableBorder withColumnBorders>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>
                                    <Text size="sm" fw={600} style={{ whiteSpace: "nowrap" }}>
                                        ID
                                    </Text>
                                </Table.Th>

                                <Table.Th>
                                    <SortHeader
                                        label="Date"
                                        active={sortKey === "flightDate"}
                                        dir={sortDir}
                                        onClick={() => toggleSort("flightDate")}
                                    />
                                </Table.Th>

                                <Table.Th>
                                    <SortHeader
                                        label="Pilot"
                                        active={sortKey === "pilotName"}
                                        dir={sortDir}
                                        onClick={() => toggleSort("pilotName")}
                                    />
                                </Table.Th>

                                <Table.Th>
                                    <SortHeader
                                        label="Glider"
                                        active={sortKey === "gliderType"}
                                        dir={sortDir}
                                        onClick={() => toggleSort("gliderType")}
                                    />
                                </Table.Th>

                                <Table.Th>
                                    <SortHeader
                                        label="Time"
                                        active={sortKey === "takeoffTime"}
                                        dir={sortDir}
                                        onClick={() => toggleSort("takeoffTime")}
                                    />
                                </Table.Th>

                                <Table.Th>
                                    <SortHeader
                                        label="Duration"
                                        active={sortKey === "durationSeconds"}
                                        dir={sortDir}
                                        onClick={() => toggleSort("durationSeconds")}
                                    />
                                </Table.Th>

                                <Table.Th>
                                    <SortHeader
                                        label="Distance (km)"
                                        active={sortKey === "distanceKm"}
                                        dir={sortDir}
                                        onClick={() => toggleSort("distanceKm")}
                                    />
                                </Table.Th>

                                <Table.Th>
                                    <SortHeader
                                        label="Max alt (m)"
                                        active={sortKey === "maxAltitudeM"}
                                        dir={sortDir}
                                        onClick={() => toggleSort("maxAltitudeM")}
                                    />
                                </Table.Th>

                                <Table.Th>
                                    <SortHeader
                                        label="Min alt (m)"
                                        active={sortKey === "minAltitudeM"}
                                        dir={sortDir}
                                        onClick={() => toggleSort("minAltitudeM")}
                                    />
                                </Table.Th>
                                <Table.Th>
                                    <SortHeader
                                        label=" Max climb (m/s)"
                                        active={sortKey === "maxClimbRateMs"}
                                        dir={sortDir}
                                        onClick={() => toggleSort("maxClimbRateMs")}

                                    />
                                </Table.Th>

                                <Table.Th>
                                    <SortHeader
                                        label=" Max sink (m/s)"
                                        active={sortKey === "maxSinkRateMs"}
                                        dir={sortDir}
                                        onClick={() => toggleSort("maxSinkRateMs")}

                                    />
                                </Table.Th>

                                <Table.Th>
                                    <SortHeader
                                        label="Avg climb (m/s)"
                                        active={sortKey === "avgClimbRateMs"}
                                        dir={sortDir}
                                        onClick={() => toggleSort("avgClimbRateMs")}
                                    />
                                </Table.Th>

                                <Table.Th>
                                    <SortHeader
                                        label="Fixes"
                                        active={sortKey === "fixCount"}
                                        dir={sortDir}
                                        onClick={() => toggleSort("fixCount")}
                                    />
                                </Table.Th>

                                <Table.Th>
                                    <SortHeader
                                        label="Uploaded"
                                        active={sortKey === "uploadedAt"}
                                        dir={sortDir}
                                        onClick={() => toggleSort("uploadedAt")}
                                    />
                                </Table.Th>

                                <Table.Th />
                            </Table.Tr>
                        </Table.Thead>

                        <Table.Tbody>
                            {sorted.map((f) => (
                                <Table.Tr key={f.id}>
                                    <Table.Td>{f.id}</Table.Td>

                                    <Table.Td>{f.flightDate ?? "-"}</Table.Td>
                                    <Table.Td>{f.pilotName ?? "-"}</Table.Td>
                                    <Table.Td>{f.gliderType ?? "-"}</Table.Td>





                                    <Table.Td>
                                        <TimeRangeBar takeoffTime={f.takeoffTime} landingTime={f.landingTime} />
                                        <TimeRangeLabel takeoffIso={f.takeoffTime} landingIso={f.landingTime} />
                                        <YearMarkerBar flightDate={f.flightDate} />
                                    </Table.Td>
                                    <Table.Td>{formatDuration(f.durationSeconds)}</Table.Td>
                                    <Table.Td>{formatNum(f.distanceKm, 1)}</Table.Td>
                                    <Table.Td>{formatInt(f.maxAltitudeM)}</Table.Td>
                                    <Table.Td>{formatInt(f.minAltitudeM)}</Table.Td>
                                    <Table.Td>{formatNum(f.maxClimbRateMs, 2)}</Table.Td>
                                    <Table.Td>{formatNum(f.maxSinkRateMs, 2)}</Table.Td>
                                    <Table.Td>{formatNum(f.avgClimbRateMs, 2)}</Table.Td>
                                    <Table.Td>{Number.isFinite(f.fixCount as number) ? String(f.fixCount) : "-"}</Table.Td>

                                    <Table.Td>
                                        <Text size="sm" style={{ whiteSpace: "nowrap" }}>
                                            {f._uploadedLabel}
                                        </Text>
                                    </Table.Td>

                                    <Table.Td>
                                        <Group gap={6} justify="end" wrap="nowrap">
                                            <Tooltip label="Details">
                                                <ActionIcon
                                                    variant="light"
                                                    onClick={() => navigate({ to: "/flights/$id", params: { id: String(f.id) } })}
                                                >
                                                    <IconEye size={16} />
                                                </ActionIcon>
                                            </Tooltip>

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
                                        </Group>
                                    </Table.Td>
                                </Table.Tr>
                            ))}

                            {sorted.length === 0 && (
                                <Table.Tr>
                                    <Table.Td colSpan={TABLE_COLS}>
                                        <Text c="dimmed" size="sm">
                                            No flights found.
                                        </Text>
                                    </Table.Td>
                                </Table.Tr>
                            )}
                        </Table.Tbody>
                    </Table>
                </ScrollArea>
            </Box>

            {/* Drawer can stay as-is; it already shows most fields. */}
            <Drawer opened={opened} onClose={() => setOpened(false)} title="Flight details" position="right" size="md">
                {selected ? (
                    <Stack gap="sm">
                        <Group justify="space-between">
                            <Text fw={700}>
                                #{selected.id} — {selected.flightDate ?? "-"}
                            </Text>
                            <Group gap="xs">
                                <VerifiedBadge value={selected.isVerified} />
                                <VisibilityBadge value={selected.visibility} />
                            </Group>
                        </Group>

                        <Divider />

                        <Stack gap={6}>
                            <Text size="sm">
                                <b>Pilot:</b> {selected.pilotName ?? "-"}
                            </Text>
                            <Text size="sm">
                                <b>Glider:</b> {selected.gliderType ?? "-"}
                            </Text>
                            <Text size="sm">
                                <b>Registration:</b> {selected.gliderRegistration ?? "-"}
                            </Text>
                            <Text size="sm">
                                <b>Callsign:</b> {selected.gliderCallsign ?? "-"}
                            </Text>
                            <Text size="sm">
                                <b>Logger:</b> {selected.loggerModel ?? "-"}
                            </Text>
                            <Text size="sm">
                                <b>Filename:</b> {selected.originalFilename ?? "-"}
                            </Text>
                            <Text size="sm">
                                <b>UserId:</b> {selected.userId}
                            </Text>
                            <Text size="sm">
                                <b>Uploaded:</b> {new Date(selected.uploadedAt).toLocaleString()}
                            </Text>
                        </Stack>

                        <Divider />

                        <Stack gap={6}>
                            <Text size="sm">
                                <b>Takeoff:</b> {selected.takeoffTime ?? "-"}
                            </Text>
                            <Text size="sm">
                                <b>Landing:</b> {selected.landingTime ?? "-"}
                            </Text>
                            <Text size="sm">
                                <b>Duration:</b> {formatDuration(selected.durationSeconds)}
                            </Text>
                            <Text size="sm">
                                <b>Distance:</b> {formatNum(selected.distanceKm, 1)} km
                            </Text>
                            <Text size="sm">
                                <b>Max altitude:</b> {formatInt(selected.maxAltitudeM)} m
                            </Text>
                            <Text size="sm">
                                <b>Min altitude:</b> {formatInt(selected.minAltitudeM)} m
                            </Text>
                            <Text size="sm">
                                <b>Max climb:</b> {formatNum(selected.maxClimbRateMs, 2)} m/s
                            </Text>
                            <Text size="sm">
                                <b>Max sink:</b> {formatNum(selected.maxSinkRateMs, 2)} m/s
                            </Text>
                            <Text size="sm">
                                <b>Avg climb:</b> {formatNum(selected.avgClimbRateMs, 2)} m/s
                            </Text>
                            <Text size="sm">
                                <b>Fix count:</b> {Number.isFinite(selected.fixCount as number) ? String(selected.fixCount) : "-"}
                            </Text>
                        </Stack>

                        <Divider />

                        <Box pos="relative">
                            <LoadingOverlay visible={metricsBusy} />
                            <Stack gap={6}>
                                <Text fw={600}>Metrics</Text>

                                {metricsError && (
                                    <Text c="red" size="sm">
                                        {metricsError}
                                    </Text>
                                )}

                                {!metricsBusy && !metricsError && !selectedMetrics && (
                                    <Text c="dimmed" size="sm">
                                        No metrics yet.
                                    </Text>
                                )}

                                {selectedMetrics && (
                                    <Stack gap={6}>
                                        <Text size="sm">
                                            <b>Total distance:</b> {selectedMetrics.totalDistanceKm.toFixed(1)} km
                                        </Text>
                                        <Text size="sm">
                                            <b>Max altitude (MSL):</b> {Math.round(selectedMetrics.maxAltitudeM)} m
                                        </Text>
                                        <Text size="sm">
                                            <b>Min altitude:</b> {Math.round(selectedMetrics.minAltitudeM)} m
                                        </Text>
                                        <Text size="sm">
                                            <b>Total gain:</b> {Math.round(selectedMetrics.totalAltitudeGainM)} m
                                        </Text>
                                        <Text size="sm">
                                            <b>Max climb:</b> {selectedMetrics.maxClimbRateMs.toFixed(2)} m/s
                                        </Text>
                                        <Text size="sm">
                                            <b>Max sink:</b> {selectedMetrics.maxSinkRateMs.toFixed(2)} m/s
                                        </Text>
                                        <Text size="sm">
                                            <b>Start altitude:</b> {Math.round(selectedMetrics.startAltitudeM)} m
                                        </Text>
                                        <Text size="sm">
                                            <b>Landing altitude:</b> {Math.round(selectedMetrics.landingAltitudeM)} m
                                        </Text>
                                        {"avgClimbRateMs" in (selectedMetrics as any) && (
                                            <Text size="sm">
                                                <b>Avg climb:</b> {(selectedMetrics as any).avgClimbRateMs?.toFixed?.(2) ?? "-"} m/s
                                            </Text>
                                        )}
                                        {"fixCount" in (selectedMetrics as any) && (
                                            <Text size="sm">
                                                <b>Fix count:</b> {(selectedMetrics as any).fixCount ?? "-"}
                                            </Text>
                                        )}
                                    </Stack>
                                )}
                            </Stack>
                        </Box>

                        <Divider />

                        <Group justify="space-between" align="end">
                            <Stack gap={4} style={{ flex: 1 }}>
                                <Text size="sm" fw={600}>
                                    File hash
                                </Text>
                                <Code block style={{ wordBreak: "break-all" }}>
                                    {selected.fileHash}
                                </Code>
                            </Stack>

                            <CopyButton value={selected.fileHash}>
                                {({ copied, copy }) => (
                                    <Button
                                        variant="light"
                                        leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                                        onClick={copy}
                                    >
                                        {copied ? "Copied" : "Copy"}
                                    </Button>
                                )}
                            </CopyButton>
                        </Group>

                        <Divider />

                        <Stack gap={6}>
                            <Text size="sm">
                                <b>LX activity:</b> {selected.lxActivityId ?? "-"}
                            </Text>
                            <Text size="sm">
                                <b>LX device JWT:</b> {selected.lxDeviceJwt ? "(present)" : "-"}
                            </Text>
                        </Stack>
                    </Stack>
                ) : (
                    <Text c="dimmed" size="sm">
                        No selection.
                    </Text>
                )}
            </Drawer>
        </>
    );
}
