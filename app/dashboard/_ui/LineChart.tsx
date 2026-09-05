'use client';

/**
 * LineChart — zero-dependency SVG line/area chart for the analytics
 * pages. Deliberately small: linear scales, four y-gridlines, optional
 * markers (retention drop cliffs, with a frame image + description card),
 * an optional horizontal threshold reference line, and a nearest-point
 * hover tooltip driven by a single onMouseMove on the svg.
 *
 * Also exports Sparkline, the inline table variant that replaces the old
 * ASCII miniSparkline on the retention page.
 */

import * as React from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';

export interface ChartSeriesPoint {
  x: number;
  y: number;
}

export interface ChartMarker {
  x: number;
  label: string;
  imageUrl?: string;
  description?: string;
}

type Props = {
  points: ChartSeriesPoint[];
  width?: number;
  height?: number;
  xFormat?: (x: number) => string;
  yFormat?: (y: number) => string;
  /** Fixed y-domain (e.g. [0, 100] for retention). Defaults to data extent. */
  yDomain?: [number, number];
  /** Vertical dashed rules + dots at these x positions (drop cliffs). */
  markers?: ChartMarker[];
  /** Horizontal dashed reference line (e.g. the hook-hold flag threshold). */
  thresholdY?: number;
  color?: string;
  /** Area fill under the line at low opacity. */
  fill?: boolean;
};

const PAD = { top: 10, right: 14, bottom: 22, left: 44 };

export function LineChart({
  points,
  width = 640,
  height = 220,
  xFormat = (x) => String(Math.round(x)),
  yFormat = (y) => String(Math.round(y)),
  yDomain,
  markers = [],
  thresholdY,
  color = 'var(--threshold-purple)',
  fill = false,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ px: number; py: number; point: ChartSeriesPoint } | null>(null);
  const [activeMarker, setActiveMarker] = useState<number | null>(null);

  const sorted = useMemo(
    () => [...points].sort((a, b) => a.x - b.x),
    [points],
  );

  const { xMin, xMax, yMin, yMax } = useMemo(() => {
    const xs = sorted.map((p) => p.x);
    const ys = sorted.map((p) => p.y);
    const dataYMin = ys.length ? Math.min(...ys) : 0;
    const dataYMax = ys.length ? Math.max(...ys) : 1;
    return {
      xMin: xs.length ? Math.min(...xs) : 0,
      xMax: xs.length ? Math.max(...xs) : 1,
      yMin: yDomain ? yDomain[0] : dataYMin,
      yMax: yDomain ? yDomain[1] : dataYMax === dataYMin ? dataYMin + 1 : dataYMax,
    };
  }, [sorted, yDomain]);

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const sx = useCallback(
    (x: number) => PAD.left + (xMax === xMin ? 0.5 : (x - xMin) / (xMax - xMin)) * plotW,
    [xMin, xMax, plotW],
  );
  const sy = useCallback(
    (y: number) => PAD.top + (1 - (yMax === yMin ? 0.5 : (y - yMin) / (yMax - yMin))) * plotH,
    [yMin, yMax, plotH],
  );

  const linePath = useMemo(() => {
    if (sorted.length === 0) return '';
    return sorted
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`)
      .join(' ');
  }, [sorted, sx, sy]);

  const areaPath = useMemo(() => {
    if (!fill || sorted.length === 0) return '';
    const base = PAD.top + plotH;
    return (
      `${linePath} L${sx(sorted[sorted.length - 1].x).toFixed(1)},${base} ` +
      `L${sx(sorted[0].x).toFixed(1)},${base} Z`
    );
  }, [fill, linePath, sorted, sx, plotH]);

  const gridYs = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i <= 4; i++) out.push(yMin + ((yMax - yMin) * i) / 4);
    return out;
  }, [yMin, yMax]);

  const onMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (sorted.length === 0 || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      // The svg is responsive via viewBox — convert client px to viewBox x.
      const vx = ((e.clientX - rect.left) / rect.width) * width;
      let nearest = sorted[0];
      let best = Infinity;
      for (const p of sorted) {
        const d = Math.abs(sx(p.x) - vx);
        if (d < best) {
          best = d;
          nearest = p;
        }
      }
      setHover({ px: sx(nearest.x), py: sy(nearest.y), point: nearest });
    },
    [sorted, sx, sy, width],
  );

  const marker = activeMarker !== null ? markers[activeMarker] : null;

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {gridYs.map((y) => (
          <g key={y}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={sy(y)}
              y2={sy(y)}
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={sy(y) + 3.5}
              textAnchor="end"
              fontSize={10}
              fill="var(--sterling-silver)"
              style={{ fontFeatureSettings: '"tnum"' }}
            >
              {yFormat(y)}
            </text>
          </g>
        ))}

        {sorted.length > 0 && (
          <>
            <text
              x={sx(xMin)}
              y={height - 6}
              textAnchor="start"
              fontSize={10}
              fill="var(--sterling-silver)"
            >
              {xFormat(xMin)}
            </text>
            <text
              x={sx(xMax)}
              y={height - 6}
              textAnchor="end"
              fontSize={10}
              fill="var(--sterling-silver)"
            >
              {xFormat(xMax)}
            </text>
          </>
        )}

        {typeof thresholdY === 'number' && (
          <line
            x1={PAD.left}
            x2={width - PAD.right}
            y1={sy(thresholdY)}
            y2={sy(thresholdY)}
            stroke="var(--champion-gold)"
            strokeWidth={1}
            strokeDasharray="4 4"
            opacity={0.7}
          />
        )}

        {areaPath && <path d={areaPath} fill={color} opacity={0.12} />}
        {linePath && (
          <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
        )}

        {markers.map((m, i) => (
          <g
            key={`${m.x}-${i}`}
            onMouseEnter={() => setActiveMarker(i)}
            onMouseLeave={() => setActiveMarker(null)}
            onClick={(e) => {
              e.stopPropagation();
              setActiveMarker((cur) => (cur === i ? null : i));
            }}
            style={{ cursor: m.imageUrl || m.description ? 'pointer' : 'default' }}
          >
            <line
              x1={sx(m.x)}
              x2={sx(m.x)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="var(--champion-gold)"
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.8}
            />
            <circle
              cx={sx(m.x)}
              cy={PAD.top + 6}
              r={activeMarker === i ? 5 : 4}
              fill="var(--champion-gold)"
            />
          </g>
        ))}

        {hover && !marker && (
          <circle cx={hover.px} cy={hover.py} r={3.5} fill={color} stroke="var(--clinical-white)" strokeWidth={1} />
        )}
      </svg>

      {hover && !marker && (
        <div
          style={{
            position: 'absolute',
            left: `${(hover.px / width) * 100}%`,
            top: `${(hover.py / height) * 100}%`,
            transform: 'translate(-50%, calc(-100% - 10px))',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-hairline)',
            borderRadius: 6,
            padding: '4px 8px',
            fontSize: 11,
            color: 'var(--clinical-white)',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            fontFeatureSettings: '"tnum"',
          }}
        >
          {xFormat(hover.point.x)} · {yFormat(hover.point.y)}
        </div>
      )}

      {marker && (
        <div
          style={{
            position: 'absolute',
            left: `${(sx(marker.x) / width) * 100}%`,
            top: 0,
            transform: 'translate(-50%, calc(-100% - 6px))',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--champion-gold)',
            borderRadius: 8,
            padding: 8,
            width: 220,
            fontSize: 11,
            color: 'var(--clinical-white)',
            zIndex: 5,
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: marker.imageUrl || marker.description ? 6 : 0 }}>
            {marker.label}
          </div>
          {marker.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={marker.imageUrl}
              alt=""
              style={{ width: '100%', borderRadius: 4, display: 'block', marginBottom: 6 }}
            />
          )}
          {marker.description && (
            <div style={{ color: 'var(--sterling-silver)', lineHeight: 1.4 }}>
              {marker.description}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Inline mini line chart for table cells. */
export function Sparkline({
  points,
  width = 120,
  height = 28,
  color = 'var(--threshold-purple)',
}: {
  points: ChartSeriesPoint[];
  width?: number;
  height?: number;
  color?: string;
}) {
  const sorted = [...points].sort((a, b) => a.x - b.x);
  if (sorted.length < 2) {
    return <span style={{ color: 'var(--sterling-silver)', fontSize: 11 }}>—</span>;
  }
  const xs = sorted.map((p) => p.x);
  const ys = sorted.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const sx = (x: number) => 1 + (xMax === xMin ? 0.5 : (x - xMin) / (xMax - xMin)) * (width - 2);
  const sy = (y: number) =>
    1 + (1 - (yMax === yMin ? 0.5 : (y - yMin) / (yMax - yMin))) * (height - 2);
  const d = sorted
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width, height, display: 'block' }}>
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}
