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
/* eslint-disable @typescript-eslint/no-explicit-any */

export function FlightsPage() {
    const token = useAuthStore((s) => s.token);

    const [rows, setRows] = React.useState<FlightRecordDetails[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [uploading, setUploading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const [deletingAll, setDeletingAll] = React.useState(false);

    async function load() {
        if (!token) return;
        setLoading(true);
        setError(null);
        try {
            const data = await flightApi.list(token);
            setRows(data);
        } catch (e: any) {
            setError(e?.message ?? "Failed to load flights");
        } finally {
            setLoading(false);
        }
    }

    React.useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

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
            const created = await flightApi.uploadMany(files, token);
            // simplest UX: prepend new item
            setRows((prev) => [...created, ...prev]);
        } catch (e: any) {
            setError(e?.message ?? "Upload failed");
        } finally {
            setUploading(false);
        }
    }

    async function deleteAll() {
        if (!confirm("Delete ALL flights? This cannot be undone.")) return;

        setDeletingAll(true);
        setError(null);

        try {
            await flightApi.deleteAll(token);
            await Promise.resolve(load());

        } catch (e: any) {
            setError(e?.message ?? "Delete all failed");
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

    return (
        <Stack gap="md">
            <LoadingOverlay visible={busy} zIndex={1000} overlayProps={{ radius: "md", blur: 1 }} />
            <Group justify="space-between" align="center">
                <div>
                    <Title order={2}>Flights</Title>
                    <Text c="dimmed" size="sm">
                        Upload IGC and manage metadata
                    </Text>
                </div>

                <Group>
                    <Button variant="light" onClick={load} disabled={loading || uploading}>
                        Refresh
                    </Button>

                    <Button
                        color="red"
                        variant="light"
                        onClick={deleteAll}
                        disabled={loading || uploading}
                    >
                        Delete all
                    </Button>

                    <FileButton multiple onChange={(files) => uploadMany(files ?? [])} accept=".igc">
                        {(props) => (
                            <Button
                                {...props}
                                leftSection={<IconUpload size={16} />}
                                loading={uploading}
                                disabled={loading}
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
                <FlightsTable flights={rows} />
            )}
        </Stack>
    );
}