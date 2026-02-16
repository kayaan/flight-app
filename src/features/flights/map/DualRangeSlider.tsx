// src/features/flights/components/DualRangeSlider.tsx
import * as React from "react";

type Highlight = { start: number; end: number } | null;

export type DualRangeSliderProps = {
    min: number;
    max: number;
    step?: number;

    /** controlled value */
    value: [number, number];

    /** fires frequently while dragging */
    onChange: (next: [number, number]) => void;

    /** fires once on release */
    onChangeEnd?: (next: [number, number]) => void;

    /** track height in px */
    height?: number;

    /** background highlight segment (e.g. active climb) */
    highlight?: Highlight;

    /** extra height beyond track (total extra, px) */
    highlightBandPx?: number;

    /** visual style of highlight band */
    highlightBandStyle?: "solid" | "stripes";

    /** optional: base track */
    trackBackground?: string;

    /** optional: selection fill between thumbs */
    selectionFill?: string;

    /** optional: outer radius */
    radius?: number;

    /** optional: disable */
    disabled?: boolean;

    /** optional className */
    className?: string;

    /** optional style */
    style?: React.CSSProperties;

    /** optional: label formatter */
    formatLabel?: (v: number) => string;

    /** optional: called on hover (for tooltips etc.) */
    onHoverValue?: (v: number | null) => void;

    /** thumb size (px) */
    thumbSize?: number;

    /** how close click must be to pick a thumb first (px) */
    pickRadiusPx?: number;
};

function clamp(n: number, a: number, b: number) {
    return Math.min(b, Math.max(a, n));
}

function snap(v: number, step: number) {
    if (step <= 0) return v;
    return Math.round(v / step) * step;
}

function toPct(v: number, min: number, max: number) {
    const d = max - min;
    if (d <= 0) return 0;
    return ((v - min) / d) * 100;
}

function fromPx(x: number, width: number, min: number, max: number, step: number) {
    const t = width > 0 ? clamp(x / width, 0, 1) : 0;
    const raw = min + t * (max - min);
    const snapped = snap(raw, step);
    return clamp(snapped, min, max);
}

export function DualRangeSlider({
    min,
    max,
    step = 1,
    value,
    onChange,
    onChangeEnd,

    height = 14,
    highlight = null,
    highlightBandPx = 26,
    highlightBandStyle = "solid",

    trackBackground = "rgba(90,90,95,0.45)",
    selectionFill = "rgba(255,255,255,0.10)",
    radius = 5,

    disabled = false,
    className,
    style,
    formatLabel,
    onHoverValue,

    thumbSize = 18,
    pickRadiusPx = 28,
}: DualRangeSliderProps) {
    const [aRaw, bRaw] = value;

    // keep ordering stable for visuals
    const lo = clamp(Math.min(aRaw, bRaw), min, max);
    const hi = clamp(Math.max(aRaw, bRaw), min, max);

    const loPct = toPct(lo, min, max);
    const hiPct = toPct(hi, min, max);

    const labelText = formatLabel ? formatLabel : (v: number) => String(Math.round(v));

    // highlight band percent
    const hLo = highlight ? clamp(Math.min(highlight.start, highlight.end), min, max) : null;
    const hHi = highlight ? clamp(Math.max(highlight.start, highlight.end), min, max) : null;
    const hLoPct = hLo == null ? null : toPct(hLo, min, max);
    const hHiPct = hHi == null ? null : toPct(hHi, min, max);

    const bandHeight = height + highlightBandPx;
    const bandFill =
        highlightBandStyle === "stripes"
            ? "repeating-linear-gradient(45deg, rgba(255,215,0,1) 0 7px, rgba(0,0,0,1) 7px 14px)"
            : "rgba(255,215,0,0.95)";

    const wrapperRef = React.useRef<HTMLDivElement | null>(null);
    const trackRef = React.useRef<HTMLDivElement | null>(null);

    // which thumb is active: "lo" | "hi" | null
    const activeThumbRef = React.useRef<"lo" | "hi" | null>(null);
    const pointerIdRef = React.useRef<number | null>(null);
    const draggingRef = React.useRef(false);

    const emit = React.useCallback(
        (nextLo: number, nextHi: number) => {
            const a = clamp(nextLo, min, max);
            const b = clamp(nextHi, min, max);
            onChange([a, b]);
        },
        [min, max, onChange]
    );

    const end = React.useCallback(() => {
        if (!onChangeEnd) return;
        onChangeEnd([clamp(lo, min, max), clamp(hi, min, max)]);
    }, [onChangeEnd, lo, hi, min, max]);

    // Hover reporting
    React.useEffect(() => {
        if (!onHoverValue) return;
        const el = wrapperRef.current;
        const tr = trackRef.current;
        if (!el || !tr) return;

        const onMove = (e: MouseEvent) => {
            const r = tr.getBoundingClientRect();
            const x = clamp(e.clientX - r.left, 0, r.width);
            const v = fromPx(x, r.width, min, max, step);
            onHoverValue(v);
        };
        const onLeave = () => onHoverValue(null);

        el.addEventListener("mousemove", onMove);
        el.addEventListener("mouseleave", onLeave);
        return () => {
            el.removeEventListener("mousemove", onMove);
            el.removeEventListener("mouseleave", onLeave);
        };
    }, [onHoverValue, min, max, step]);

    const pickThumb = React.useCallback(
        (x: number, width: number) => {
            // choose nearest thumb unless click is "clearly" on one thumb
            const loX = (loPct / 100) * width;
            const hiX = (hiPct / 100) * width;

            const dLo = Math.abs(x - loX);
            const dHi = Math.abs(x - hiX);

            if (dLo <= pickRadiusPx && dHi > pickRadiusPx) return "lo";
            if (dHi <= pickRadiusPx && dLo > pickRadiusPx) return "hi";

            return dLo <= dHi ? "lo" : "hi";
        },
        [loPct, hiPct, pickRadiusPx]
    );

    const onPointerDown = React.useCallback(
        (e: React.PointerEvent) => {
            if (disabled) return;
            const tr = trackRef.current;
            if (!tr) return;

            // IMPORTANT: stop "double interactions"
            e.preventDefault();
            e.stopPropagation();

            const r = tr.getBoundingClientRect();
            const x = clamp(e.clientX - r.left, 0, r.width);

            const active = pickThumb(x, r.width);
            activeThumbRef.current = active;
            pointerIdRef.current = e.pointerId;
            draggingRef.current = true;

            try {
                tr.setPointerCapture(e.pointerId);
            } catch {
                // ignore
            }

            const v = fromPx(x, r.width, min, max, step);

            if (active === "lo") {
                if (v <= hi) {
                    emit(v, hi);
                } else {
                    // allow crossing: swap + keep dragging "hi"
                    emit(hi, v);
                    activeThumbRef.current = "hi";
                }
            } else {
                if (v >= lo) {
                    emit(lo, v);
                } else {
                    emit(v, lo);
                    activeThumbRef.current = "lo";
                }
            }
        },
        [disabled, pickThumb, min, max, step, lo, hi, emit]
    );

    const onPointerMove = React.useCallback(
        (e: React.PointerEvent) => {
            if (disabled) return;
            if (!draggingRef.current) return;
            const tr = trackRef.current;
            if (!tr) return;

            const pid = pointerIdRef.current;
            if (pid != null && e.pointerId !== pid) return;

            e.preventDefault();
            e.stopPropagation();

            const r = tr.getBoundingClientRect();
            const x = clamp(e.clientX - r.left, 0, r.width);
            const v = fromPx(x, r.width, min, max, step);

            const active = activeThumbRef.current;
            if (!active) return;

            if (active === "lo") {
                if (v <= hi) {
                    emit(v, hi);
                } else {
                    emit(hi, v);
                    activeThumbRef.current = "hi";
                }
            } else {
                if (v >= lo) {
                    emit(lo, v);
                } else {
                    emit(v, lo);
                    activeThumbRef.current = "lo";
                }
            }
        },
        [disabled, min, max, step, lo, hi, emit]
    );

    const finishPointer = React.useCallback(
        (e: React.PointerEvent) => {
            if (disabled) return;
            const tr = trackRef.current;
            if (!tr) return;

            const pid = pointerIdRef.current;
            if (pid != null && e.pointerId !== pid) return;

            e.preventDefault();
            e.stopPropagation();

            draggingRef.current = false;
            activeThumbRef.current = null;

            try {
                tr.releasePointerCapture(e.pointerId);
            } catch {
                // ignore
            }
            pointerIdRef.current = null;

            end();
        },
        [disabled, end]
    );

    // styles
    const bandStyle: React.CSSProperties =
        hLoPct != null && hHiPct != null && hHiPct > hLoPct
            ? {
                position: "absolute",
                left: `${hLoPct}%`,
                width: `${hHiPct - hLoPct}%`,
                top: "50%",
                transform: "translateY(-50%)",
                height: bandHeight,
                borderRadius: radius,
                background: bandFill,
                boxShadow: "0 0 0 2px rgba(0,0,0,1), 0 0 18px rgba(255,215,0,0.85)",
                pointerEvents: "none",
                zIndex: 1,
            }
            : { display: "none" };

    const trackStyle: React.CSSProperties = {
        position: "relative",
        height,
        borderRadius: radius,
        background: trackBackground,
        boxShadow: "inset 0 0 0 2px rgba(0,0,0,0.85)",
        zIndex: 2,
    };

    const selectionStyle: React.CSSProperties = {
        position: "absolute",
        left: `${loPct}%`,
        width: `${Math.max(0, hiPct - loPct)}%`,
        top: 0,
        bottom: 0,
        borderRadius: radius,
        background: selectionFill,
        pointerEvents: "none",
    };

    const thumbBase: React.CSSProperties = {
        position: "absolute",
        top: "50%",
        transform: "translate(-50%, -50%)",
        width: thumbSize,
        height: thumbSize,
        borderRadius: 999,
        border: "3px solid rgba(0,0,0,0.95)",
        background: "rgba(255,255,255,1)",
        boxShadow: "0 0 0 2px rgba(0,0,0,0.35)",
        cursor: disabled ? "default" : "pointer",
        zIndex: 4,
    };

    const loThumbStyle: React.CSSProperties = {
        ...thumbBase,
        left: `${loPct}%`,
        zIndex: 5,
    };

    const hiThumbStyle: React.CSSProperties = {
        ...thumbBase,
        left: `${hiPct}%`,
        zIndex: 6,
    };

    return (
        <div
            ref={wrapperRef}
            className={`dual-range ${className ?? ""}`}
            style={{
                position: "relative",
                padding: "12px 0", // more breathing room so band doesn't hide under map
                ...style,
                opacity: disabled ? 0.7 : 1,
                userSelect: "none",
                WebkitTapHighlightColor: "transparent",
            }}
        >
            {/* BIG highlight band (extends above+below track) */}
            <div style={bandStyle} />

            {/* Track + thumbs (single pointer surface) */}
            <div
                ref={trackRef}
                style={trackStyle}
                role="slider"
                aria-valuemin={min}
                aria-valuemax={max}
                aria-valuenow={lo}
                aria-label={`Range (${labelText(lo)} to ${labelText(hi)})`}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={finishPointer}
                onPointerCancel={finishPointer}
                onPointerLeave={(e) => {
                    // if you drag outside, pointer capture keeps us; leave can be ignored
                    if (!draggingRef.current) return;
                    e.preventDefault();
                    e.stopPropagation();
                }}
            >
                <div style={selectionStyle} />

                {/* thumbs */}
                <div
                    style={loThumbStyle}
                    aria-label={`Range start (${labelText(lo)})`}
                    onPointerDown={(e) => {
                        // force-pick this thumb (prevents “second thumb appears”)
                        if (disabled) return;
                        e.preventDefault();
                        e.stopPropagation();
                        activeThumbRef.current = "lo";
                        // delegate to track handler with correct coords
                        onPointerDown(e as any);
                    }}
                />
                <div
                    style={hiThumbStyle}
                    aria-label={`Range end (${labelText(hi)})`}
                    onPointerDown={(e) => {
                        if (disabled) return;
                        e.preventDefault();
                        e.stopPropagation();
                        activeThumbRef.current = "hi";
                        onPointerDown(e as any);
                    }}
                />
            </div>
        </div>
    );
}

export default DualRangeSlider;
