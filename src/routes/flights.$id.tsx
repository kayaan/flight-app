import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Box, Stack, Text, Title, Code, Alert, Button, Group } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import type { FlightRecordDetails } from "../features/flights/flights.types";
import { buildFlightSeries, parseIgcFixes } from "../features/flights/igc/igc.series";
import { useAuthStore } from "../features/auth/store/auth.store";
import { flightApi } from "../features/flights/flights.api";

export const Route = createFileRoute('/flights/$id')({
  component: FlightDetailsRoute
})

function FlightDetailsRoute() {
  const token = useAuthStore((s) => s.token);

  const { id } = Route.useParams();

  const [flight, setFlight] = React.useState<FlightRecordDetails | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Variable window size (default 5s) – later we connect this to a slider UI
  const [windowSec] = React.useState(5);

  const computed = React.useMemo(() => {
    if (!flight?.igcContent || !flight.flightDate) return null;

    const fixes = parseIgcFixes(flight.igcContent, flight.flightDate);
    const { series, windows } = buildFlightSeries(fixes, windowSec);

    return { fixesCount: fixes.length, series, windows };
  }, [flight?.igcContent, flight?.flightDate, windowSec]);

  React.useEffect(() => {
    let cancelled = false;

    async function run() {
      setBusy(true);
      setError(null);
      setFlight(null);

      try {
        if (!token) throw new Error("Not authenticated");

        const numericId = Number(id);
        if (!Number.isFinite(numericId)) throw new Error("Invalid flight id");

        const f = await flightApi.getFlightById(numericId, token);

        if (!cancelled) setFlight(f);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load flight");
      } finally {
        if (!cancelled) setBusy(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [id, token]);

  return (
    <Box p="md">
      <Stack gap="sm">
        <Group justify="space-between">
          <Title order={3}>Flight details</Title>
          <Button variant="light" onClick={() => history.back()}>
            Back
          </Button>
        </Group>

        {flight?.igcContent && (
          <Text size="xs" c="dimmed">
            IGC length: {flight.igcContent.length}
          </Text>
        )}

        {busy && <Text c="dimmed">Loading...</Text>}

        {error && (
          <Alert icon={<IconAlertCircle size={16} />} color="red" title="Error">
            {error}
          </Alert>
        )}

        {!busy && !error && !flight && <Text c="dimmed">No flight found.</Text>}

        {flight && (
          <>
            <Stack gap={4}>
              <Text size="sm">
                <b>ID:</b> {flight.id} &nbsp; <b>Date:</b> {flight.flightDate ?? "-"}
              </Text>
              <Text size="sm">
                <b>Pilot:</b> {flight.pilotName ?? "-"} &nbsp; <b>Glider:</b> {flight.gliderType ?? "-"}
              </Text>
              <Text size="sm">
                <b>Filename:</b> {flight.originalFilename ?? "-"}
              </Text>
            </Stack>

            {!computed ? (
              <Text c="dimmed" size="sm">
                Missing igcContent or flightDate.
              </Text>
            ) : (
              <>
                <Text size="sm">
                  <b>Fixes:</b> {computed.fixesCount} &nbsp; <b>Series points:</b> {computed.series.length} &nbsp;{" "}
                  <b>Windows:</b> {computed.windows.length} (windowSec={windowSec})
                </Text>

                {/* Temporary debug output: we will replace with charts next */}
                <Code block>
                  {JSON.stringify(
                    {
                      sampleSeries: computed.series.slice(0, 3),
                      sampleWindows: computed.windows.slice(0, 3),
                    },
                    null,
                    2
                  )}
                </Code>
              </>
            )}
          </>
        )}
      </Stack>
    </Box>
  );
}
