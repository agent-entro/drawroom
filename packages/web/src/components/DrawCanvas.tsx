/**
 * DrawCanvas — pixel-paint style collaborative canvas.
 *
 * Tools  : pen (freehand), eraser (pixel erase), fill (flood fill),
 *          rect (rectangle), ellipse
 * Sync   : all ops committed on pointer-up → Y.Map, broadcast via Yjs
 *          Fill ops committed on pointer-down (no drag needed)
 *          Shape previews sent via Yjs awareness during drag
 * Render : ops sorted by createdAt — deterministic replay for fill
 * Undo   : Y.UndoManager per-user
 */

import { useRef, useEffect, useLayoutEffect, useState, useCallback } from 'react';
import { getUserId, getUserName } from '../lib/user.ts';
import { getRandomParticipantColor } from '../lib/colors.ts';
import { useYjsCanvas, type Stroke, type StrokePoint, type ConnectionStatus } from '../hooks/useYjsCanvas.ts';
import { uploadExport } from '../lib/api.ts';

// ── Constants ─────────────────────────────────────────────────────────────────

const PRESET_COLORS = [
  '#1a1a1a', '#ef4444', '#f97316', '#eab308',
  '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899',
  '#ffffff',
] as const;

const LINE_WIDTHS = [2, 6, 14] as const;
type LineWidthOption = (typeof LINE_WIDTHS)[number];

type Tool = 'pen' | 'eraser' | 'fill' | 'rect' | 'ellipse';

let _strokeSeq = 0;
function newOpId(userId: string): string {
  return `${userId}-${Date.now()}-${++_strokeSeq}`;
}

// ── Color parsing ─────────────────────────────────────────────────────────────

// Cached 1×1 canvas for CSS color → RGBA conversion
let _colorCanvas: HTMLCanvasElement | null = null;
let _colorCtx: CanvasRenderingContext2D | null = null;

function parseColorToRGBA(color: string): [number, number, number, number] {
  if (!_colorCanvas) {
    _colorCanvas = document.createElement('canvas');
    _colorCanvas.width = _colorCanvas.height = 1;
    _colorCtx = _colorCanvas.getContext('2d')!;
  }
  const ctx = _colorCtx!;
  // Reset to transparent before sampling (handles semi-transparent colors)
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0]!, d[1]!, d[2]!, d[3]!];
}

// ── Flood fill ────────────────────────────────────────────────────────────────

/**
 * Stack-based DFS flood fill on raw ImageData.
 * Fills contiguous pixels matching the target color at (startX, startY).
 * Mutates `data` in place.
 */
function floodFill(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  fillR: number, fillG: number, fillB: number, fillA: number,
): void {
  const sx = Math.round(startX);
  const sy = Math.round(startY);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return;

  const idx0 = (sy * width + sx) * 4;
  const targetR = data[idx0]!;
  const targetG = data[idx0 + 1]!;
  const targetB = data[idx0 + 2]!;
  const targetA = data[idx0 + 3]!;

  // Nothing to do if already the fill color
  if (targetR === fillR && targetG === fillG && targetB === fillB && targetA === fillA) return;

  const matches = (i: number): boolean =>
    data[i] === targetR &&
    data[i + 1] === targetG &&
    data[i + 2] === targetB &&
    data[i + 3] === targetA;

  // Stack holds flat pixel indices (not *4 multiplied)
  const stack: number[] = [sy * width + sx];

  while (stack.length > 0) {
    const pos = stack.pop()!;
    const i = pos * 4;
    if (!matches(i)) continue; // already filled or wrong color

    // Fill pixel
    data[i] = fillR;
    data[i + 1] = fillG;
    data[i + 2] = fillB;
    data[i + 3] = fillA;

    const px = pos % width;
    const py = (pos / width) | 0;

    if (px > 0)          stack.push(pos - 1);
    if (px < width - 1)  stack.push(pos + 1);
    if (py > 0)          stack.push(pos - width);
    if (py < height - 1) stack.push(pos + width);
  }
}

// ── Op rendering ──────────────────────────────────────────────────────────────

function renderPenOp(ctx: CanvasRenderingContext2D, op: Stroke): void {
  const { points, color, lineWidth } = op;
  if (!points || points.length === 0) return;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'source-over';

  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0]!.x, points[0]!.y, lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);
  for (let i = 1; i < points.length - 1; i++) {
    const cur = points[i]!;
    const next = points[i + 1]!;
    ctx.quadraticCurveTo(cur.x, cur.y, (cur.x + next.x) / 2, (cur.y + next.y) / 2);
  }
  ctx.lineTo(points[points.length - 1]!.x, points[points.length - 1]!.y);
  ctx.stroke();
  ctx.restore();
}

function renderEraserOp(ctx: CanvasRenderingContext2D, op: Stroke): void {
  // Eraser = white paint (pixel erase)
  renderPenOp(ctx, { ...op, color: '#ffffff' });
}

function renderRectOp(ctx: CanvasRenderingContext2D, op: Stroke): void {
  const { shapeX = 0, shapeY = 0, shapeW = 0, shapeH = 0, shapeFilled, color, lineWidth } = op;
  if (shapeW === 0 && shapeH === 0) return;

  // Normalize negative dimensions (drag up/left)
  const x = shapeW >= 0 ? shapeX : shapeX + shapeW;
  const y = shapeH >= 0 ? shapeY : shapeY + shapeH;
  const w = Math.abs(shapeW);
  const h = Math.abs(shapeH);

  ctx.save();
  if (shapeFilled) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  } else {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.strokeRect(x, y, w, h);
  }
  ctx.restore();
}

function renderEllipseOp(ctx: CanvasRenderingContext2D, op: Stroke): void {
  const { shapeX = 0, shapeY = 0, shapeW = 0, shapeH = 0, shapeFilled, color, lineWidth } = op;
  if (shapeW === 0 && shapeH === 0) return;

  const cx = shapeX + shapeW / 2;
  const cy = shapeY + shapeH / 2;
  const rx = Math.abs(shapeW / 2);
  const ry = Math.abs(shapeH / 2);

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  if (shapeFilled) {
    ctx.fillStyle = color;
    ctx.fill();
  } else {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Render a single op onto ctx. For fill ops, reads and writes ImageData.
 * `w` and `h` are canvas pixel dimensions (for getImageData).
 */
function renderOp(ctx: CanvasRenderingContext2D, w: number, h: number, op: Stroke): void {
  switch (op.tool) {
    case 'pen':
      renderPenOp(ctx, op);
      break;
    case 'eraser':
      renderEraserOp(ctx, op);
      break;
    case 'fill': {
      if (op.fillX !== undefined && op.fillY !== undefined) {
        const imageData = ctx.getImageData(0, 0, w, h);
        const [fr, fg, fb, fa] = parseColorToRGBA(op.color);
        floodFill(imageData.data, w, h, op.fillX, op.fillY, fr, fg, fb, fa);
        ctx.putImageData(imageData, 0, 0);
      }
      break;
    }
    case 'rect':
      renderRectOp(ctx, op);
      break;
    case 'ellipse':
      renderEllipseOp(ctx, op);
      break;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface DrawCanvasProps {
  roomSlug: string;
  wsUrl?: string;
  userName?: string;
  userColor?: string;
  participantId?: string;
  onStatusChange?: (status: ConnectionStatus) => void;
  onParticipantsRefresh?: () => void;
}

export default function DrawCanvas({
  roomSlug,
  wsUrl = 'ws://localhost:1234',
  userName: userNameProp,
  userColor: userColorProp,
  participantId,
  onStatusChange,
  onParticipantsRefresh,
}: DrawCanvasProps) {
  const userId = getUserId();
  const userName = userNameProp ?? getUserName();
  const userColor = useRef(userColorProp ?? getRandomParticipantColor()).current;

  const {
    strokes, addStroke, clearAll,
    setMyCursor, setMyActiveStroke, remoteCursors, remoteActiveStrokes, status, undo, redo,
  } = useYjsCanvas({
    roomSlug, wsUrl, userId, userName, userColor, participantId,
    onAwarenessChange: onParticipantsRefresh,
  });

  useEffect(() => { onStatusChange?.(status); }, [status, onStatusChange]);

  // ── Refs ───────────────────────────────────────────────────────────────────

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const isDrawingRef = useRef(false);
  const activeStrokeRef = useRef<Stroke | null>(null);
  const shapeStartRef = useRef<StrokePoint | null>(null);
  const strokesRef = useRef<Stroke[]>(strokes);
  const remoteActiveStrokesRef = useRef<Stroke[]>([]);
  const toolRef = useRef<Tool>('pen');
  const colorRef = useRef<string>(PRESET_COLORS[0]);
  const lineWidthRef = useRef<LineWidthOption>(LINE_WIDTHS[1]);
  const shapeFilledRef = useRef<boolean>(true);

  // ── UI state ───────────────────────────────────────────────────────────────

  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState<string>(PRESET_COLORS[0]);
  const [lineWidth, setLineWidth] = useState<LineWidthOption>(LINE_WIDTHS[1]);
  const [shapeFilled, setShapeFilled] = useState<boolean>(true);
  const [isExporting, setIsExporting] = useState(false);

  // Keep refs in sync (avoids pointer handler re-creation)
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { lineWidthRef.current = lineWidth; }, [lineWidth]);
  useEffect(() => { shapeFilledRef.current = shapeFilled; }, [shapeFilled]);

  // ── Canvas render ──────────────────────────────────────────────────────────

  const renderAll = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    // Sort by createdAt for deterministic fill replay
    const sorted = [...strokesRef.current].sort((a, b) => {
      const diff = (a.createdAt ?? 0) - (b.createdAt ?? 0);
      return diff !== 0 ? diff : a.id < b.id ? -1 : 1;
    });

    for (const op of sorted) {
      renderOp(ctx, w, h, op);
    }

    // Remote active strokes (in-progress, from peers)
    for (const op of remoteActiveStrokesRef.current) {
      ctx.globalAlpha = op.tool === 'rect' || op.tool === 'ellipse' ? 0.6 : 1.0;
      renderOp(ctx, w, h, op);
      ctx.globalAlpha = 1.0;
    }

    // Local active stroke / shape preview
    if (activeStrokeRef.current) {
      const isShape = activeStrokeRef.current.tool === 'rect' || activeStrokeRef.current.tool === 'ellipse';
      ctx.globalAlpha = isShape ? 0.6 : 1.0;
      renderOp(ctx, w, h, activeStrokeRef.current);
      ctx.globalAlpha = 1.0;
    }
  }, []);

  const renderAllRef = useRef(renderAll);
  renderAllRef.current = renderAll;

  useLayoutEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const doResize = () => {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      renderAllRef.current();
    };
    doResize();
    const ro = new ResizeObserver(doResize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    strokesRef.current = strokes;
    renderAll();
  }, [strokes, renderAll]);

  useEffect(() => {
    remoteActiveStrokesRef.current = remoteActiveStrokes;
    renderAll();
  }, [remoteActiveStrokes, renderAll]);

  // ── Pointer helpers ────────────────────────────────────────────────────────

  const getCanvasPos = (e: React.PointerEvent<HTMLCanvasElement>): StrokePoint => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // ── Pointer handlers ───────────────────────────────────────────────────────

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.currentTarget.setPointerCapture(e.pointerId);
      isDrawingRef.current = true;
      const pos = getCanvasPos(e);
      const now = Date.now();

      switch (toolRef.current) {
        case 'pen':
        case 'eraser':
          activeStrokeRef.current = {
            id: newOpId(userId),
            tool: toolRef.current,
            color: colorRef.current,
            lineWidth: lineWidthRef.current,
            userId,
            points: [pos],
            complete: false,
            createdAt: now,
          };
          renderAll();
          break;

        case 'fill':
          // Commit immediately — no drag needed
          addStroke({
            id: newOpId(userId),
            tool: 'fill',
            color: colorRef.current,
            lineWidth: lineWidthRef.current,
            userId,
            points: [],
            complete: true,
            createdAt: now,
            fillX: pos.x,
            fillY: pos.y,
          });
          isDrawingRef.current = false;
          break;

        case 'rect':
        case 'ellipse':
          shapeStartRef.current = pos;
          activeStrokeRef.current = {
            id: newOpId(userId),
            tool: toolRef.current,
            color: colorRef.current,
            lineWidth: lineWidthRef.current,
            userId,
            points: [],
            complete: false,
            createdAt: now,
            shapeX: pos.x,
            shapeY: pos.y,
            shapeW: 0,
            shapeH: 0,
            shapeFilled: shapeFilledRef.current,
          };
          renderAll();
          break;
      }
    },
    [userId, addStroke, renderAll],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const pos = getCanvasPos(e);
      setMyCursor(pos);

      if (!isDrawingRef.current) return;

      switch (toolRef.current) {
        case 'pen':
        case 'eraser':
          if (activeStrokeRef.current) {
            activeStrokeRef.current = {
              ...activeStrokeRef.current,
              points: [...activeStrokeRef.current.points, pos],
            };
            setMyActiveStroke(activeStrokeRef.current);
            renderAll();
          }
          break;

        case 'rect':
        case 'ellipse': {
          const start = shapeStartRef.current;
          if (activeStrokeRef.current && start) {
            activeStrokeRef.current = {
              ...activeStrokeRef.current,
              shapeW: pos.x - start.x,
              shapeH: pos.y - start.y,
            };
            setMyActiveStroke(activeStrokeRef.current);
            renderAll();
          }
          break;
        }

        case 'fill':
          // no drag behaviour for fill
          break;
      }
    },
    [setMyCursor, setMyActiveStroke, renderAll],
  );

  const handlePointerUp = useCallback(() => {
    isDrawingRef.current = false;
    if (activeStrokeRef.current) {
      addStroke({ ...activeStrokeRef.current, complete: true });
      activeStrokeRef.current = null;
      shapeStartRef.current = null;
      setMyActiveStroke(null);
      renderAll();
    }
  }, [addStroke, setMyActiveStroke, renderAll]);

  const handlePointerLeave = useCallback(() => {
    setMyCursor(null);
    setMyActiveStroke(null);
  }, [setMyCursor, setMyActiveStroke]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
      else if (!mod && e.key === 'p') setTool('pen');
      else if (!mod && e.key === 'e') setTool('eraser');
      else if (!mod && e.key === 'f') setTool('fill');
      else if (!mod && e.key === 'r') setTool('rect');
      else if (!mod && e.key === 'o') setTool('ellipse');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // ── Export ─────────────────────────────────────────────────────────────────

  const handleExport = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || isExporting) return;
    setIsExporting(true);
    try {
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
      if (!blob) throw new Error('Canvas export failed');

      if (participantId) {
        try {
          const { downloadUrl } = await uploadExport({ roomSlug, participantId, format: 'png', blob });
          const a = document.createElement('a');
          a.href = downloadUrl;
          a.download = `drawroom-${roomSlug}.png`;
          a.click();
          return;
        } catch { /* fall through to local download */ }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `drawroom-${roomSlug}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[DrawCanvas] export error:', err);
    } finally {
      setIsExporting(false);
    }
  }, [isExporting, participantId, roomSlug]);

  // ── Cursor style ───────────────────────────────────────────────────────────

  const canvasCursor = (() => {
    if (tool === 'eraser') {
      const r = Math.max(lineWidth, 4);
      const d = r * 2;
      const svg = encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}">` +
        `<circle cx="${r}" cy="${r}" r="${r - 1}" fill="none" stroke="#555" stroke-width="1.5"/></svg>`,
      );
      return `url("data:image/svg+xml,${svg}") ${r} ${r}, crosshair`;
    }
    if (tool === 'fill') return 'cell';
    return 'crosshair';
  })();

  const statusColor =
    status === 'online' ? '#22c55e' : status === 'connecting' ? '#f59e0b' : '#ef4444';

  const isShapeTool = tool === 'rect' || tool === 'ellipse';

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden bg-white">
      {/* Drawing surface */}
      <canvas
        ref={canvasRef}
        aria-label="Collaborative drawing canvas"
        role="img"
        className="absolute inset-0 touch-none select-none"
        style={{ cursor: canvasCursor }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerLeave}
      />

      {/* Remote cursors */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ width: '100%', height: '100%' }}
      >
        {remoteCursors
          .filter((c) => c.cursor !== null)
          .map((c) => {
            const cx = c.cursor!.x;
            const cy = c.cursor!.y;
            const nw = c.userName.length * 7 + 12;
            return (
              <g key={c.clientId} transform={`translate(${cx},${cy})`}>
                <path
                  d="M0 0L0 14L4 10L7 18L9 17L6 9L12 9Z"
                  fill={c.userColor} stroke="white" strokeWidth="1.5"
                />
                <rect x="13" y="-3" width={nw} height="19" rx="4" fill={c.userColor} />
                <text x="17" y="12" fontSize="11" fill="white"
                  fontFamily="system-ui, -apple-system, sans-serif" fontWeight="500">
                  {c.userName}
                </text>
              </g>
            );
          })}
      </svg>

      {/* Toolbar */}
      <div
        role="toolbar"
        aria-label="Drawing tools"
        className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-gray-200 bg-white px-2.5 py-2 shadow-lg"
      >
        {/* ── Tools ── */}
        <ToolBtn active={tool === 'pen'} title="Pen (P)" onClick={() => setTool('pen')}>
          <IconPen />
        </ToolBtn>
        <ToolBtn active={tool === 'eraser'} title="Eraser (E)" onClick={() => setTool('eraser')}>
          <IconEraser />
        </ToolBtn>
        <ToolBtn active={tool === 'fill'} title="Fill (F)" onClick={() => setTool('fill')}>
          <IconFill />
        </ToolBtn>
        <ToolBtn active={tool === 'rect'} title="Rectangle (R)" onClick={() => setTool('rect')}>
          <IconRect />
        </ToolBtn>
        <ToolBtn active={tool === 'ellipse'} title="Ellipse (O)" onClick={() => setTool('ellipse')}>
          <IconEllipse />
        </ToolBtn>

        <Divider />

        {/* ── Shape fill/outline toggle (always visible, grayed when not a shape tool) ── */}
        <button
          title={shapeFilled ? 'Shapes: filled (click for outline)' : 'Shapes: outline (click for filled)'}
          aria-label={shapeFilled ? 'Switch to outline shapes' : 'Switch to filled shapes'}
          onClick={() => setShapeFilled((f) => !f)}
          className={[
            'flex h-7 items-center gap-1 rounded-lg px-1.5 text-xs font-medium transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
            isShapeTool
              ? shapeFilled
                ? 'bg-blue-100 text-blue-700'
                : 'bg-gray-100 text-gray-700'
              : 'text-gray-300 cursor-default',
          ].join(' ')}
          disabled={!isShapeTool}
        >
          {shapeFilled
            ? <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true"><rect x="1" y="1" width="11" height="11" fill="currentColor" rx="1"/></svg>
            : <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true"><rect x="1" y="1" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" rx="1"/></svg>
          }
          <span>{shapeFilled ? 'Fill' : 'Line'}</span>
        </button>

        <Divider />

        {/* ── Colors ── */}
        <div className="flex items-center gap-1" role="group" aria-label="Color palette">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              title={c}
              aria-label={`Color ${c}${color === c ? ' (selected)' : ''}`}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              className="h-5 w-5 rounded-full border-2 transition-transform hover:scale-110 focus:outline-none"
              style={{
                backgroundColor: c,
                borderColor: color === c ? '#3b82f6' : c === '#ffffff' ? '#d1d5db' : c,
                transform: color === c ? 'scale(1.2)' : undefined,
              }}
            />
          ))}
          {/* Custom color picker */}
          <label
            title="Custom color"
            aria-label="Custom color picker"
            className="relative h-5 w-5 cursor-pointer overflow-hidden rounded-full border-2 transition-transform hover:scale-110"
            style={{
              background: 'conic-gradient(red,yellow,lime,aqua,blue,magenta,red)',
              borderColor: (PRESET_COLORS as readonly string[]).includes(color) ? '#d1d5db' : '#3b82f6',
            }}
          >
            <input
              type="color"
              value={color}
              aria-label="Custom color"
              onChange={(e) => setColor(e.target.value)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
        </div>

        <Divider />

        {/* ── Line width (also controls eraser size) ── */}
        <div role="group" aria-label="Stroke width">
          {LINE_WIDTHS.map((w) => {
            const dot = Math.min(4 + w, 16);
            return (
              <button
                key={w}
                title={`Width ${w}px`}
                aria-label={`Width ${w}px${lineWidth === w ? ' (selected)' : ''}`}
                aria-pressed={lineWidth === w}
                onClick={() => setLineWidth(w)}
                className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                  lineWidth === w ? 'bg-blue-100' : 'hover:bg-gray-100'
                }`}
              >
                <span className="rounded-full bg-gray-700" style={{ width: dot, height: dot }} aria-hidden="true" />
              </button>
            );
          })}
        </div>

        <Divider />

        {/* ── Undo / Redo ── */}
        <ToolBtn title="Undo (Ctrl+Z)" onClick={undo}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 7v6h6"/><path d="M3 13A9 9 0 1 0 6 6.7L3 13"/>
          </svg>
        </ToolBtn>
        <ToolBtn title="Redo (Ctrl+Shift+Z)" onClick={redo}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 7v6h-6"/><path d="M21 13A9 9 0 1 1 18 6.7L21 13"/>
          </svg>
        </ToolBtn>

        <Divider />

        {/* ── Export / Clear ── */}
        <ToolBtn title={isExporting ? 'Exporting…' : 'Export PNG'} onClick={handleExport}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </ToolBtn>
        <ToolBtn danger title="Clear canvas" onClick={() => {
          if (window.confirm('Clear the canvas for everyone in this room?')) clearAll();
        }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>
          </svg>
        </ToolBtn>

        {/* ── Status indicator ── */}
        <div
          role="status"
          className="ml-1 h-2 w-2 rounded-full"
          style={{ backgroundColor: statusColor }}
          title={`Connection: ${status}`}
          aria-label={`Connection: ${status}`}
        />
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface ToolBtnProps {
  active?: boolean;
  danger?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}

function ToolBtn({ active, danger, title, onClick, children }: ToolBtnProps) {
  return (
    <button
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={[
        'flex h-7 w-7 items-center justify-center rounded-lg transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
        active
          ? 'bg-blue-100 text-blue-700'
          : danger
          ? 'text-gray-500 hover:bg-red-50 hover:text-red-600'
          : 'text-gray-600 hover:bg-gray-100',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-0.5 h-6 w-px bg-gray-200" aria-hidden="true" />;
}

// ── Tool icons ────────────────────────────────────────────────────────────────

function IconPen() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
    </svg>
  );
}

function IconEraser() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/>
      <path d="M22 21H7"/><path d="m5 11 9 9"/>
    </svg>
  );
}

function IconFill() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 11V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v7"/>
      <path d="M3 15h18"/>
      <path d="M21 19a2 2 0 1 1-4 0c0-1.6 2-4 2-4s2 2.4 2 4Z"/>
      <path d="m5 8 4 4"/>
    </svg>
  );
}

function IconRect() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="1"/>
    </svg>
  );
}

function IconEllipse() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <ellipse cx="12" cy="12" rx="10" ry="7"/>
    </svg>
  );
}
