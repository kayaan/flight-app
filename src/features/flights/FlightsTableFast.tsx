import React from "react";
import {
    ActionIcon,
    Box,
    Group,
    Select,
    Table,
    Text,
    Tooltip,
    Checkbox,
} from "@mantine/core";
import { IconEye, IconTrash } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
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

export interface FlightsTableSimpleFastProps {
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

type RowProps = {
    f: FlightRecordDetails;
    deletingId: number | null;
    enableTooltips: boolean;
    onOpen: (id: number) => void;
    onDelete: (id: number, originalFilename?: string | null) => void;
};

const FlightsRow = React.memo(function FlightsRow({
    f,
    deletingId,
    enableTooltips,
    onOpen,
    onDelete,
}: RowProps) {
    return (
        <Table.Tr>
            <Table.Td>{f.id}</Table.Td>
            <Table.Td>{f.flightDate ?? "-"}</Table.Td>
            <Table.Td>{f.pilotName ?? "-"}</Table.Td>
            <Table.Td>{f.gliderType ?? "-"}</Table.Td>

            <Table.Td>
                <Text size="sm" style={{ whiteSpace: "nowrap" }}>
                    {f.takeoffTime ? formatLocalYmdHm(f.takeoffTime) : "-"} –{" "}
                    {f.landingTime ? formatLocalHm(f.landingTime) : "-"}
                </Text>
            </Table.Td>

            <Table.Td>{formatDuration(f.durationSeconds)}</Table.Td>
            <Table.Td>{formatNum(f.distanceKm, 1)}</Table.Td>
            <Table.Td>{formatInt(f.maxAltitudeM)}</Table.Td>
            <Table.Td>{formatInt(f.minAltitudeM)}</Table.Td>
            <Table.Td>{formatNum(f.maxClimbRateMs, 2)}</Table.Td>
            <Table.Td>{formatNum(f.maxSinkRateMs, 2)}</Table.Td>
            <Table.Td>{formatNum(f.avgClimbRateMs, 2)}</Table.Td>
            <Table.Td>
                {Number.isFinite(f.fixCount as number) ? String(f.fixCount) : "-"}
            </Table.Td>

            <Table.Td>
                <Text size="sm" style={{ whiteSpace: "nowrap" }}>
                    {f.uploadedAt ? formatLocalYmdHm(f.uploadedAt) : "-"}
                </Text>
            </Table.Td>

            <Table.Td>
                <Group gap={6} justify="end" wrap="nowrap">
                    {enableTooltips ? (
                        <Tooltip label="Details">
                            <ActionIcon variant="light" onClick={() => onOpen(f.id)}>
                                <IconEye size={16} />
                            </ActionIcon>
                        </Tooltip>
                    ) : (
                        <ActionIcon
                            variant="light"
                            aria-label="Details"
                            onClick={() => onOpen(f.id)}
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
            </Table.Td>
        </Table.Tr>
    );
});

export function FlightsTableSimpleFast({
    flights,
    deletingId = null,
    onDelete,
}: FlightsTableSimpleFastProps) {
    const navigate = useNavigate();

    const [visibility, setVisibility] = React.useState<
        FlightRecordDetails["visibility"] | "all"
    >("all");
    const [verified, setVerified] = React.useState<"all" | "yes" | "no">("all");

    // Optional: borders are expensive; keep default off for speed
    const [columnBorders, setColumnBorders] = React.useState(false);

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

    const sorted = React.useMemo(() => {
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
                        String((a as any)[sortKey] ?? "").localeCompare(
                            String((b as any)[sortKey] ?? "")
                        ) * mul
                    );
            }
        });

        return copy;
    }, [filtered, sortKey, sortDir]);

    // ✅ Defer big renders; keeps UI responsive
    const deferredSorted = React.useDeferredValue(sorted);

    const enableTooltips = deferredSorted.length <= 120;

    const onOpen = React.useCallback(
        (id: number) => navigate({ to: "/flights/$id", params: { id: String(id) } }),
        [navigate]
    );

    const onDeleteRow = React.useCallback(
        (id: number, originalFilename?: string | null) => onDelete(id, originalFilename),
        [onDelete]
    );

    function toggleSort(key: SortKey) {
        if (sortKey === key) {
            setSortDir(sortDir === "asc" ? "desc" : "asc");
        } else {
            setSortKey(key);
            setSortDir(key === "pilotName" || key === "gliderType" || key === "visibility" ? "asc" : "desc");
        }
    }

    const bodyHeightCss = "calc(100vh - 260px)";

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
                    label="Column borders (slower)"
                    checked={columnBorders}
                    onChange={(e) => setColumnBorders(e.currentTarget.checked)}
                />
            </Group>

            <Box
                style={{
                    height: bodyHeightCss,
                    overflow: "auto",
                    border: "1px solid rgba(0,0,0,0.12)",
                    borderRadius: 8,
                    background: "var(--mantine-color-body)",
                }}
            >
                <Table
                    striped
                    highlightOnHover
                    withTableBorder={false}
                    withColumnBorders={columnBorders}
                    style={{
                        minWidth: 2000,
                        background: "var(--mantine-color-body)",
                    }}
                >
                    <Table.Thead
                        style={{
                            position: "sticky",
                            top: 0,
                            zIndex: 2,
                            background: "var(--mantine-color-body)",
                        }}
                    >
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
                                    label="Max climb (m/s)"
                                    active={sortKey === "maxClimbRateMs"}
                                    dir={sortDir}
                                    onClick={() => toggleSort("maxClimbRateMs")}
                                />
                            </Table.Th>

                            <Table.Th>
                                <SortHeader
                                    label="Max sink (m/s)"
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
                        {deferredSorted.map((f) => (
                            <FlightsRow
                                key={f.id}
                                f={f}
                                deletingId={deletingId}
                                enableTooltips={enableTooltips}
                                onOpen={onOpen}
                                onDelete={onDeleteRow}
                            />
                        ))}

                        {deferredSorted.length === 0 && (
                            <Table.Tr>
                                <Table.Td colSpan={15}>
                                    <Text c="dimmed" size="sm">
                                        No flights found.
                                    </Text>
                                </Table.Td>
                            </Table.Tr>
                        )}
                    </Table.Tbody>
                </Table>
            </Box>
        </>
    );
}
