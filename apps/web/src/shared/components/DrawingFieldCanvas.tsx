/**
 * DrawingFieldCanvas — tablet drawing capture for cognitive scales
 * (P-CLAUDE-LANE 4B).
 *
 * Used by:
 *   - MMSE: intersecting pentagons copy
 *   - MoCA: cube copy + clock-draw 11:10
 *
 * Storage shape: a serialised DrawingPayload (see
 * packages/shared/src/drawingPayload.ts) round-tripped through the
 * FormValues string slot via serializeDrawingPayload /
 * tryParseDrawingPayload. The component is intentionally controlled —
 * the caller owns the value and the change handler; no internal
 * "uncommitted" state escapes the next render.
 *
 * Pointer model: PointerEvents API with setPointerCapture, so pen +
 * touch + mouse all flow through the same code path and cross-element
 * drag doesn't lose strokes mid-flight.
 *
 * Backing-store strategy: the canvas backing store is fixed at the
 * stored payload's width × height (default 800 × 500). The on-screen
 * CSS width is responsive (`max-width: 100%`). All persisted point
 * coordinates are in the backing-store frame so two clinicians on
 * different-sized tablets see the same drawing geometry.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import ClearIcon from '@mui/icons-material/Delete';
import UndoIcon from '@mui/icons-material/Undo';
import {
  DRAWING_PAYLOAD_SCHEMA_VERSION,
  isDrawingPayloadCaptured,
  serializeDrawingPayload,
  tryParseDrawingPayload,
  type DrawingPayload,
} from '@signacare/shared';
import {
  DRAWING_FIELD_DEFAULT_HEIGHT,
  DRAWING_FIELD_DEFAULT_WIDTH,
  makeEmptyDrawingFieldPayload,
} from './drawingField';

interface DrawingFieldCanvasProps {
  label?: string;
  value: string | number | string[] | undefined;
  onValueChange: (next: string) => void;
  readOnly?: boolean;
  width?: number;
  height?: number;
}

interface InFlightStroke {
  color: string;
  width: number;
  points: Array<{ x: number; y: number; t: number; pressure: number }>;
}

const STROKE_COLOR = '#1F2937';
const STROKE_WIDTH = 2.5;

function clonePayload(p: DrawingPayload): DrawingPayload {
  return {
    schemaVersion: p.schemaVersion,
    width: p.width,
    height: p.height,
    strokes: p.strokes.map((s) => ({
      color: s.color,
      width: s.width,
      points: s.points.map((pt) => ({ ...pt })),
    })),
  };
}

function emitChange(payload: DrawingPayload, onValueChange: (s: string) => void) {
  onValueChange(serializeDrawingPayload(payload));
}

export function DrawingFieldCanvas({
  label, value, onValueChange, readOnly = false,
  width = DRAWING_FIELD_DEFAULT_WIDTH,
  height = DRAWING_FIELD_DEFAULT_HEIGHT,
}: DrawingFieldCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inFlightStrokeRef = useRef<InFlightStroke | null>(null);
  const strokeStartRef = useRef<number>(0);

  const parsedFromValue = useMemo<DrawingPayload | null>(() => {
    if (typeof value !== 'string') return null;
    return tryParseDrawingPayload(value);
  }, [value]);

  const initialPayload = useMemo<DrawingPayload>(() => {
    if (parsedFromValue && parsedFromValue.width === width && parsedFromValue.height === height) {
      return parsedFromValue;
    }
    if (parsedFromValue) {
      return { ...parsedFromValue, width, height };
    }
    return makeEmptyDrawingFieldPayload(width, height);
  }, [parsedFromValue, width, height]);

  const [payload, setPayload] = useState<DrawingPayload>(initialPayload);

  useEffect(() => {
    if (parsedFromValue && parsedFromValue !== payload) {
      const next: DrawingPayload =
        parsedFromValue.width === width && parsedFromValue.height === height
          ? parsedFromValue
          : { ...parsedFromValue, width, height };
      setPayload(next);
    }
  }, [parsedFromValue, width, height, payload]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stroke of payload.strokes) {
      const points = stroke.points;
      if (points.length === 0) continue;
      ctx.strokeStyle = stroke.color ?? STROKE_COLOR;
      ctx.lineWidth = stroke.width ?? STROKE_WIDTH;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i += 1) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.stroke();
    }
    const inFlight = inFlightStrokeRef.current;
    if (inFlight && inFlight.points.length > 0) {
      ctx.strokeStyle = inFlight.color;
      ctx.lineWidth = inFlight.width;
      ctx.beginPath();
      ctx.moveTo(inFlight.points[0].x, inFlight.points[0].y);
      for (let i = 1; i < inFlight.points.length; i += 1) {
        ctx.lineTo(inFlight.points[i].x, inFlight.points[i].y);
      }
      ctx.stroke();
    }
  }, [payload]);

  useEffect(() => { redraw(); }, [redraw]);

  const toCanvasCoords = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / Math.max(rect.width, 1);
    const sy = canvas.height / Math.max(rect.height, 1);
    return {
      x: (e.clientX - rect.left) * sx,
      y: (e.clientY - rect.top) * sy,
    };
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (readOnly) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // intentional silent — setPointerCapture throws NotSupportedError
    // on pointers that don't support capture (e.g. some hover-only
    // mice); the drawing flow still works without capture, so we
    // proceed rather than abort.
    try { canvas.setPointerCapture(e.pointerId); } catch { /* see comment above */ }
    const start = (typeof performance !== 'undefined' ? performance.now() : 0);
    strokeStartRef.current = start;
    const { x, y } = toCanvasCoords(e);
    inFlightStrokeRef.current = {
      color: STROKE_COLOR,
      width: STROKE_WIDTH,
      points: [{ x, y, t: 0, pressure: Math.min(Math.max(e.pressure || 0.5, 0), 1) }],
    };
    redraw();
  }, [readOnly, redraw, toCanvasCoords]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const inFlight = inFlightStrokeRef.current;
    if (!inFlight) return;
    const { x, y } = toCanvasCoords(e);
    const now = (typeof performance !== 'undefined' ? performance.now() : 0);
    inFlight.points.push({
      x, y,
      t: Math.max(now - strokeStartRef.current, 0),
      pressure: Math.min(Math.max(e.pressure || 0.5, 0), 1),
    });
    redraw();
  }, [redraw, toCanvasCoords]);

  const handlePointerEnd = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const inFlight = inFlightStrokeRef.current;
    if (!inFlight) return;
    inFlightStrokeRef.current = null;
    const canvas = canvasRef.current;
    if (canvas) {
      // intentional silent — releasePointerCapture throws if the
      // pointer was never captured (the setPointerCapture above can
      // be skipped on unsupported pointers); the drawing flow has
      // already finished, so there's nothing to recover.
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* see comment above */ }
    }
    if (inFlight.points.length === 0) {
      redraw();
      return;
    }
    const next = clonePayload(payload);
    next.strokes.push({
      color: inFlight.color,
      width: inFlight.width,
      points: inFlight.points,
    });
    setPayload(next);
    emitChange(next, onValueChange);
  }, [payload, onValueChange, redraw]);

  const handleUndo = useCallback(() => {
    if (readOnly) return;
    if (payload.strokes.length === 0) return;
    const next = clonePayload(payload);
    next.strokes.pop();
    setPayload(next);
    emitChange(next, onValueChange);
  }, [payload, readOnly, onValueChange]);

  const handleClear = useCallback(() => {
    if (readOnly) return;
    if (payload.strokes.length === 0) return;
    const next: DrawingPayload = {
      schemaVersion: DRAWING_PAYLOAD_SCHEMA_VERSION,
      width: payload.width,
      height: payload.height,
      strokes: [],
    };
    setPayload(next);
    emitChange(next, onValueChange);
  }, [payload, readOnly, onValueChange]);

  const captured = isDrawingPayloadCaptured(payload);

  return (
    <Box sx={{ my: 1.5 }}>
      {label && (
        <Typography variant="body2" fontWeight={500} sx={{ mb: 0.5, fontSize: 13 }}>
          {label}
        </Typography>
      )}
      <Box
        sx={{
          border: '1px solid #d6cfc4',
          borderRadius: 1,
          bgcolor: '#fff',
          width: '100%',
          maxWidth: width,
          mx: 'auto',
        }}
      >
        <canvas
          ref={canvasRef}
          width={payload.width}
          height={payload.height}
          aria-label={label ?? 'Drawing capture'}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onPointerLeave={handlePointerEnd}
          style={{
            display: 'block',
            width: '100%',
            height: 'auto',
            touchAction: 'none',
            cursor: readOnly ? 'default' : 'crosshair',
          }}
        />
      </Box>
      <Stack direction="row" spacing={1} sx={{ mt: 0.75, justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="caption" color={captured ? 'text.secondary' : 'text.disabled'} sx={{ fontSize: 11 }}>
          {captured ? `${payload.strokes.length} stroke${payload.strokes.length === 1 ? '' : 's'} captured` : 'No drawing captured'}
        </Typography>
        {!readOnly && (
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="text"
              startIcon={<UndoIcon fontSize="small" />}
              onClick={handleUndo}
              disabled={payload.strokes.length === 0}
              sx={{ textTransform: 'none', fontSize: 12 }}
            >
              Undo
            </Button>
            <Button
              size="small"
              variant="text"
              startIcon={<ClearIcon fontSize="small" />}
              onClick={handleClear}
              disabled={payload.strokes.length === 0}
              sx={{ textTransform: 'none', fontSize: 12, color: '#b8621a' }}
            >
              Clear
            </Button>
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
