import { ActionIcon, Badge, Button, CopyButton, Divider, Drawer, Group, ScrollArea, Select, Stack, Table, Text, TextInput, Tooltip } from "@mantine/core";
import type { FlightRecordDetails } from "./flights.types";
import React from "react";
import { IconCheck, IconCopy, IconEye, IconSearch, IconTrash } from "@tabler/icons-react";


/* eslint-disable @typescript-eslint/no-explicit-any */

type SortKey =
    | "flightDate"
    | "pilotName"
    | "gliderType"
    | "takeoffTime"
    | "landingTime"
    | "durationSeconds"
    | "distanceKm"
    | "maxAltitude"
    | "uploadedAt"
    | "visibility"
    | "isVerified";

function formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return '-';

    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

function formatDateString(dateString: string): string {
    const date = new Date(dateString);

    // swedisch because its iso format yyyy-mm-dd hh:mm
    const swedishFormat = date.toLocaleString('sv-SE', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).replace(',', '');

    return swedishFormat;
}

function compare(a: FlightRecordDetails, b: FlightRecordDetails, key: SortKey, dir: "asc" | "desc") {
    const mul = dir === "asc" ? 1 : -1;

    const av = (a as any)[key];
    const bv = (b as any)[key];

    // Handle nulls
    if (av == null && bv == null) return 0;
    if (av == null) return 1 * mul; // nulls last
    if (bv == null) return -1 * mul;

    // Booleans
    if (typeof av === "boolean" && typeof bv === "boolean") {
        return (Number(av) - Number(bv)) * mul;
    }

    // Numbers
    if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * mul;
    }

    // Strings (dates/time are sortable lexicographically in ISO / HH:mm:ss form)
    return String(av).localeCompare(String(bv)) * mul;
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
    onDelete: (id: number, originalFilename?: string) => void;
}

export function FlightsTable(
    {
        flights,
        deletingId = null,
        onDelete

    }: FlightsTableProps) {
    const [q, setQ] = React.useState("");
    const [visibility, setVisibility] = React.useState<FlightRecordDetails["visibility"] | "all">("all");
    const [verified, setVerified] = React.useState<"all" | "yes" | "no">("all");

    const [sortKey, setSortKey] = React.useState<SortKey>("flightDate");
    const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");

    const [opened, setOpened] = React.useState(false);
    const [selected, setSelected] = React.useState<FlightRecordDetails | null>(null);

    const filtered = React.useMemo(() => {
        const needle = q.trim().toLowerCase();

        return flights.filter((f) => {
            if (visibility !== "all" && f.visibility !== visibility) return false;
            if (verified !== "all") {
                const want = verified === "yes";
                if (f.isVerified !== want) return false;
            }

            if (!needle) return true;

            // Quick search across common fields
            const hay = [
                f.pilotName,
                f.gliderType,
                f.gliderRegistration,
                f.gliderCallsign,
                f.flightDate,
                f.originalFilename,
                f.loggerModel,
                f.fileHash,
                String(f.id),
            ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();

            return hay.includes(needle);
        });
    }, [flights, q, visibility, verified]);

    const sorted = React.useMemo(() => {
        const copy = [...filtered];
        copy.sort((a, b) => compare(a, b, sortKey, sortDir));
        return copy;
    }, [filtered, sortKey, sortDir]);

    function toggleSort(key: SortKey) {
        if (sortKey === key) {
            setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        } else {
            setSortKey(key);
            // sensible defaults:
            setSortDir(key === "pilotName" || key === "gliderType" || key === "visibility" ? "asc" : "desc");
        }
    }

    function openDetails(f: FlightRecordDetails) {
        setSelected(f);
        setOpened(true);
    }

    return (
        <>
            <Group gap="sm" mb="sm" align="end">
                <TextInput
                    leftSection={<IconSearch size={16} />}
                    placeholder="Search (pilot, glider, date, filename, hash, id...)"
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

            <ScrollArea>
                <Table striped highlightOnHover withTableBorder withColumnBorders>
                    <Table.Thead>
                        <Table.Tr>
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
                                    label="Takeoff"
                                    active={sortKey === "takeoffTime"}
                                    dir={sortDir}
                                    onClick={() => toggleSort("takeoffTime")}
                                />
                            </Table.Th>
                            <Table.Th>
                                <SortHeader
                                    label="Landing"
                                    active={sortKey === "landingTime"}
                                    dir={sortDir}
                                    onClick={() => toggleSort("landingTime")}
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
                                    label="Max alt"
                                    active={sortKey === "maxAltitude"}
                                    dir={sortDir}
                                    onClick={() => toggleSort("maxAltitude")}
                                />
                            </Table.Th>
                            <Table.Th>
                                <SortHeader
                                    label="Verified"
                                    active={sortKey === "isVerified"}
                                    dir={sortDir}
                                    onClick={() => toggleSort("isVerified")}
                                />
                            </Table.Th>
                            <Table.Th>
                                <SortHeader
                                    label="Visibility"
                                    active={sortKey === "visibility"}
                                    dir={sortDir}
                                    onClick={() => toggleSort("visibility")}
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
                                <Table.Td>{f.flightDate}</Table.Td>
                                <Table.Td>{f.pilotName}</Table.Td>
                                <Table.Td>{f.gliderType}</Table.Td>
                                <Table.Td>{formatDateString(f.takeoffTime ?? "-")}</Table.Td>
                                <Table.Td>{formatDateString(f.landingTime ?? "-")}</Table.Td>
                                <Table.Td>{formatDuration(f.durationSeconds)}</Table.Td>
                                <Table.Td>{Number.isFinite(f.distanceKm) ? f.distanceKm.toFixed(1) : "-"}</Table.Td>
                                <Table.Td>{Number.isFinite(f.maxAltitude) ? Math.round(f.maxAltitude) : "-"}</Table.Td>
                                <Table.Td>
                                    <VerifiedBadge value={f.isVerified} />
                                </Table.Td>
                                <Table.Td>
                                    <VisibilityBadge value={f.visibility} />
                                </Table.Td>
                                <Table.Td>
                                    <Text size="sm" style={{ whiteSpace: "nowrap" }}>
                                        {formatDateString(f.uploadedAt)}
                                    </Text>
                                </Table.Td>
                                <Table.Td>
                                    <Group gap={6} justify="end" wrap="nowrap">
                                        <Tooltip label="Details">
                                            <ActionIcon variant="light" onClick={() => openDetails(f)}>
                                                <IconEye size={16} />
                                            </ActionIcon>
                                        </Tooltip>

                                        <Tooltip label="Delete flight">
                                            <ActionIcon
                                                variant="light"
                                                color="red"
                                                loading={deletingId === f.id}
                                                disabled={deletingId !== null}
                                                onClick={() => onDelete(f.id, f.originalFilename)}>
                                                <IconTrash size={16} />
                                            </ActionIcon>
                                        </Tooltip>
                                    </Group>
                                </Table.Td>
                            </Table.Tr>
                        ))}

                        {sorted.length === 0 && (
                            <Table.Tr>
                                <Table.Td colSpan={13}>
                                    <Text c="dimmed" size="sm">
                                        No flights found.
                                    </Text>
                                </Table.Td>
                            </Table.Tr>
                        )}
                    </Table.Tbody>
                </Table>
            </ScrollArea>

            <Drawer opened={opened} onClose={() => setOpened(false)} title="Flight details" position="right" size="md">
                {selected ? (
                    <Stack gap="sm">
                        <Group justify="space-between">
                            <Text fw={700}>
                                #{selected.id} — {selected.flightDate}
                            </Text>
                            <Group gap="xs">
                                <VerifiedBadge value={selected.isVerified} />
                                <VisibilityBadge value={selected.visibility} />
                            </Group>
                        </Group>

                        <Divider />

                        <Stack gap={6}>
                            <Text size="sm">
                                <b>Pilot:</b> {selected.pilotName}
                            </Text>
                            <Text size="sm">
                                <b>Glider:</b> {selected.gliderType}
                            </Text>
                            <Text size="sm">
                                <b>Registration:</b> {selected.gliderRegistration || "-"}
                            </Text>
                            <Text size="sm">
                                <b>Callsign:</b> {selected.gliderCallsign || "-"}
                            </Text>
                            <Text size="sm">
                                <b>Logger:</b> {selected.loggerModel || "-"}
                            </Text>
                            <Text size="sm">
                                <b>Filename:</b> {selected.originalFilename}
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
                                <b>Distance:</b> {Number.isFinite(selected.distanceKm) ? selected.distanceKm.toFixed(1) : "-"} km
                            </Text>
                            <Text size="sm">
                                <b>Max altitude:</b> {Number.isFinite(selected.maxAltitude) ? Math.round(selected.maxAltitude) : "-"}
                            </Text>
                        </Stack>

                        <Divider />

                        <Group justify="space-between" align="end">
                            <Stack gap={4} style={{ flex: 1 }}>
                                <Text size="sm" fw={600}>
                                    File hash
                                </Text>
                                <Text size="sm" style={{ wordBreak: "break-all" }}>
                                    {selected.fileHash}
                                </Text>
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