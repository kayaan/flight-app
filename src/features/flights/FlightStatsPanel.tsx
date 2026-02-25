import * as React from "react";
import { Badge, Box, Divider, Group, Paper, SimpleGrid, Text } from "@mantine/core";
import { fmtSigned, fmtTime } from "./flightDetails.engine";


type KpiCardProps = {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
};

function KpiCard({ label, value, sub }: KpiCardProps) {
  return (
    <Paper withBorder p="sm" radius="md" style={{ height: "100%" }}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={800} size="lg" style={{ lineHeight: 1.15 }}>
        {value}
      </Text>
      {sub != null && (
        <Text size="xs" c="dimmed" mt={4} style={{ lineHeight: 1.2 }}>
          {sub}
        </Text>
      )}
    </Paper>
  );
}

export type FlightStatsPanelProps = {
  show: boolean;
  segmentStats: { hasSegment: boolean } & Record<string, any> | null;
  varioWindowSec: number;

  statsSource: "climb" | "window";
  climbNavActive: boolean;
  activeClimbIndex: number | null;
  climbsLength: number;

  statsRange: { startSec: number; endSec: number };
  winTotalSec: number;
};

export function FlightStatsPanel(props: FlightStatsPanelProps) {
  const {
    show,
    segmentStats,
    varioWindowSec,
    statsSource,
    climbNavActive,
    activeClimbIndex,
    climbsLength,
    statsRange,
    winTotalSec,
  } = props;

  if (!show) return null;
  if (!segmentStats || !segmentStats.hasSegment) return null;

  const s = segmentStats;

  const dur = fmtTime(s.durSec);
  const altStart = s.altStart != null ? Math.round(s.altStart) : null;
  const altEnd = s.altEnd != null ? Math.round(s.altEnd) : null;
  const dAlt = s.dAlt != null ? s.dAlt : null;

  const altMin = s.altMin != null ? Math.round(s.altMin) : null;
  const altMax = s.altMax != null ? Math.round(s.altMax) : null;

  const vAvg = s.vAvg != null ? s.vAvg : null;
  const vMax = s.vMax != null ? s.vMax : null;
  const vMin = s.vMin != null ? s.vMin : null;

  const spAvg = s.speedAvgKmh != null ? s.speedAvgKmh : null;
  const spMax = s.speedMaxKmh != null ? s.speedMaxKmh : null;

  const pctClimb = s.pctClimb != null ? s.pctClimb : null;
  const pctSink = s.pctSink != null ? s.pctSink : null;
  const pctGlide = s.pctGlide != null ? s.pctGlide : null;

  const bestClimbT = s.longestClimbDurSec != null ? s.longestClimbDurSec : null;
  const bestClimbDAlt = s.longestClimbDAlt != null ? s.longestClimbDAlt : null;

  const rangeStart = fmtTime(Math.min(statsRange.startSec, statsRange.endSec));
  const rangeEnd = fmtTime(Math.max(statsRange.startSec, statsRange.endSec));
  const totalTxt = fmtTime(winTotalSec);

  const modeLabel =
    statsSource === "climb" && climbNavActive && activeClimbIndex != null
      ? `Climb ${activeClimbIndex + 1}/${climbsLength}`
      : "Window";

  const mixText =
    pctClimb == null || pctSink == null || pctGlide == null
      ? "—"
      : `${pctClimb.toFixed(0)}% / ${pctSink.toFixed(0)}% / ${pctGlide.toFixed(0)}%`;

  const mixPrimary = pctClimb == null ? "—" : `Climb ${pctClimb.toFixed(0)}%`;
  const mixSub =
    pctSink == null || pctGlide == null
      ? undefined
      : `Sink ${pctSink.toFixed(0)}% · Glide ${pctGlide.toFixed(0)}%`;

  return (
    <Paper withBorder p="sm" radius="md">
      <Group justify="space-between" align="center" mb="xs" wrap="nowrap">
        <Group gap="xs" align="center" wrap="nowrap">
          <Text fw={700} size="sm">
            Stats
          </Text>
          <Badge variant="light" color={statsSource === "climb" ? "yellow" : "gray"}>
            {modeLabel}
          </Badge>
        </Group>

        <Text size="xs" c="dimmed" style={{ textAlign: "right" }}>
          {rangeStart} → {rangeEnd} / {totalTxt}
        </Text>
      </Group>

      <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }} spacing="xs" verticalSpacing="xs">
        <KpiCard
          label="Δ Altitude"
          value={dAlt == null ? "—" : `${fmtSigned(dAlt, 0)} m`}
          sub={altMin == null || altMax == null ? undefined : `Min/Max: ${altMin} / ${altMax} m`}
        />
        <KpiCard
          label="Duration"
          value={dur}
          sub={altStart == null || altEnd == null ? undefined : `Alt: ${altStart} → ${altEnd} m`}
        />
        <KpiCard
          label={`Avg vario (${varioWindowSec}s)`}
          value={vAvg == null ? "—" : `${vAvg.toFixed(1)} m/s`}
          sub={vMin == null || vMax == null ? undefined : `Min/Max: ${vMin.toFixed(1)} / ${vMax.toFixed(1)}`}
        />
        <KpiCard
          label="Avg speed"
          value={spAvg == null ? "—" : `${spAvg.toFixed(1)} km/h`}
          sub={spMax == null ? undefined : `Max: ${spMax.toFixed(1)} km/h`}
        />
        <KpiCard
          label="Altitude start"
          value={altStart == null ? "—" : `${altStart} m`}
          sub={altEnd == null ? undefined : `End: ${altEnd} m`}
        />
        <KpiCard label="Phase mix" value={mixPrimary} sub={mixSub ?? `Climb/Sink/Glide: ${mixText}`} />
      </SimpleGrid>

      <Divider my="sm" />

      <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }} spacing="xs" verticalSpacing="xs">
        <Box>
          <Text size="xs" c="dimmed">
            Altitude (Min / Max)
          </Text>
          <Text fw={600}>{altMin == null || altMax == null ? "—" : `${altMin} / ${altMax} m`}</Text>
        </Box>

        <Box>
          <Text size="xs" c="dimmed">
            Vario (Min / Max)
          </Text>
          <Text fw={600}>{vMin == null || vMax == null ? "—" : `${vMin.toFixed(1)} / ${vMax.toFixed(1)} m/s`}</Text>
        </Box>

        <Box>
          <Text size="xs" c="dimmed">
            Speed (Avg / Max)
          </Text>
          <Text fw={600}>
            {spAvg == null ? "—" : spAvg.toFixed(1)} / {spMax == null ? "—" : spMax.toFixed(1)} km/h
          </Text>
        </Box>

        <Box>
          <Text size="xs" c="dimmed">
            Climb / Sink / Glide
          </Text>
          <Text fw={600}>{mixText}</Text>
        </Box>

        <Box>
          <Text size="xs" c="dimmed">
            Longest climb phase
          </Text>
          <Text fw={600}>
            {bestClimbT == null || bestClimbDAlt == null
              ? "—"
              : `${fmtTime(bestClimbT)} (${fmtSigned(bestClimbDAlt, 0)} m)`}
          </Text>
        </Box>
      </SimpleGrid>
    </Paper>
  );
}