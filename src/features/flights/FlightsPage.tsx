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
    Box,
} from "@mantine/core";
import { IconAlertCircle, IconUpload } from "@tabler/icons-react";
import { modals } from "@mantine/modals";
import { Outlet } from "@tanstack/react-router";

import { flightApiLocal } from "./flights.api.local";

import { useFlightsStore } from "./store/flights.store";
import { useAuthStore } from "../auth/store/auth.store";
import { FlightsTableBareVirtual } from "./FlightsTableDynamic";

function getErrorMessage(err: unknown, fallback: string) {
    if (err instanceof Error && err.message) return err.message;
    return fallback;
}

export function FlightsPage() {
    const token = useAuthStore((s) => s.token);

    const flights = useFlightsStore((s) => s.flights);
    const status = useFlightsStore((s) => s.status);
    const loadFlights = useFlightsStore((s) => s.load);

    const loading = status === "loading";

    const [uploading, setUploading] = React.useState(false);
    const [deletingAll, setDeletingAll] = React.useState(false);
    const [deletingId, setDeletingId] = React.useState<number | null>(null);

    const [error, setError] = React.useState<string | null>(null);

    const dateRange = React.useMemo(() => {
        if (flights.length === 0) return null;

        const dates = flights
            .map((r) => (r.flightDate ? new Date(r.flightDate) : null))
            .filter((d): d is Date => !!d && !isNaN(d.getTime()));

        if (dates.length === 0) return null;

        const min = new Date(Math.min(...dates.map((d) => d.getTime())));
        const max = new Date(Math.max(...dates.map((d) => d.getTime())));
        return { min, max };
    }, [flights]);

    const deleteFlight = async (id: number) => {
        if (!token) return;

        setDeletingId(id);
        setError(null);

        try {
            await flightApiLocal.remove(id, token);

            await loadFlights(token, { force: true });
        } catch (e) {
            setError(getErrorMessage(e, "Failed to delete flight"));
        } finally {
            setDeletingId(null);
        }
    };

    const confirmDeleteFlight = (
        id: number,
        originalFilename?: string | null
    ) => {
        modals.openConfirmModal({
            title: "Delete flight?",
            children: (
                <Text size="sm">
                    Do you really want to delete this flight
                    {originalFilename ? `: ${originalFilename}` : ""}? This action cannot
                    be undone.
                </Text>
            ),
            labels: { confirm: "Delete", cancel: "Cancel" },
            confirmProps: { color: "red" },
            onConfirm: () => deleteFlight(id),
        });
    };

    React.useEffect(() => {
        if (!token) return;

        // Initial load: no force needed
        void loadFlights(token);
    }, [token, loadFlights]);

    async function uploadMany(files: File[]) {
        if (!files || files.length === 0) return;

        if (!token) {
            setError("Not authenticated");
            return;
        }

        setUploading(true);
        setError(null);

        try {
            // Using local API here
            await flightApiLocal.uploadMany(files, token);

            await loadFlights(token, { force: true });
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
            await flightApiLocal.deleteAll(token);

            await loadFlights(token, { force: true });
        } catch (e: unknown) {
            setError(getErrorMessage(e, "Delete all failed"));
        } finally {
            setDeletingAll(false);
        }
    }

    if (!token) {
        return (
            <Alert
                icon={<IconAlertCircle size={16} />}
                title="Login required"
                color="yellow"
            >
                Please log in to view your flights.
            </Alert>
        );
    }

    const busy = loading || uploading || deletingAll;
    const actionsDisabled = busy;

    return (
        <Box h="100vh">
            <Stack gap="md">
                <LoadingOverlay
                    visible={busy}
                    zIndex={1000}
                    overlayProps={{ radius: "md", blur: 1 }}
                />

                <Group justify="space-between" align="center">
                    <div>
                        <Title order={2}>
                            Flights {flights.length}
                            {dateRange && (
                                <Text span c="dimmed" size="sm" ml="sm">
                                    ({dateRange.min.toLocaleDateString()} -{" "}
                                    {dateRange.max.toLocaleDateString()})
                                </Text>
                            )}
                        </Title>
                        <Text c="dimmed" size="sm">
                            Upload IGC files and manage metadata
                        </Text>
                    </div>

                    <Group>
                        <Button
                            variant="light"
                            onClick={() => loadFlights(token, { force: true })}
                            disabled={actionsDisabled}
                        >
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

                        <FileButton
                            multiple
                            onChange={(files) => uploadMany(files ?? [])}
                            accept=".igc"
                        >
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
                    <FlightsTableBareVirtual
                        flights={flights}
                        deletingId={deletingId}
                        onDelete={confirmDeleteFlight}
                    />
                )}
            </Stack>

            <Outlet />
        </Box>
    );
}


