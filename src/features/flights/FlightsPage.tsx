import React from "react";
import {
    Alert,
    Button,
    Group,
    Loader,
    Stack,
    Text,
    Title,
    FileButton,
    LoadingOverlay,
} from "@mantine/core";
import { IconAlertCircle, IconUpload } from "@tabler/icons-react";
import { FlightsTable } from "./FlightsTable"; // <- from my previous file
import type { FlightRecordDetails } from "./flights.types";
import { useAuthStore } from "../auth/store/auth.store";
import { flightApi } from "./flights.api";
import { modals } from "@mantine/modals";
import { calculateFlightMetrics, type FlightMetrics } from "./igc";
import { Outlet } from "@tanstack/react-router";

function getErrorMessage(err: unknown, fallback: string) {
    if (err instanceof Error && err.message) {
        return err.message;
    }
    return fallback;
}

export function FlightsPage() {
    const token = useAuthStore((s) => s.token);

    const [rows, setRows] = React.useState<FlightRecordDetails[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [uploading, setUploading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const [deletingAll, setDeletingAll] = React.useState(false);

    const [deletingId, setDeletingId] = React.useState<number | null>(null);


    const [metricsBusy, setMetricsBusy] = React.useState(false);
    const [metricsError, setMetricsError] = React.useState<string | null>(null);
    const [selectedMetrics, setSelectedMetrics] = React.useState<FlightMetrics | null>(null);



    const dateRange = React.useMemo(() => {
        if (rows.length === 0) return null;

        const dates = rows
            .map((r) => new Date(r.flightDate!))
            .filter((d) => !isNaN(d.getTime()));

        if (dates.length === 0) return null;

        const min = new Date(Math.min(...dates.map((d) => d.getTime())));
        const max = new Date(Math.max(...dates.map((d) => d.getTime())));

        return { min, max };
    }, [rows]);

    const confirmDeleteFlight = async (id: number, originalFilename?: string | null) => {
        modals.openConfirmModal({
            title: "Flight löschen?",
            children: (
                <Text size="sm">
                    Willst du diesen Flug wirklich löschen
                    {originalFilename ? `: ${originalFilename}` : ""}? Das kann nicht rückgängig gemacht werden.
                </Text>
            ),
            labels: { confirm: "Löschen", cancel: "Abbrechen" },
            confirmProps: { color: "red" },
            onConfirm: () => deleteFlight(id),
        });

    }

    const deleteFlight = async (id: number) => {
        if (!token) return;

        setDeletingId(id);

        try {
            await flightApi.remove(id, token);
            await load();
        } catch (e) {
            setError(getErrorMessage(e, 'Failed to delete flight'));
        } finally {
            setDeletingId(null);
        }
    }

    const onOpenDetails = React.useCallback(
        async (flight: FlightRecordDetails) => {

            setMetricsError(null);
            setSelectedMetrics(null);
            setMetricsBusy(true);

            if (!token) {
                setMetricsError("Not authenticated");
                return;
            }
            try {
                const igcText = await flightApi.getIgcContent(flight.id, token!);
                const metrics = calculateFlightMetrics(igcText);

                setSelectedMetrics(metrics);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (e: any) {
                setMetricsError(e?.message ?? "Failed to calculate metrics");
            } finally {
                setMetricsBusy(false);
            }

        }, [token]
    )

    const load = React.useCallback(async () => {
        if (!token) return;
        setLoading(true);
        setError(null);
        try {
            const data = await flightApi.list(token);
            setRows(data);
        } catch (e: unknown) {
            setError(getErrorMessage(e, "Failed to load flights"));
        } finally {
            setLoading(false);
        }
    }, [token]);

    React.useEffect(() => {
        load();
    }, [load]);

    async function uploadMany(files: File[]) {
        if (!files || files.length === 0) {
            return;
        }
        if (!token) {
            setError("Not authenticated");
            return;
        }
        setUploading(true);
        setError(null);


        try {
            const uploadedFlights = await flightApi.uploadMany(files, token);


            // simplest UX: prepend new item
            setRows((prev) => [...uploadedFlights.inserted, ...prev]);
        } catch (e: unknown) {
            setError(getErrorMessage(e, "Upload failed"));
        } finally {
            setUploading(false);
        }
    }

    async function deleteAll() {
        if (!token) {
            setError("Not authenticated");
            return;
        }
        if (!confirm("Delete ALL flights? This cannot be undone.")) return;

        setDeletingAll(true);
        setError(null);

        try {
            await flightApi.deleteAll(token);
            await load();

        } catch (e: unknown) {
            setError(getErrorMessage(e, "Delete all failed"));
        } finally {
            setDeletingAll(false);
        }
    }

    if (!token) {
        return (
            <Alert icon={<IconAlertCircle size={16} />} title="Login required" color="yellow">
                Please login to view your flights.
            </Alert>
        );
    }

    const busy = loading || uploading || deletingAll;
    const actionsDisabled = loading || uploading || deletingAll;

    return (
        <div>
            <Stack gap="md">
                <LoadingOverlay visible={busy} zIndex={1000} overlayProps={{ radius: "md", blur: 1 }} />
                <Group justify="space-between" align="center">
                    <div>
                        <Title order={2}>Flights {rows.length}
                            {dateRange && (
                                <Text span c="dimmed" size="sm" ml="sm">
                                    ({dateRange.min.toLocaleDateString()} – {dateRange.max.toLocaleDateString()})
                                </Text>
                            )}
                        </Title>
                        <Text c="dimmed" size="sm">
                            Upload IGC and manage metadata
                        </Text>
                    </div>

                    <Group>
                        <Button variant="light" onClick={load} disabled={actionsDisabled}>
                            Refresh
                        </Button>

                        <Button
                            color="red"
                            variant="light"
                            onClick={deleteAll}
                            disabled={actionsDisabled}
                        >
                            Delete all
                        </Button>

                        <FileButton multiple onChange={(files) => uploadMany(files ?? [])} accept=".igc">
                            {(props) => (
                                <Button
                                    {...props}
                                    leftSection={<IconUpload size={16} />}
                                    loading={uploading}
                                    disabled={actionsDisabled}
                                >
                                    Upload IGC
                                </Button>
                            )}
                        </FileButton>
                    </Group>
                </Group>

                {error && (
                    <Alert icon={<IconAlertCircle size={16} />} title="Error" color="red">
                        {error}
                    </Alert>
                )}

                {loading ? (
                    <Group justify="center" py="xl">
                        <Loader />
                    </Group>
                ) : (
                    <FlightsTable
                        flights={rows}
                        deletingId={deletingId}
                        onDelete={confirmDeleteFlight}
                        onOpenDetails={onOpenDetails}
                        selectedMetrics={selectedMetrics}
                        metricsBusy={metricsBusy}
                        metricsError={metricsError}
                    />
                )}
            </Stack>
            <Outlet />
        </div>
    );
}
