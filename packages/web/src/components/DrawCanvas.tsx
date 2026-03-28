/**
 * DrawCanvas — plain HTML5 Canvas drawing component with Yjs real-time sync.
 *
 * Tools   : pen (smooth freehand), eraser (stroke-level: erases entire strokes
 *           that the eraser circle touches)
 * Sync    : strokes committed on pointerup → Y.Map → broadcast to all peers
 * Cursors : remote cursors via Yjs awareness rendered as an SVG overlay
 * Undo    : Y.UndoManager per-user (Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z)
 *
 * Canvas coordinates are CSS pixels (no DPI scaling for MVP simplicity).
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

const ERASER_RADIUS = 16;

type Tool = 'pen' | 'eraser';

let _strokeSeq = 0;
function newStrokeId(userId: string): string {
  return `${userId}-${Date.now()}-${++_strokeSeq}`;
}

// ── Canvas rendering ──────────────────────────────────────────────────────────

/**
 * Renders a single stroke onto a 2D context using midpoint smoothing.
 * Single-point strokes render as a filled circle (tap/dot).
 */
function renderStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  const { points, color, lineWidth } = stroke;
  if (points.length === 0) return;

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

  // Quadratic bezier through midpoints for smooth curves
  for (let i = 1; i < points.length - 1; i++) {
    const cur = points[i]!;
    const next = points[i + 1]!;
    const mx = (cur.x + next.x) / 2;
    const my = (cur.y + next.y) / 2;
    ctx.quadraticCurveTo(cur.x, cur.y, mx, my);
  }
  ctx.lineTo(points[points.length - 1]!.x, points[points.length - 1]!.y);
  ctx.stroke();
  ctx.restore();
}

// ── Component ─────────────────────────────────────────────────────────────────

interface DrawCanvasProps {
  roomSlug: string;
  wsUrl?: string;
  userName?: string;
  userColor?: string;
  /** Passed through to Yjs awareness so the YWS server can drive DB heartbeats */
  participantId?: string;
  /** Called whenever the Yjs WebSocket connection status changes */
  onStatusChange?: (status: ConnectionStatus) => void;
  /**
   * Called whenever any peer's Yjs awareness changes (join/leave/cursor).
   * Lets the parent refresh the participant list immediately without waiting
   * for the next poll tick.
   */
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
  // Stable color ref — avoids re-creating the Yjs hook on every render
  const userColor = useRef(userColorProp ?? getRandomParticipantColor()).current;

  const {
    strokes, addStroke, deleteStroke, clearAll,
    setMyCursor, remoteCursors, status, undo, redo,
  } = useYjsCanvas({
    roomSlug, wsUrl, userId, userName, userColor, participantId,
    onAwarenessChange: onParticipantsRefresh,
  });

  // Notify parent of WS status changes (used to pause HTTP heartbeat polling)
  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  // ── Refs ───────────────────────────────────────────────────────────────────

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Drawing state in refs to avoid stale closures in pointer handlers
  const isDrawingRef = useRef(false);
  const activeStrokeRef = useRef<Stroke | null>(null);
  const strokesRef = useRef<Stroke[]>(strokes);
  const toolRef = useRef<Tool>('pen');
  const colorRef = useRef<string>(PRESET_COLORS[0]);
  const lineWidthRef = useRef<LineWidthOption>(LINE_WIDTHS[1]);

  // ── UI state ───────────────────────────────────────────────────────────────

  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState<string>(PRESET_COLORS[0]);
  const [lineWidth, setLineWidth] = useState<LineWidthOption>(LINE_WIDTHS[1]);
  const [isExporting, setIsExporting] = useState(false);

  // Keep refs in sync with state (avoids pointer handler re-creation)
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { lineWidthRef.current = lineWidth; }, [lineWidth]);

  // ── Canvas resize + render ─────────────────────────────────────────────────

  const renderAll = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const stroke of strokesRef.current) {
      renderStroke(ctx, stroke);
    }
    if (activeStrokeRef.current) {
      renderStroke(ctx, activeStrokeRef.current);
    }
  }, []); // reads from refs — no reactive deps needed

  const renderAllRef = useRef(renderAll);
  renderAllRef.current = renderAll;

  // Resize canvas to container dimensions, then re-render.
  // Two useLayoutEffects would fight; use one that handles both.
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

  // Re-render when committed strokes change
  useEffect(() => {
    strokesRef.current = strokes;
    renderAll();
  }, [strokes, renderAll]);

  // ── Pointer helpers ────────────────────────────────────────────────────────

  const getCanvasPos = (e: React.PointerEvent<HTMLCanvasElement>): StrokePoint => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const eraseAt = useCallback(
    (pos: StrokePoint) => {
      for (const stroke of strokesRef.current) {
        for (const pt of stroke.points) {
          if (Math.hypot(pt.x - pos.x, pt.y - pos.y) <= ERASER_RADIUS) {
            deleteStroke(stroke.id);
            break;
          }
        }
      }
    },
    [deleteStroke],
  );

  // ── Pointer handlers ───────────────────────────────────────────────────────

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.currentTarget.setPointerCapture(e.pointerId);
      isDrawingRef.current = true;

      const pos = getCanvasPos(e);

      if (toolRef.current === 'pen') {
        activeStrokeRef.current = {
          id: newStrokeId(userId),
          tool: 'pen',
          color: colorRef.current,
          lineWidth: lineWidthRef.current,
          userId,
          points: [pos],
          complete: false,
        };
        renderAll();
      } else {
        eraseAt(pos);
      }
    },
    [userId, eraseAt, renderAll],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const pos = getCanvasPos(e);
      setMyCursor(pos);

      if (!isDrawingRef.current) return;

      if (toolRef.current === 'pen' && activeStrokeRef.current) {
        activeStrokeRef.current = {
          ...activeStrokeRef.current,
          points: [...activeStrokeRef.current.points, pos],
        };
        renderAll();
      } else if (toolRef.current === 'eraser') {
        eraseAt(pos);
      }
    },
    [setMyCursor, eraseAt, renderAll],
  );

  const handlePointerUp = useCallback(() => {
    isDrawingRef.current = false;
    if (activeStrokeRef.current) {
      addStroke({ ...activeStrokeRef.current, complete: true });
      activeStrokeRef.current = null;
      renderAll();
    }
  }, [addStroke, renderAll]);

  const handlePointerLeave = useCallback(() => {
    setMyCursor(null);
  }, [setMyCursor]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
      else if (!mod && e.key === 'p') setTool('pen');
      else if (!mod && e.key === 'e') setTool('eraser');
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
      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, 'image/png'),
      );
      if (!blob) throw new Error('Canvas export failed');

      // If we have a room session, upload to server for a stable download URL.
      // Otherwise fall back to a local object-URL download (no auth needed).
      if (participantId) {
        // roomId is not directly available here; server resolves from slug via participant auth.
        // We use a sentinel so the server derives the correct roomId.
        try {
          const { downloadUrl } = await uploadExport({
            roomSlug,
            participantId,
            format: 'png',
            blob,
          });
          const a = document.createElement('a');
          a.href = downloadUrl;
          a.download = `drawroom-${roomSlug}.png`;
          a.click();
          return;
        } catch {
          // Fall through to local download on any error
        }
      }

      // Local fallback — no server needed
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

  // ── Derived styles ─────────────────────────────────────────────────────────

  const d = ERASER_RADIUS * 2;
  const eraserCursor = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}">` +
    `<circle cx="${ERASER_RADIUS}" cy="${ERASER_RADIUS}" r="${ERASER_RADIUS - 1}" ` +
    `fill="none" stroke="#555" stroke-width="1.5"/></svg>`,
  );
  const canvasCursor =
    tool === 'eraser'
      ? `url("data:image/svg+xml,${eraserCursor}") ${ERASER_RADIUS} ${ERASER_RADIUS}, crosshair`
      : 'crosshair';

  const statusColor =
    status === 'online' ? '#22c55e' : status === 'connecting' ? '#f59e0b' : '#ef4444';

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

      {/* Remote cursors — SVG overlay, no pointer events */}
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
            const nameWidth = c.userName.length * 7 + 12;
            return (
              <g key={c.clientId} transform={`translate(${cx},${cy})`}>
                <path
                  d="M0 0L0 14L4 10L7 18L9 17L6 9L12 9Z"
                  fill={c.userColor}
                  stroke="white"
                  strokeWidth="1.5"
                />
                <rect
                  x="13" y="-3"
                  width={nameWidth} height="19"
                  rx="4" fill={c.userColor}
                />
                <text
                  x="17" y="12"
                  fontSize="11" fill="white"
                  fontFamily="system-ui, -apple-system, sans-serif"
                  fontWeight="500"
                >
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
        className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-lg"
      >
        {/* Pen */}
        <ToolBtn active={tool === 'pen'} title="Pen (P)" aria-label="Pen tool (P)" onClick={() => setTool('pen')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
          </svg>
        </ToolBtn>

        {/* Eraser */}
        <ToolBtn active={tool === 'eraser'} title="Eraser (E)" aria-label="Eraser tool (E)" onClick={() => setTool('eraser')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/>
            <path d="M22 21H7"/><path d="m5 11 9 9"/>
          </svg>
        </ToolBtn>

        <Divider />

        {/* Color swatches */}
        <div className="flex items-center gap-1" role="group" aria-label="Color palette">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              title={c}
              aria-label={`Color ${c}${color === c ? ' (selected)' : ''}`}
              aria-pressed={color === c}
              onClick={() => { setColor(c); setTool('pen'); }}
              className="h-5 w-5 rounded-full border-2 transition-transform hover:scale-110 focus:outline-none"
              style={{
                backgroundColor: c,
                borderColor: color === c ? '#3b82f6' : c === '#ffffff' ? '#d1d5db' : c,
                transform: color === c ? 'scale(1.2)' : undefined,
              }}
            />
          ))}
          {/* Custom color — rainbow gradient opens native color picker */}
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
              onChange={(e) => { setColor(e.target.value); setTool('pen'); }}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
        </div>

        <Divider />

        {/* Line width */}
        <div role="group" aria-label="Stroke width">
        {LINE_WIDTHS.map((w) => {
          const dot = Math.min(4 + w, 16);
          return (
            <button
              key={w}
              title={`Stroke width ${w}px`}
              aria-label={`Stroke width ${w}px${lineWidth === w && tool === 'pen' ? ' (selected)' : ''}`}
              aria-pressed={lineWidth === w && tool === 'pen'}
              onClick={() => { setLineWidth(w); setTool('pen'); }}
              className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                lineWidth === w && tool === 'pen' ? 'bg-blue-100' : 'hover:bg-gray-100'
              }`}
            >
              <span className="rounded-full bg-gray-700" style={{ width: dot, height: dot }} aria-hidden="true" />
            </button>
          );
        })}
        </div>

        <Divider />

        {/* Undo / Redo */}
        <ToolBtn title="Undo (Ctrl+Z)" aria-label="Undo (Ctrl+Z)" onClick={undo}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 7v6h6"/><path d="M3 13A9 9 0 1 0 6 6.7L3 13"/>
          </svg>
        </ToolBtn>
        <ToolBtn title="Redo (Ctrl+Shift+Z)" aria-label="Redo (Ctrl+Shift+Z)" onClick={redo}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 7v6h-6"/><path d="M21 13A9 9 0 1 1 18 6.7L21 13"/>
          </svg>
        </ToolBtn>

        <Divider />

        {/* Export PNG */}
        <ToolBtn
          title="Export as PNG"
          aria-label={isExporting ? 'Exporting…' : 'Export canvas as PNG'}
          onClick={handleExport}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </ToolBtn>

        {/* Clear */}
        <ToolBtn
          danger
          title="Clear canvas for everyone"
          aria-label="Clear canvas for everyone"
          onClick={() => { if (window.confirm('Clear the canvas for everyone in this room?')) clearAll(); }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 6h18"/><path d="M8 6V4h8v2"/>
            <path d="M19 6l-1 14H6L5 6"/>
          </svg>
        </ToolBtn>

        {/* Connection status */}
        <div
          role="status"
          className="ml-1 h-2 w-2 rounded-full"
          style={{ backgroundColor: statusColor }}
          title={`Connection: ${status}`}
          aria-label={`Connection status: ${status}`}
        />
      </div>
    </div>
  );
}

// ── Small sub-components ──────────────────────────────────────────────────────

interface ToolBtnProps {
  active?: boolean;
  danger?: boolean;
  title: string;
  'aria-label'?: string;
  onClick: () => void;
  children: React.ReactNode;
}

function ToolBtn({ active, danger, title, 'aria-label': ariaLabel, onClick, children }: ToolBtnProps) {
  return (
    <button
      title={title}
      aria-label={ariaLabel ?? title}
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
  return <span className="mx-0.5 h-6 w-px bg-gray-200" />;
}
