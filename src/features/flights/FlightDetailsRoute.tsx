// src/features/flights/FlightDetailsRoute.tsx
// ✅ Route is now mostly UI; logic moved to useFlightDetailsModel()

import * as React from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  Box,
  Stack,
  Text,
  Alert,
  Button,
  Group,
  Checkbox,
  SimpleGrid,
  Paper,
  NumberInput,
  ActionIcon,
  Divider,
  Drawer,
  Chip,
  Badge,
} from "@mantine/core";
import { IconAlertCircle, IconSettings } from "@tabler/icons-react";
import EChartsReact from "echarts-for-react";
import * as echarts from "echarts";

import { useAuthStore } from "../auth/store/auth.store";
import { FlightMap } from "./map/FlightMapBase";
import { fmtSigned, fmtTime } from "./flightDetails.engine";

import { useFlightDetailsModel } from "./useFlightDetailsModel";
import type { BaseMap as UiBaseMap } from "./store/flightDetailsUi.store";

import { FlightStatsPanel } from "./FlightStatsPanel";

export function FlightDetailsRoute() {
  const token = useAuthStore((s) => s.token);
  const { id } = useParams({ from: "/flights/$id" });
  const navigate = useNavigate({ from: "/flights/$id" });

  // UI-only states (Drawer open/close)
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [climbListOpen, setClimbListOpen] = React.useState(false);

  const model = useFlightDetailsModel({
    id,
    token,
    goToFlight: (targetId) => {
      navigate({ to: "/flights/$id", params: { id: String(targetId) } });
    },
  });

  const {
    flight,
    busy,
    error,
    computed,
    chartData,

    // nav
    flightIds,
    navBusy,
    currentFlightPos,
    prevFlightId,
    nextFlightId,
    goFlight,

    // climbs
    climbs,
    sortedClimbs,
    climbSortMode,
    setClimbSortMode,
    hasClimbs,
    climbNavActive,
    activeClimbIndex,
    setActiveClimbIndex,
    prevClimb,
    nextClimb,
    clearActiveClimb,
    hoveredClimbIndex,
    setHoveredClimbIndex,

    // thermals/stats
    thermalCount,
    activeClimb,
    activeClimbGainM,
    activeClimbDurSec,
    suppressAutoPanOnceRef,

    win,
    winStartSec,
    winEndSec,
    winTotalSec,
    segmentStats,
    statsSource,
    statsRange,

    // ui store values/actions
    autoFitSelection,
    setAutoFitSelectionUi,
    zoomSyncEnabled,
    setZoomSyncEnabled,
    syncEnabled,
    setSyncEnabled,
    followEnabled,
    setFollowEnabled,
    showStats,
    setShowStats,

    showAlt,
    showVario,
    showSpeed,
    setShowAlt,
    setShowVario,
    setShowSpeed,

    varioWindowSec,
    setVarioWindowSec,
    baseMap,
    setBaseMap,

    showClimbLinesOnChart,
    setShowClimbLinesOnChart,
    showThermalsOnMap,
    setShowThermalsOnMap,

    // charts
    chartEvents,
    altOption,
    varioOption,
    speedOption,
    makeOnChartReady,

    // zoom actions
    zoomDisabled,
    zoomChartsToWindow,
    resetSelection,

    // map
    mapFixesFull,
    mapFixesLite,
    mapThermals,
    mapFocusKey,
    pulseActive,
    focusActiveClimb,
  } = model;

  // local UI layout state (kept in route)
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const draggingRef = React.useRef(false);
  const [splitPct, setSplitPct] = React.useState<number>(60);

  const stopDragging = React.useCallback(() => {
    draggingRef.current = false;
  }, []);

  const onDividerPointerDown = React.useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  }, []);

  const onDividerPointerMove = React.useCallback((clientX: number) => {
    if (!draggingRef.current) return;

    const el = containerRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left;
    const pct = (x / rect.width) * 100;

    // clamp locally
    const clamped = Math.max(40, Math.min(pct, 75));
    setSplitPct(clamped);
  }, []);

  React.useEffect(() => {
    function onMove(ev: PointerEvent) {
      onDividerPointerMove(ev.clientX);
    }
    function onUp() {
      stopDragging();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [onDividerPointerMove, stopDragging]);

  return (
    <Box p="md">
      <Stack gap="sm">
        {/* HEADER */}
        <Group justify="space-between" align="center" wrap="nowrap">
          <Group gap="md" align="center" wrap="nowrap">
            <Group gap="md" align="center" wrap="nowrap">
              <Button variant="light" onClick={() => navigate({ to: "/flights" })}>
                ← Back to flights
              </Button>

              <Box>
                <Text fw={700} size="sm">
                  {flight?.originalFilename ?? `Flight ${id}`}
                </Text>

                <Text size="xs" c="dimmed">
                  {flight?.flightDate ? new Date(flight.flightDate).toLocaleDateString() : ""}
                  {currentFlightPos >= 0 && flightIds.length > 0
                    ? ` · ${currentFlightPos + 1} / ${flightIds.length}`
                    : ""}
                </Text>
              </Box>

              <Group gap="xs" align="center" wrap="nowrap">
                <Button
                  size="xs"
                  variant="light"
                  disabled={navBusy || prevFlightId == null}
                  onClick={() => prevFlightId != null && goFlight(prevFlightId)}
                >
                  ← Prev
                </Button>

                <Button
                  size="xs"
                  variant="light"
                  disabled={navBusy || nextFlightId == null}
                  onClick={() => nextFlightId != null && goFlight(nextFlightId)}
                >
                  Next →
                </Button>
              </Group>
            </Group>

            <Group gap="xs" align="center" wrap="nowrap">
              <Button size="xs" variant="light" onClick={() => setClimbListOpen(true)} disabled={!hasClimbs}>
                Climbs
              </Button>
              <Button size="xs" variant="subtle" onClick={prevClimb} disabled={!hasClimbs}>
                ◀
              </Button>

              <Text size="sm" fw={600} style={{ minWidth: 110, textAlign: "center" }}>
                {climbNavActive
                  ? `Climb ${activeClimbIndex! + 1} / ${climbs.length}`
                  : hasClimbs
                    ? `${climbs.length} climbs`
                    : "No climbs"}
              </Text>

              <Button size="xs" variant="subtle" onClick={nextClimb} disabled={!hasClimbs}>
                ▶
              </Button>

              <Button size="xs" variant="subtle" onClick={clearActiveClimb} disabled={!climbNavActive}>
                ✕
              </Button>
            </Group>
          </Group>

          <Group gap="xs" align="center" wrap="nowrap">
            <Group justify="space-between">
              <Button size="xs" variant="light" onClick={resetSelection} disabled={!win}>
                Reset selection
              </Button>

              <Button size="xs" variant="light" onClick={zoomChartsToWindow} disabled={zoomDisabled}>
                Zoom to window
              </Button>
            </Group>

            <Button size="xs" variant={followEnabled ? "filled" : "light"} onClick={() => setFollowEnabled(!followEnabled)}>
              Follow
            </Button>

            <Button size="xs" variant={zoomSyncEnabled ? "filled" : "light"} onClick={() => setZoomSyncEnabled(!zoomSyncEnabled)}>
              Sync Zoom
            </Button>

            <Button size="xs" variant={syncEnabled ? "filled" : "light"} onClick={() => setSyncEnabled(!syncEnabled)}>
              Sync Charts
            </Button>

            <Button size="xs" variant={showStats ? "filled" : "light"} onClick={() => setShowStats(!showStats)}>
              Stats
            </Button>

            <ActionIcon variant="subtle" size="lg" onClick={() => setSettingsOpen(true)} aria-label="Settings">
              <IconSettings size={18} />
            </ActionIcon>
          </Group>
        </Group>

        {/* SETTINGS DRAWER */}
        <Drawer
          opened={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          title="Settings"
          position="right"
          size="sm"
          padding="md"
          withCloseButton
          withinPortal
          zIndex={3000}
          overlayProps={{ opacity: 0.35, blur: 2 }}
        >
          <Paper withBorder p="sm" radius="md">
            <Group justify="space-between" align="center" mb={6}>
              <Text fw={600} size="sm">
                Flight Summary
              </Text>
              <Text size="xs" c="dimmed">
                {id}
              </Text>
            </Group>

            <Divider my="sm" />

            <SimpleGrid cols={2} spacing="xs" verticalSpacing="xs">
              <Box>
                <Text size="xs" c="dimmed">
                  Climbs
                </Text>
                <Text fw={600}>{climbs.length}</Text>
              </Box>

              <Box>
                <Text size="xs" c="dimmed">
                  Thermals
                </Text>
                <Text fw={600}>{thermalCount}</Text>
              </Box>

              <Box>
                <Text size="xs" c="dimmed">
                  Active climb
                </Text>
                <Text fw={600}>
                  {activeClimb && activeClimbGainM != null && activeClimbDurSec != null
                    ? `${fmtSigned(activeClimbGainM, 0)} m · ${fmtTime(activeClimbDurSec)}`
                    : "—"}
                </Text>
              </Box>

              <Box>
                <Text size="xs" c="dimmed">
                  Window
                </Text>
                <Text fw={600}>
                  {fmtTime(Math.min(winStartSec, winEndSec))} → {fmtTime(Math.max(winStartSec, winEndSec))}
                </Text>
              </Box>
            </SimpleGrid>

            <Divider my="sm" />

            <Group justify="space-between">
              <Button
                size="xs"
                variant="light"
                onClick={focusActiveClimb}
                disabled={!activeClimb || !computed?.fixesFull?.length}
              >
                Focus active climb
              </Button>

              <Button size="xs" variant="light" onClick={() => setSettingsOpen(false)}>
                Close
              </Button>
            </Group>
          </Paper>

          <Stack gap="md" mt="md">
            <Box>
              <Text fw={600} size="sm" mb={6}>
                Charts
              </Text>

              {(() => {
                type ChartToggle = "alt" | "vario" | "speed";
                const chartSelection: ChartToggle[] = [
                  showAlt ? "alt" : null,
                  showVario ? "vario" : null,
                  showSpeed ? "speed" : null,
                ].filter(Boolean) as ChartToggle[];

                return (
                  <Chip.Group
                    multiple
                    value={chartSelection}
                    onChange={(vals) => {
                      const v = (vals ?? []) as ChartToggle[];
                      setShowAlt(v.includes("alt"));
                      setShowVario(v.includes("vario"));
                      setShowSpeed(v.includes("speed"));
                    }}
                  >
                    <Group gap="xs">
                      <Chip value="alt" radius="sm" variant="filled">
                        Alt
                      </Chip>
                      <Chip value="vario" radius="sm" variant="filled">
                        Vario
                      </Chip>
                      <Chip value="speed" radius="sm" variant="filled">
                        Speed
                      </Chip>
                    </Group>
                  </Chip.Group>
                );
              })()}

              <Divider my="sm" />

              <Text fw={600} size="sm" mb={6}>
                Overlays
              </Text>

              <Stack gap="xs">
                <Checkbox
                  label="Climb lines"
                  checked={showClimbLinesOnChart}
                  onChange={(e) => setShowClimbLinesOnChart(e.currentTarget.checked)}
                />
                <Checkbox
                  label="Thermals"
                  checked={showThermalsOnMap}
                  onChange={(e) => setShowThermalsOnMap(e.currentTarget.checked)}
                />
                <Checkbox
                  label="Auto fit selection"
                  checked={autoFitSelection}
                  onChange={(e) => setAutoFitSelectionUi(e.currentTarget.checked)}
                />
              </Stack>

              <Divider my="sm" />

              <Text fw={600} size="sm" mb={6}>
                Map style
              </Text>

              <Chip.Group value={baseMap} onChange={(v) => setBaseMap(v as UiBaseMap)}>
                <Group gap="xs">
                  <Chip value="osm" radius="sm" variant="filled">
                    OSM
                  </Chip>
                  <Chip value="topo" radius="sm" variant="filled">
                    Topo
                  </Chip>
                  <Chip value="esriBalanced" radius="sm" variant="filled">
                    Topo Lite
                  </Chip>
                </Group>
              </Chip.Group>
            </Box>

            <Divider />

            <NumberInput
              label="Vario win (s)"
              value={varioWindowSec}
              onChange={(v) => setVarioWindowSec(typeof v === "number" ? v : Number(v))}
              min={1}
              max={30}
              step={1}
              size="sm"
            />
          </Stack>
        </Drawer>

        {/* CLIMBS DRAWER */}
        <Drawer
          opened={climbListOpen}
          onClose={() => setClimbListOpen(false)}
          title={`Climbs (${climbs.length})`}
          position="right"
          size="sm"
          padding="md"
          withCloseButton
          withinPortal
          zIndex={3100}
          overlayProps={{ opacity: 0.35, blur: 2 }}
        >
          {!hasClimbs ? (
            <Text c="dimmed" size="sm">
              No climbs detected.
            </Text>
          ) : (
            <Stack gap="xs">
              <Box>
                <Text fw={600} size="sm" mb={6}>
                  Sort climbs
                </Text>

                <Chip.Group value={climbSortMode} onChange={(v) => setClimbSortMode((v ?? "normal") as any)}>
                  <Group gap="xs">
                    <Chip value="normal" radius="sm">
                      Normal
                    </Chip>
                    <Chip value="gainDesc" radius="sm">
                      Gain ↓
                    </Chip>
                    <Chip value="gainAsc" radius="sm">
                      Gain ↑
                    </Chip>
                  </Group>
                </Chip.Group>
              </Box>

              <Divider my="sm" />

              {sortedClimbs.map((c, listIdx) => {
                const f = computed?.fixesFull ?? [];
                const sSec = f[c.startIdx]?.tSec ?? null;
                const eSec = f[c.endIdx]?.tSec ?? null;

                const durSec =
                  typeof sSec === "number" && typeof eSec === "number"
                    ? Math.max(0, eSec - sSec)
                    : null;

                const originalIndex = climbs.findIndex((cl) => cl.startIdx === c.startIdx && cl.endIdx === c.endIdx);

                const isActive = originalIndex !== -1 && activeClimbIndex === originalIndex;
                const isHover = originalIndex !== -1 && hoveredClimbIndex === originalIndex;

                return (
                  <Paper
                    key={`${c.startIdx}-${c.endIdx}-${listIdx}`}
                    withBorder
                    p="sm"
                    radius="md"
                    onMouseEnter={() => originalIndex !== -1 && setHoveredClimbIndex(originalIndex)}
                    onMouseLeave={() => setHoveredClimbIndex(null)}
                    style={{
                      cursor: "pointer",
                      borderColor: isActive
                        ? "rgba(255,212,0,0.9)"
                        : isHover
                          ? "rgba(255,212,0,0.45)"
                          : undefined,
                      boxShadow: isActive
                        ? "0 0 0 2px rgba(255,212,0,0.35)"
                        : isHover
                          ? "0 0 0 1px rgba(255,212,0,0.25)"
                          : undefined,
                      background: isHover ? "rgba(255,212,0,0.06)" : undefined,
                      transition: "background 120ms ease, box-shadow 120ms ease, border-color 120ms ease",
                    }}
                    onClick={() => {
                      if (originalIndex !== -1) setActiveClimbIndex(originalIndex);
                      setClimbListOpen(false);
                    }}
                  >
                    <Group justify="space-between" align="flex-start" wrap="nowrap">
                      <Box>
                        <Text fw={700} size="sm">
                          Climb {originalIndex !== -1 ? originalIndex + 1 : listIdx + 1}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {durSec == null ? "—" : fmtTime(durSec)} · {Math.round(c.startAltM)} → {Math.round(c.peakAltM)} m
                        </Text>
                      </Box>

                      <Text fw={700} size="sm">
                        {durSec && durSec > 0 ? `${(c.gainM / durSec).toFixed(2)} m/s` : "—"}
                      </Text>
                    </Group>

                    <Divider my={8} />

                    <SimpleGrid cols={3} spacing="xs" verticalSpacing="xs">
                      <Box>
                        <Text size="xs" c="dimmed">
                          Start
                        </Text>
                        <Text fw={600} size="sm">
                          {Math.round(c.startAltM)} m
                        </Text>
                      </Box>

                      <Box>
                        <Text size="xs" c="dimmed">
                          Gain
                        </Text>
                        <Text fw={700} size="sm" style={{ color: "rgba(255,212,0,1)" }}>
                          {fmtSigned(c.gainM, 0)} m
                        </Text>
                      </Box>

                      <Box>
                        <Text size="xs" c="dimmed">
                          Peak
                        </Text>
                        <Text fw={600} size="sm">
                          {Math.round(c.peakAltM)} m
                        </Text>
                      </Box>
                    </SimpleGrid>

                    <Group justify="flex-end" mt="xs">
                      <Button
                        size="xs"
                        variant="subtle"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (originalIndex !== -1) {
                            suppressAutoPanOnceRef.current = true;
                            setActiveClimbIndex(originalIndex);
                          }
                          setClimbListOpen(false);
                          queueMicrotask(() => focusActiveClimb());
                        }}
                      >
                        Focus
                      </Button>
                    </Group>
                  </Paper>
                );
              })}
            </Stack>
          )}
        </Drawer>

        {/* BODY */}
        {busy && <Text c="dimmed">Loading...</Text>}

        {error && (
          <Alert icon={<IconAlertCircle size={16} />} color="red" title="Error">
            {error}
          </Alert>
        )}

        {!busy && !error && !flight && <Text c="dimmed">No flight found.</Text>}

        {flight && !computed && (
          <Text c="dimmed" size="sm">
            Missing igcContent or flightDate.
          </Text>
        )}

        {computed && chartData && (
          <Box
            ref={containerRef}
            style={{
              display: "flex",
              alignItems: "stretch",
              width: "100%",
              height: "calc(100vh - 180px)",
              minHeight: 520,
            }}
          >
            {/* LEFT: Charts */}
            <Box
              style={{
                width: `${splitPct}%`,
                paddingRight: 12,
                minWidth: 320,
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
                overflow: "hidden",
              }}
            >
              <FlightStatsPanel
                show={showStats}
                segmentStats={segmentStats as any}
                varioWindowSec={varioWindowSec}
                statsSource={statsSource}
                climbNavActive={climbNavActive}
                activeClimbIndex={activeClimbIndex}
                climbsLength={climbs.length}
                statsRange={statsRange}
                winTotalSec={winTotalSec}
              />

              <Box style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                {showAlt && (
                  <Box style={{ flex: 1, minHeight: 140, display: "flex", flexDirection: "column" }}>
                    <Text size="sm" fw={600} mb={4}>
                      Altitude
                    </Text>
                    <EChartsReact
                      onEvents={chartEvents}
                      echarts={echarts}
                      option={altOption}
                      style={{ height: "100%", width: "100%" }}
                      notMerge={false}
                      replaceMerge={["series"]}
                      onChartReady={makeOnChartReady("alt")}
                    />
                  </Box>
                )}

                {showVario && (
                  <Box style={{ flex: 1, minHeight: 140, display: "flex", flexDirection: "column" }}>
                    <Text size="sm" fw={600} mb={4}>
                      Vertical speed (Vario)
                    </Text>
                    <EChartsReact
                      onEvents={chartEvents}
                      echarts={echarts}
                      option={varioOption}
                      style={{ height: "100%", width: "100%" }}
                      notMerge={false}
                      replaceMerge={["series"]}
                      onChartReady={makeOnChartReady("vario")}
                    />
                  </Box>
                )}

                {showSpeed && (
                  <Box style={{ flex: 1, minHeight: 140, display: "flex", flexDirection: "column" }}>
                    <Text size="sm" fw={600} mb={4}>
                      Horizontal speed
                    </Text>
                    <EChartsReact
                      onEvents={chartEvents}
                      echarts={echarts}
                      option={speedOption}
                      style={{ height: "100%", width: "100%" }}
                      notMerge={false}
                      replaceMerge={["series"]}
                      onChartReady={makeOnChartReady("speed")}
                    />
                  </Box>
                )}

                {!showAlt && !showVario && !showSpeed && (
                  <Paper withBorder p="md" radius="md">
                    <Text c="dimmed" size="sm">
                      No charts selected.
                    </Text>
                  </Paper>
                )}
              </Box>
            </Box>

            {/* MIDDLE: Splitter */}
            <Box
              onPointerDown={onDividerPointerDown}
              style={{
                width: 12,
                cursor: "col-resize",
                userSelect: "none",
                touchAction: "none",
                display: "flex",
                alignItems: "stretch",
                marginRight: 12,
              }}
            >
              <Box style={{ width: 1, margin: "0 auto", background: "var(--mantine-color-gray-3)" }} />
            </Box>

            {/* RIGHT: Map */}
            <Box style={{ width: `${100 - splitPct}%`, minWidth: 280, display: "flex", flexDirection: "column", minHeight: 0 }}>
              <Text size="sm" fw={600} mb={4}>
                Map
              </Text>
              <Box
                style={{
                  flex: 1,
                  minHeight: 0,
                  borderRadius: 12,
                  transition: "box-shadow 180ms ease, transform 180ms ease",
                  boxShadow: pulseActive ? "0 0 0 2px rgba(255, 212, 0, 0.65)" : undefined,
                  transform: pulseActive ? "scale(1.002)" : undefined,
                  overflow: "hidden",
                }}
              >
                <FlightMap
                  fixesFull={mapFixesFull}
                  fixesLite={mapFixesLite}
                  thermals={mapThermals}
                  activeClimb={activeClimb ? { startIdx: activeClimb.startIdx, endIdx: activeClimb.endIdx } : null}
                  watchKey={`${id}-${baseMap}`}
                  focusKey={mapFocusKey}
                />
              </Box>
            </Box>
          </Box>
        )}
      </Stack>
    </Box>
  );
}