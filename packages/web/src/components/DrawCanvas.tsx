/**
 * DrawCanvas — pixel-paint style HTML5 Canvas with Yjs real-time sync.
 *
 * Tools   : pen (smooth freehand), eraser (paints white), fill (flood fill),
 *           rect (rectangle), ellipse (circle/ellipse),
 *           rect-select (rectangular selection), circle-select (elliptical selection)
 * Sync    : ops committed on pointerup => Y.Map => broadcast to all peers
 *           fill ops store result spans (not seed) for deterministic replay
 *           stamp ops (pasted selections) stored as data URLs for CRDT-safe replay
 * Cursors : remote cursors via Yjs awareness rendered as SVG overlay
 * Undo    : Y.UndoManager per-user (Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z)
 *
 * Keyboard: P=pen, E=eraser, F=fill, R=rect, C=circle/ellipse, S=rect-select, O=circle-select
 *           Ctrl/Cmd+C=copy selection, Ctrl/Cmd+V=paste, Escape=clear selection
 */

import { useRef, useEffect, useLayoutEffect, useState, useCallback } from 'react';
import * as Y from 'yjs';
import type { WebsocketProvider } from 'y-websocket';
import { getUserId, getUserName } from '../lib/user.ts';
import { getRandomParticipantColor } from '../lib/colors.ts';
import {
  useYjsCanvas,
  type DrawOp,
  type DrawOpTool,
  type FillSpan,
  type StrokePoint,
  type ConnectionStatus,
} from '../hooks/useYjsCanvas.ts';
import { uploadExport } from '../lib/api.ts';

// ── Constants ─────────────────────────────────────────────────────────────────

const PRESET_COLORS = [
  '#1a1a1a', '#ef4444', '#f97316', '#eab308',
  '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899',
  '#ffffff',
] as const;

const LINE_WIDTHS = [2, 6, 14] as const;
type LineWidthOption = (typeof LINE_WIDTHS)[number];

// Flood fill: pixels within this RGBA distance are considered same color.
const FILL_TOLERANCE = 32;

let _opSeq = 0;
function newOpId(userId: string): string {
  return `${userId}-${Date.now()}-${++_opSeq}`;
}

// ── Color utilities ───────────────────────────────────────────────────────────

/** Parse a CSS hex color (#rrggbb or #rgb) to [r, g, b]. */
function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

// ── Flood fill ────────────────────────────────────────────────────────────────

/**
 * Flood fill from (seedX, seedY) on the canvas.
 * Returns the filled region as horizontal spans for compact Yjs storage.
 * Spans are the *result* of the fill — replaying them is CRDT-safe.
 */
function computeFloodFill(
  canvas: HTMLCanvasElement,
  seedX: number,
  seedY: number,
  fillColor: string,
  tolerance: number = FILL_TOLERANCE,
): FillSpan[] {
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  const w = canvas.width;
  const h = canvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  const ix = Math.max(0, Math.min(w - 1, Math.floor(seedX)));
  const iy = Math.max(0, Math.min(h - 1, Math.floor(seedY)));
  const si = (iy * w + ix) * 4;
  const tr = data[si]!;
  const tg = data[si + 1]!;
  const tb = data[si + 2]!;

  // Bail if seed pixel already matches fill color
  const [fr, fg, fb] = hexToRgb(fillColor);
  if (
    Math.abs(tr - fr) <= tolerance &&
    Math.abs(tg - fg) <= tolerance &&
    Math.abs(tb - fb) <= tolerance
  ) {
    return [];
  }

  const visited = new Uint8Array(w * h);
  const stack: number[] = [iy * w + ix];

  while (stack.length > 0) {
    const pos = stack.pop()!;
    if (visited[pos]) continue;

    const x = pos % w;
    const y = (pos / w) | 0;
    const i = pos * 4;

    if (
      Math.abs(data[i]! - tr) > tolerance ||
      Math.abs(data[i + 1]! - tg) > tolerance ||
      Math.abs(data[i + 2]! - tb) > tolerance
    ) {
      continue;
    }

    visited[pos] = 1;
    if (x > 0) stack.push(pos - 1);
    if (x < w - 1) stack.push(pos + 1);
    if (y > 0) stack.push(pos - w);
    if (y < h - 1) stack.push(pos + w);
  }

  // Convert visited pixels to run-length spans
  const spans: FillSpan[] = [];
  for (let y = 0; y < h; y++) {
    let spanStart = -1;
    for (let x = 0; x < w; x++) {
      const v = visited[y * w + x];
      if (v && spanStart === -1) {
        spanStart = x;
      } else if (!v && spanStart !== -1) {
        spans.push({ y, x1: spanStart, x2: x - 1 });
        spanStart = -1;
      }
    }
    if (spanStart !== -1) {
      spans.push({ y, x1: spanStart, x2: w - 1 });
      spanStart = -1;
    }
  }

  return spans;
}

// ── Canvas rendering ──────────────────────────────────────────────────────────

// Stamp rendering requires the image cache + redraw callback.
// renderOp handles non-stamp tools; stamp is handled inline in renderAll.
function renderOp(ctx: CanvasRenderingContext2D, op: DrawOp): void {
  switch (op.tool) {
    case 'pen':
      renderPenOp(ctx, op);
      break;
    case 'eraser':
      // Eraser paints white — same as pen but hardcoded color
      renderPenOp(ctx, { ...op, color: '#ffffff' });
      break;
    case 'fill':
      renderFillOp(ctx, op);
      break;
    case 'rect':
      renderRectOp(ctx, op);
      break;
    case 'ellipse':
      renderEllipseOp(ctx, op);
      break;
    // 'stamp' is handled separately in renderAll (needs image cache)
  }
}

function renderPenOp(ctx: CanvasRenderingContext2D, op: DrawOp): void {
  const points = op.points ?? [];
  if (points.length === 0) return;

  ctx.save();
  ctx.strokeStyle = op.color;
  ctx.fillStyle = op.color;
  ctx.lineWidth = op.lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'source-over';

  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0]!.x, points[0]!.y, op.lineWidth / 2, 0, Math.PI * 2);
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

function renderFillOp(ctx: CanvasRenderingContext2D, op: DrawOp): void {
  const spans = op.spans;
  if (!spans || spans.length === 0) return;
  ctx.fillStyle = op.color;
  for (const span of spans) {
    ctx.fillRect(span.x1, span.y, span.x2 - span.x1 + 1, 1);
  }
}

function renderRectOp(ctx: CanvasRenderingContext2D, op: DrawOp): void {
  if (op.x1 === undefined || op.y1 === undefined || op.x2 === undefined || op.y2 === undefined) return;
  const x = Math.min(op.x1, op.x2);
  const y = Math.min(op.y1, op.y2);
  const w = Math.abs(op.x2 - op.x1);
  const h = Math.abs(op.y2 - op.y1);
  if (w === 0 || h === 0) return;
  ctx.save();
  ctx.strokeStyle = op.color;
  ctx.fillStyle = op.color;
  ctx.lineWidth = op.lineWidth;
  ctx.lineJoin = 'miter';
  if (op.filled) {
    ctx.fillRect(x, y, w, h);
  } else {
    ctx.strokeRect(x, y, w, h);
  }
  ctx.restore();
}

function renderEllipseOp(ctx: CanvasRenderingContext2D, op: DrawOp): void {
  if (op.x1 === undefined || op.y1 === undefined || op.x2 === undefined || op.y2 === undefined) return;
  const cx = (op.x1 + op.x2) / 2;
  const cy = (op.y1 + op.y2) / 2;
  const rx = Math.abs(op.x2 - op.x1) / 2;
  const ry = Math.abs(op.y2 - op.y1) / 2;
  if (rx === 0 || ry === 0) return;
  ctx.save();
  ctx.strokeStyle = op.color;
  ctx.fillStyle = op.color;
  ctx.lineWidth = op.lineWidth;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  if (op.filled) ctx.fill();
  else ctx.stroke();
  ctx.restore();
}

/**
 * Render a stamp op (pasted selection).
 * Images are cached in a Map to avoid re-creating Image objects on every render.
 * If the image isn't loaded yet, we set src and schedule a re-render via onNeedsRedraw.
 */
function renderStampOp(
  ctx: CanvasRenderingContext2D,
  op: DrawOp,
  cache: Map<string, HTMLImageElement>,
  onNeedsRedraw: () => void,
): void {
  const { imageDataUrl, stampX, stampY, stampW, stampH } = op;
  if (!imageDataUrl || stampX === undefined || stampY === undefined) return;

  let img = cache.get(imageDataUrl);
  if (!img) {
    img = new Image();
    cache.set(imageDataUrl, img);
    img.onload = onNeedsRedraw;
    img.src = imageDataUrl;
    return; // will re-render when loaded
  }
  if (img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, stampX, stampY, stampW ?? img.naturalWidth, stampH ?? img.naturalHeight);
  }
}

// ── Selection helpers ─────────────────────────────────────────────────────────

/** Returns true if pos falls inside the bounding rect of sel (works for both rect and circle-select). */
function isInsideSel(sel: SelectionState, pos: { x: number; y: number }): boolean {
  const sx = Math.min(sel.x1, sel.x2);
  const sy = Math.min(sel.y1, sel.y2);
  const sw = Math.abs(sel.x2 - sel.x1);
  const sh = Math.abs(sel.y2 - sel.y1);
  return pos.x >= sx && pos.x <= sx + sw && pos.y >= sy && pos.y <= sy + sh;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CommentReply {
  id: string;
  content: string;
  displayName: string;
  color: string;
  createdAt: string;
}

export interface CommentPin {
  id: string;
  content: string;
  displayName: string;
  color: string;
  x: number;
  y: number;
  /** Threaded replies under this pin, chronological order. */
  replies: CommentReply[];
}

/** Selection tools — local-only, produce no DrawOp until copy/paste is triggered. */
type SelectTool = 'rect-select' | 'circle-select';

/** Completed or in-progress selection region on the canvas. */
interface SelectionState {
  tool: SelectTool;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  complete: boolean;
}

/** Clipboard entry produced by Ctrl+C on a selection. */
interface ClipboardEntry {
  dataUrl: string;
  w: number;
  h: number;
  /** Original top-left of the selection on the canvas — used to offset paste. */
  sx: number;
  sy: number;
}

// All interactive tools including non-drawing 'comment' and select tools
type ActiveTool = DrawOpTool | 'comment' | SelectTool;

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
  /** Comment pins to render on the SVG overlay */
  commentPins?: CommentPin[];
  /** Called when the user submits a new canvas-anchored comment */
  onCommentCreate?: (content: string, x: number, y: number) => void;
  /** Called when the user replies to an existing comment pin */
  onCommentReply?: (parentId: string, content: string) => void;
  /**
   * Called once when the Yjs doc + provider are ready.
   * Use this to share the same CRDT doc with sibling hooks (e.g. useChat).
   */
  onYjsReady?: (doc: Y.Doc, provider: WebsocketProvider) => void;
}

export default function DrawCanvas({
  roomSlug,
  wsUrl = 'ws://localhost:1234',
  userName: userNameProp,
  userColor: userColorProp,
  participantId,
  onStatusChange,
  onParticipantsRefresh,
  commentPins = [],
  onCommentCreate,
  onCommentReply,
  onYjsReady,
}: DrawCanvasProps) {
  const userId = getUserId();
  const userName = userNameProp ?? getUserName();
  // Stable color ref — avoids re-creating the Yjs hook on every render
  const userColor = useRef(userColorProp ?? getRandomParticipantColor()).current;

  const {
    strokes, addStroke, clearAll,
    setMyCursor, setMyActiveStroke, remoteCursors, remoteActiveStrokes, status, undo, redo,
    yjsDoc, yjsProvider,
  } = useYjsCanvas({
    roomSlug, wsUrl, userId, userName, userColor, participantId,
    onAwarenessChange: onParticipantsRefresh,
  });

  // Expose Yjs doc + provider to parent so it can share the same connection for chat
  const onYjsReadyRef = useRef(onYjsReady);
  useEffect(() => { onYjsReadyRef.current = onYjsReady; }, [onYjsReady]);
  useEffect(() => {
    if (yjsDoc && yjsProvider) onYjsReadyRef.current?.(yjsDoc, yjsProvider);
  }, [yjsDoc, yjsProvider]);

  // Notify parent of WS status changes (used to pause HTTP heartbeat polling)
  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  // ── Refs ───────────────────────────────────────────────────────────────────

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Drawing state in refs to avoid stale closures in pointer handlers
  const isDrawingRef = useRef(false);
  const activeOpRef = useRef<DrawOp | null>(null);
  const strokesRef = useRef<DrawOp[]>(strokes);
  const remoteActiveStrokesRef = useRef<DrawOp[]>([]);
  const toolRef = useRef<DrawOpTool>('pen');
  const colorRef = useRef<string>(PRESET_COLORS[0]);
  const lineWidthRef = useRef<LineWidthOption>(LINE_WIDTHS[1]);
  const filledRef = useRef<boolean>(false);

  // Selection state (rect-select / circle-select)
  const selectionRef = useRef<SelectionState | null>(null);
  const activeToolRef = useRef<ActiveTool>('pen');
  const marchOffsetRef = useRef<number>(0);
  const selectionAnimFrameRef = useRef<number | null>(null);
  // Selection drag state — tracks pointer anchor + original selection bounds
  const isDraggingSelRef = useRef(false);
  const dragAnchorRef = useRef<{ mx: number; my: number; sx1: number; sy1: number; sx2: number; sy2: number } | null>(null);
  // Clipboard — local to this browser session (not synced via Yjs)
  const clipboardRef = useRef<ClipboardEntry | null>(null);
  // Image cache for stamp ops — avoids re-creating Image objects each render
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  // Long-press detection for mobile copy: 500ms hold inside a completed selection triggers copy
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStartPosRef = useRef<{ x: number; y: number } | null>(null);
  // Stable ref to copySelection — updated after copySelection is defined, avoids forward-reference
  const copySelectionRef = useRef<() => void>(() => {});

  // ── UI state ───────────────────────────────────────────────────────────────

  const [activeTool, setActiveTool] = useState<ActiveTool>('pen');
  // Underlying DrawOpTool — 'comment' and select tools don't map to a draw op
  const isSelectTool = activeTool === 'rect-select' || activeTool === 'circle-select';
  const tool = (activeTool === 'comment' || isSelectTool) ? 'pen' : activeTool;
  const [color, setColor] = useState<string>(PRESET_COLORS[0]);
  const [lineWidth, setLineWidth] = useState<LineWidthOption>(LINE_WIDTHS[1]);
  const [filled, setFilled] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState(false);
  const [sizeExpanded, setSizeExpanded] = useState(false);
  const sizeGroupRef = useRef<HTMLDivElement>(null);
  // Whether a selection exists — drives marching ants animation
  const [hasSelection, setHasSelection] = useState(false);
  // Whether the pointer is currently hovering inside a completed selection — drives 'move' cursor
  const [isMouseOverSel, setIsMouseOverSel] = useState(false);
  const isMouseOverSelRef = useRef(false);
  // Toast message for copy feedback (shown briefly after long-press copy)
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Comment popover state (new comment creation)
  const [commentPopover, setCommentPopover] = useState<{ x: number; y: number } | null>(null);
  const [commentText, setCommentText] = useState('');
  const commentInputRef = useRef<HTMLInputElement>(null);

  // Open pin popup state (reading/replying to existing pins)
  const [openPinId, setOpenPinId] = useState<string | null>(null);
  const [pinReplyText, setPinReplyText] = useState('');

  // Keep refs in sync with state (avoids pointer handler re-creation)
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { lineWidthRef.current = lineWidth; }, [lineWidth]);
  useEffect(() => { filledRef.current = filled; }, [filled]);
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);

  // Collapse size picker when the active tool changes; dismiss comment popover;
  // clear selection when switching away from a select tool.
  useEffect(() => {
    setSizeExpanded(false);
    setCommentPopover(null);
    setCommentText('');
    if (activeTool !== 'rect-select' && activeTool !== 'circle-select') {
      selectionRef.current = null;
      setHasSelection(false);
    }
  }, [activeTool]);

  // Collapse size picker on outside click
  useEffect(() => {
    if (!sizeExpanded) return;
    const handler = (e: MouseEvent) => {
      if (sizeGroupRef.current && !sizeGroupRef.current.contains(e.target as Node)) {
        setSizeExpanded(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [sizeExpanded]);

  // ── Canvas resize + render ─────────────────────────────────────────────────

  const renderAll = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const op of strokesRef.current) {
      if (op.tool === 'stamp') {
        renderStampOp(ctx, op, imageCacheRef.current, () => renderAllRef.current());
      } else {
        renderOp(ctx, op);
      }
    }
    for (const op of remoteActiveStrokesRef.current) {
      renderOp(ctx, op);
    }
    if (activeOpRef.current) {
      renderOp(ctx, activeOpRef.current);
    }

    // Draw selection overlay (marching ants)
    const sel = selectionRef.current;
    if (sel) {
      const sx = Math.min(sel.x1, sel.x2);
      const sy = Math.min(sel.y1, sel.y2);
      const sw = Math.abs(sel.x2 - sel.x1);
      const sh = Math.abs(sel.y2 - sel.y1);
      if (sw > 0 && sh > 0) {
        ctx.save();
        ctx.lineWidth = 1;
        // Subtle fill tint
        ctx.fillStyle = 'rgba(59,130,246,0.07)';
        if (sel.tool === 'rect-select') {
          ctx.fillRect(sx, sy, sw, sh);
        } else {
          ctx.beginPath();
          ctx.ellipse(sx + sw / 2, sy + sh / 2, sw / 2, sh / 2, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        // White backing line (makes ants readable on any canvas color)
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = -marchOffsetRef.current;
        if (sel.tool === 'rect-select') {
          ctx.strokeRect(sx, sy, sw, sh);
        } else {
          ctx.beginPath();
          ctx.ellipse(sx + sw / 2, sy + sh / 2, sw / 2, sh / 2, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        // Blue dashed line offset by half a period
        ctx.strokeStyle = '#3b82f6';
        ctx.lineDashOffset = -(marchOffsetRef.current + 4);
        if (sel.tool === 'rect-select') {
          ctx.strokeRect(sx, sy, sw, sh);
        } else {
          ctx.beginPath();
          ctx.ellipse(sx + sw / 2, sy + sh / 2, sw / 2, sh / 2, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }, []); // reads from refs — no reactive deps needed

  const renderAllRef = useRef(renderAll);
  renderAllRef.current = renderAll;

  // Resize canvas to container dimensions, then re-render.
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

  // Re-render when committed ops change
  useEffect(() => {
    strokesRef.current = strokes;
    renderAll();
  }, [strokes, renderAll]);

  // Re-render when remote active ops change
  useEffect(() => {
    remoteActiveStrokesRef.current = remoteActiveStrokes;
    renderAll();
  }, [remoteActiveStrokes, renderAll]);

  // Marching ants animation — runs while a selection is active
  useEffect(() => {
    if (!hasSelection) {
      if (selectionAnimFrameRef.current !== null) {
        cancelAnimationFrame(selectionAnimFrameRef.current);
        selectionAnimFrameRef.current = null;
      }
      return;
    }
    const animate = () => {
      marchOffsetRef.current = (marchOffsetRef.current + 0.4) % 16;
      renderAllRef.current();
      selectionAnimFrameRef.current = requestAnimationFrame(animate);
    };
    selectionAnimFrameRef.current = requestAnimationFrame(animate);
    return () => {
      if (selectionAnimFrameRef.current !== null) {
        cancelAnimationFrame(selectionAnimFrameRef.current);
        selectionAnimFrameRef.current = null;
      }
    };
  }, [hasSelection]);

  // ── Non-passive touchstart on canvas ──────────────────────────────────────
  // React event handlers are passive by default; we need a native listener
  // with { passive: false } so e.preventDefault() actually suppresses iOS
  // scroll/magnifier/callout on the drawing surface.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: TouchEvent) => e.preventDefault();
    canvas.addEventListener('touchstart', handler, { passive: false });
    return () => canvas.removeEventListener('touchstart', handler);
  }, []);

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
      const pos = getCanvasPos(e);

      // Close any open pin popup when clicking on the canvas
      setOpenPinId(null);
      setPinReplyText('');

      // Comment tool: show popover instead of drawing
      if (activeTool === 'comment') {
        setCommentPopover({ x: pos.x, y: pos.y });
        setCommentText('');
        setTimeout(() => commentInputRef.current?.focus(), 50);
        return;
      }

      // Select tools: drag existing selection if pointer is inside it, else start a new one
      if (activeTool === 'rect-select' || activeTool === 'circle-select') {
        const existingSel = selectionRef.current;
        if (existingSel && existingSel.complete && isInsideSel(existingSel, pos)) {
          // Drag mode — record anchor point and original selection corners
          isDraggingSelRef.current = true;
          dragAnchorRef.current = {
            mx: pos.x, my: pos.y,
            sx1: existingSel.x1, sy1: existingSel.y1,
            sx2: existingSel.x2, sy2: existingSel.y2,
          };
          isDrawingRef.current = true;

          // Long-press to copy on touch: start 500ms timer. Cancelled if the finger moves > 10px.
          if (e.pointerType === 'touch') {
            longPressStartPosRef.current = pos;
            if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = setTimeout(() => {
              longPressTimerRef.current = null;
              longPressStartPosRef.current = null;
              // Cancel the drag that started concurrently (finger didn't actually move)
              isDraggingSelRef.current = false;
              dragAnchorRef.current = null;
              isDrawingRef.current = false;
              copySelectionRef.current();
              if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
              setToastMessage('Copied to clipboard!');
              toastTimerRef.current = setTimeout(() => setToastMessage(null), 2000);
            }, 500);
          }

          return;
        }
        // New selection — implicitly clears previous one
        selectionRef.current = {
          tool: activeTool,
          x1: pos.x, y1: pos.y,
          x2: pos.x, y2: pos.y,
          complete: false,
        };
        setHasSelection(true);
        isDrawingRef.current = true;
        renderAll();
        return;
      }

      const currentTool = toolRef.current;

      if (currentTool === 'fill') {
        // Fill is instantaneous — run flood fill and commit immediately
        const canvas = canvasRef.current;
        if (!canvas) return;
        const spans = computeFloodFill(canvas, pos.x, pos.y, colorRef.current);
        if (spans.length > 0) {
          addStroke({
            id: newOpId(userId),
            tool: 'fill',
            color: colorRef.current,
            lineWidth: 1,
            userId,
            complete: true,
            spans,
          });
        }
        return; // no drag phase for fill
      }

      isDrawingRef.current = true;

      if (currentTool === 'pen' || currentTool === 'eraser') {
        activeOpRef.current = {
          id: newOpId(userId),
          tool: currentTool,
          color: colorRef.current,
          lineWidth: lineWidthRef.current,
          userId,
          complete: false,
          points: [pos],
        };
      } else {
        // rect / ellipse — store start corner
        activeOpRef.current = {
          id: newOpId(userId),
          tool: currentTool,
          color: colorRef.current,
          lineWidth: lineWidthRef.current,
          userId,
          complete: false,
          x1: pos.x, y1: pos.y,
          x2: pos.x, y2: pos.y,
          filled: filledRef.current,
        };
      }
      renderAll();
    },
    [userId, addStroke, renderAll, activeTool],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const pos = getCanvasPos(e);
      setMyCursor(pos);

      if (!isDrawingRef.current) return;

      const curTool = activeToolRef.current;
      if (curTool === 'rect-select' || curTool === 'circle-select') {
        // Cancel long press if touch moved more than 10px from start position
        if (longPressTimerRef.current && longPressStartPosRef.current) {
          const dx = pos.x - longPressStartPosRef.current.x;
          const dy = pos.y - longPressStartPosRef.current.y;
          if (Math.hypot(dx, dy) > 10) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
            longPressStartPosRef.current = null;
          }
        }

        if (isDraggingSelRef.current && selectionRef.current && dragAnchorRef.current) {
          // Drag the whole selection rectangle
          const anchor = dragAnchorRef.current;
          const dx = pos.x - anchor.mx;
          const dy = pos.y - anchor.my;
          selectionRef.current = {
            ...selectionRef.current,
            x1: anchor.sx1 + dx, y1: anchor.sy1 + dy,
            x2: anchor.sx2 + dx, y2: anchor.sy2 + dy,
          };
          // renderAll runs via the marching ants animation frame
        } else if (selectionRef.current && !selectionRef.current.complete) {
          // Resize new selection
          selectionRef.current = { ...selectionRef.current, x2: pos.x, y2: pos.y };
        }
        // Update 'move' cursor only when not actively drawing/dragging
        if (!isDrawingRef.current) {
          const sel = selectionRef.current;
          const over = !!sel && sel.complete && isInsideSel(sel, pos);
          if (over !== isMouseOverSelRef.current) {
            isMouseOverSelRef.current = over;
            setIsMouseOverSel(over);
          }
        }
        return;
      }

      if (!activeOpRef.current) return;

      const currentTool = toolRef.current;

      if (currentTool === 'pen' || currentTool === 'eraser') {
        activeOpRef.current = {
          ...activeOpRef.current,
          points: [...(activeOpRef.current.points ?? []), pos],
        };
        setMyActiveStroke(activeOpRef.current);
        renderAll();
      } else if (currentTool === 'rect' || currentTool === 'ellipse') {
        activeOpRef.current = {
          ...activeOpRef.current,
          x2: pos.x,
          y2: pos.y,
        };
        setMyActiveStroke(activeOpRef.current);
        renderAll();
      }
    },
    [setMyCursor, setMyActiveStroke, renderAll],
  );

  const handlePointerUp = useCallback(() => {
    // Cancel any pending long press (finger lifted before 500ms)
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
      longPressStartPosRef.current = null;
    }

    isDrawingRef.current = false;

    // Finish selection drag or new selection
    const curTool = activeToolRef.current;
    if (curTool === 'rect-select' || curTool === 'circle-select') {
      if (isDraggingSelRef.current) {
        isDraggingSelRef.current = false;
        dragAnchorRef.current = null;
      } else if (selectionRef.current && !selectionRef.current.complete) {
        selectionRef.current = { ...selectionRef.current, complete: true };
        renderAll();
      }
      return;
    }

    if (activeOpRef.current) {
      addStroke({ ...activeOpRef.current, complete: true });
      activeOpRef.current = null;
      setMyActiveStroke(null);
      renderAll();
    }
  }, [addStroke, setMyActiveStroke, renderAll]);

  const handlePointerLeave = useCallback(() => {
    setMyCursor(null);
    setMyActiveStroke(null);
    if (isMouseOverSelRef.current) {
      isMouseOverSelRef.current = false;
      setIsMouseOverSel(false);
    }
  }, [setMyCursor, setMyActiveStroke]);

  // ── Copy / paste helpers ───────────────────────────────────────────────────

  const copySelection = useCallback(() => {
    const sel = selectionRef.current;
    const canvas = canvasRef.current;
    if (!sel || !canvas) return;

    const sx = Math.min(sel.x1, sel.x2);
    const sy = Math.min(sel.y1, sel.y2);
    const sw = Math.abs(sel.x2 - sel.x1);
    const sh = Math.abs(sel.y2 - sel.y1);
    if (sw < 2 || sh < 2) return;

    // Render selection to an offscreen canvas
    const offscreen = document.createElement('canvas');
    offscreen.width = sw;
    offscreen.height = sh;
    const offCtx = offscreen.getContext('2d');
    if (!offCtx) return;

    if (sel.tool === 'circle-select') {
      // Clip to ellipse so only the oval region is copied
      offCtx.save();
      offCtx.beginPath();
      offCtx.ellipse(sw / 2, sh / 2, sw / 2, sh / 2, 0, 0, Math.PI * 2);
      offCtx.clip();
    }

    offCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

    if (sel.tool === 'circle-select') {
      offCtx.restore();
    }

    const dataUrl = offscreen.toDataURL('image/png');
    clipboardRef.current = { dataUrl, w: sw, h: sh, sx, sy };

    // Write PNG blob to the system clipboard so the user can paste outside the browser.
    // Requires a secure context (HTTPS or localhost) and a user-gesture. Fails silently
    // in unsupported environments — the internal clipboardRef copy still works.
    offscreen.toBlob((blob) => {
      if (!blob) return;
      navigator.clipboard
        .write([new ClipboardItem({ 'image/png': blob })])
        .catch((err) => console.warn('[DrawCanvas] system clipboard write failed:', err));
    }, 'image/png');

    // Clear the selection after copy so the user can immediately draw or make a new one
    selectionRef.current = null;
    setHasSelection(false);
    isMouseOverSelRef.current = false;
    setIsMouseOverSel(false);
    renderAll();
  }, [renderAll]);

  // Keep the stable ref in sync so the long-press timer in handlePointerDown can call it
  // without needing copySelection in that callback's dependency array (forward reference)
  useEffect(() => { copySelectionRef.current = copySelection; }, [copySelection]);

  const pasteSelection = useCallback(() => {
    const cb = clipboardRef.current;
    if (!cb) return;

    // Paste slightly offset from the original selection position
    addStroke({
      id: newOpId(userId),
      tool: 'stamp',
      color: '#000000', // unused for stamps
      lineWidth: 1,
      userId,
      complete: true,
      imageDataUrl: cb.dataUrl,
      stampX: cb.sx + 20,
      stampY: cb.sy + 20,
      stampW: cb.w,
      stampH: cb.h,
    });
  }, [addStroke, userId]);

  /**
   * Cut: copies the selection region then erases it with a white filled rect.
   * The erase is stored as a committed DrawOp so it syncs to all peers via Yjs.
   */
  const cutSelection = useCallback(() => {
    const sel = selectionRef.current;
    if (!sel) return;

    // Capture bounds before copySelection clears the ref
    const sx = Math.min(sel.x1, sel.x2);
    const sy = Math.min(sel.y1, sel.y2);
    const sw = Math.abs(sel.x2 - sel.x1);
    const sh = Math.abs(sel.y2 - sel.y1);
    if (sw < 2 || sh < 2) return;

    // Copy to internal + system clipboard (also clears the selection)
    copySelection();

    // Erase the region: a white filled rect committed to the shared Yjs doc
    addStroke({
      id: newOpId(userId),
      tool: 'rect',
      color: '#ffffff',
      lineWidth: 1,
      userId,
      complete: true,
      x1: sx, y1: sy,
      x2: sx + sw, y2: sy + sh,
      filled: true,
    });
  }, [copySelection, addStroke, userId]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't steal keys while the user is typing in any input or textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
      else if (mod && e.key === 'c') { e.preventDefault(); copySelection(); }
      else if (mod && e.key === 'x') { e.preventDefault(); cutSelection(); }
      else if (mod && e.key === 'v') { e.preventDefault(); pasteSelection(); }
      else if (e.key === 'Escape') {
        setCommentPopover(null);
        setCommentText('');
        selectionRef.current = null;
        setHasSelection(false);
        renderAll();
      }
      else if (!mod) {
        if (e.key === 'p') setActiveTool('pen');
        else if (e.key === 'e') setActiveTool('eraser');
        else if (e.key === 'f') setActiveTool('fill');
        else if (e.key === 'r') setActiveTool('rect');
        else if (e.key === 'c') setActiveTool('ellipse');
        else if (e.key === 'm') setActiveTool('comment');
        else if (e.key === 's') setActiveTool('rect-select');
        else if (e.key === 'o') setActiveTool('circle-select');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, copySelection, cutSelection, pasteSelection, renderAll]);

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

      if (participantId) {
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
          // Fall through to local download
        }
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

  // ── Derived styles ─────────────────────────────────────────────────────────

  const eraserSize = lineWidth * 2 + 4;
  const eraserCursor = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${eraserSize}" height="${eraserSize}">` +
    `<rect x="1" y="1" width="${eraserSize - 2}" height="${eraserSize - 2}" ` +
    `rx="2" fill="white" stroke="#555" stroke-width="1.5"/></svg>`,
  );

  // Paint-bucket cursor.
  // Hotspot (3, 12) sits at the left tip of the bucket shape (viewBox 0 0 24 24).
  // White outline stroke painted first so the icon is legible on any canvas color.
  const fillCursor = 'url("data:image/svg+xml,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
    // white halo so the dark icon reads on any canvas background
    `<path d="M19 11l-8-8-8.5 8.5a5.5 5.5 0 0 0 7.78 7.78L19 11z" fill="none" stroke="white" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<path d="M20 13c0 0 2 2 2 4s-2 4-2 4" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/>` +
    // foreground icon in dark ink
    `<path d="M19 11l-8-8-8.5 8.5a5.5 5.5 0 0 0 7.78 7.78L19 11z" fill="none" stroke="#1a1a1a" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<path d="M20 13c0 0 2 2 2 4s-2 4-2 4" fill="none" stroke="#1a1a1a" stroke-width="2" stroke-linecap="round"/>` +
    `</svg>`,
  ) + '") 3 12, crosshair';

  const shapeCursor = 'crosshair';

  const canvasCursor =
    activeTool === 'comment'
      ? 'cell'
      : activeTool === 'eraser'
      ? `url("data:image/svg+xml,${eraserCursor}") ${eraserSize / 2} ${eraserSize / 2}, crosshair`
      : activeTool === 'fill'
      ? fillCursor
      : activeTool === 'rect' || activeTool === 'ellipse'
      ? shapeCursor
      : activeTool === 'rect-select' || activeTool === 'circle-select'
      ? (isMouseOverSel ? 'move' : 'crosshair')
      : 'crosshair';

  const statusColor =
    status === 'online' ? '#22c55e' : status === 'connecting' ? '#f59e0b' : '#ef4444';

  const isShapeTool = activeTool === 'rect' || activeTool === 'ellipse';

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

      {/* Long-press copy toast — shown briefly after a mobile long-press copy */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-full bg-gray-900/80 px-4 py-2 text-sm font-medium text-white shadow-lg"
        >
          {toastMessage}
        </div>
      )}

      {/* Remote cursors — SVG overlay (pointer-events-none, cursors only) */}
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

      {/* Spatial comment pins — DOM overlay so they can receive pointer events */}
      {commentPins.map((pin) => {
        const isOpen = openPinId === pin.id;
        return (
          <div
            key={pin.id}
            style={{
              position: 'absolute',
              left: pin.x - 11,
              top: pin.y - 11,
              zIndex: 18,
              pointerEvents: 'all',
            }}
          >
            {/* Pin button */}
            <button
              type="button"
              aria-label={`Comment by ${pin.displayName}: ${pin.content}`}
              title={`${pin.displayName}: ${pin.content}`}
              onClick={(e) => {
                e.stopPropagation();
                if (isOpen) {
                  setOpenPinId(null);
                  setPinReplyText('');
                } else {
                  setOpenPinId(pin.id);
                  setPinReplyText('');
                  setCommentPopover(null);
                }
              }}
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                backgroundColor: pin.color,
                border: '2px solid white',
                boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                lineHeight: 1,
                padding: 0,
              }}
            >
              💬
            </button>

            {/* Pin popup — threaded view */}
            {isOpen && (
              <div
                role="dialog"
                aria-label={`Comment by ${pin.displayName}`}
                style={{
                  position: 'absolute',
                  top: 28,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 240,
                  backgroundColor: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: 12,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                  padding: '10px 12px',
                  zIndex: 30,
                  pointerEvents: 'all',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Root comment */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    backgroundColor: pin.color, flexShrink: 0,
                  }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>
                    {pin.displayName}
                  </span>
                </div>
                <p style={{
                  fontSize: 13, color: '#1f2937', margin: '0 0 8px',
                  lineHeight: 1.4, wordBreak: 'break-word',
                }}>
                  {pin.content}
                </p>

                {/* Reply thread */}
                {pin.replies.length > 0 && (
                  <div style={{
                    borderTop: '1px solid #f3f4f6',
                    paddingTop: 8,
                    marginBottom: 8,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    maxHeight: 160,
                    overflowY: 'auto',
                  }}>
                    {pin.replies.map((reply) => (
                      <div key={reply.id}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                          <span style={{
                            width: 6, height: 6, borderRadius: '50%',
                            backgroundColor: reply.color, flexShrink: 0,
                          }} />
                          <span style={{ fontSize: 10, fontWeight: 600, color: '#6b7280' }}>
                            {reply.displayName}
                          </span>
                        </div>
                        <p style={{
                          fontSize: 12, color: '#374151', margin: 0,
                          lineHeight: 1.4, wordBreak: 'break-word',
                          paddingLeft: 11, // align under name
                        }}>
                          {reply.content}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Reply input */}
                {onCommentReply && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="text"
                      value={pinReplyText}
                      onChange={(e) => setPinReplyText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && pinReplyText.trim()) {
                          onCommentReply(pin.id, pinReplyText.trim());
                          setPinReplyText('');
                        } else if (e.key === 'Escape') {
                          setOpenPinId(null);
                          setPinReplyText('');
                        }
                      }}
                      placeholder="Reply… (Enter)"
                      maxLength={500}
                      style={{
                        flex: 1, fontSize: 12, padding: '6px 10px',
                        border: '1px solid #d1d5db', borderRadius: 8,
                        outline: 'none', fontFamily: 'inherit',
                      }}
                      aria-label="Reply to comment"
                    />
                    <button
                      type="button"
                      disabled={!pinReplyText.trim()}
                      onClick={() => {
                        if (pinReplyText.trim()) {
                          onCommentReply(pin.id, pinReplyText.trim());
                          setPinReplyText('');
                        }
                      }}
                      style={{
                        padding: '6px 10px', fontSize: 11, fontWeight: 600,
                        backgroundColor: pinReplyText.trim() ? '#3b82f6' : '#e5e7eb',
                        color: pinReplyText.trim() ? 'white' : '#9ca3af',
                        border: 'none', borderRadius: 8, cursor: pinReplyText.trim() ? 'pointer' : 'default',
                      }}
                    >
                      Reply
                    </button>
                  </div>
                )}

                {/* Close button */}
                <button
                  type="button"
                  onClick={() => { setOpenPinId(null); setPinReplyText(''); }}
                  aria-label="Close comment"
                  style={{
                    position: 'absolute', top: 6, right: 8,
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 14, color: '#9ca3af', lineHeight: 1, padding: 2,
                  }}
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        );
      })}

      {/* Comment popover — shown when comment tool is active and user clicked */}
      {commentPopover && (
        <div
          role="dialog"
          aria-label="Add canvas comment"
          className="absolute z-20 bg-white border border-gray-200 rounded-xl shadow-xl p-3 flex gap-2"
          style={{
            left: Math.min(commentPopover.x + 12, window.innerWidth - 260),
            top: Math.min(commentPopover.y - 10, window.innerHeight - 80),
            width: 240,
          }}
        >
          <input
            ref={commentInputRef}
            type="text"
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && commentText.trim()) {
                onCommentCreate?.(commentText.trim(), commentPopover.x, commentPopover.y);
                setCommentPopover(null);
                setCommentText('');
              } else if (e.key === 'Escape') {
                setCommentPopover(null);
                setCommentText('');
              }
            }}
            placeholder="Add a comment… (Enter)"
            maxLength={500}
            className="flex-1 text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
            aria-label="Comment text"
          />
          <button
            type="button"
            onClick={() => {
              if (commentText.trim()) {
                onCommentCreate?.(commentText.trim(), commentPopover.x, commentPopover.y);
              }
              setCommentPopover(null);
              setCommentText('');
            }}
            className="px-3 py-2 text-xs font-medium bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
            aria-label="Submit comment"
          >
            Post
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div
        role="toolbar"
        aria-label="Drawing tools"
        className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2.5 shadow-lg overflow-x-auto max-w-[calc(100vw-1rem)]"
      >
        {/* ── Tool selection ── */}
        <div role="group" aria-label="Tool selection" className="flex items-center gap-0.5">
          <ToolBtn active={activeTool === 'pen'} title="Pen (P)" aria-label="Pen tool (P)" onClick={() => setActiveTool('pen')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
            </svg>
          </ToolBtn>

          <ToolBtn active={activeTool === 'eraser'} title="Eraser (E)" aria-label="Eraser tool (E)" onClick={() => setActiveTool('eraser')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/>
              <path d="M22 21H7"/><path d="m5 11 9 9"/>
            </svg>
          </ToolBtn>

          <ToolBtn active={activeTool === 'fill'} title="Fill (F)" aria-label="Fill tool (F)" onClick={() => setActiveTool('fill')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 11l-8-8-8.5 8.5a5.5 5.5 0 0 0 7.78 7.78L19 11z"/>
              <path d="M20 13c0 0 2 2 2 4s-2 4-2 4"/>
            </svg>
          </ToolBtn>

          <ToolBtn active={activeTool === 'rect'} title="Rectangle (R)" aria-label="Rectangle tool (R)" onClick={() => setActiveTool('rect')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="1"/>
            </svg>
          </ToolBtn>

          <ToolBtn active={activeTool === 'ellipse'} title="Ellipse/Circle (C)" aria-label="Ellipse tool (C)" onClick={() => setActiveTool('ellipse')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <ellipse cx="12" cy="12" rx="10" ry="6"/>
            </svg>
          </ToolBtn>

          <ToolBtn active={activeTool === 'comment'} title="Comment (M)" aria-label="Comment tool — click canvas to annotate (M)" onClick={() => setActiveTool('comment')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </ToolBtn>

          {/* Rectangle select */}
          <ToolBtn active={activeTool === 'rect-select'} title="Rectangular select (S)" aria-label="Rectangular selection tool (S)" onClick={() => setActiveTool('rect-select')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="1" strokeDasharray="4 2"/>
            </svg>
          </ToolBtn>

          {/* Circle / ellipse select */}
          <ToolBtn active={activeTool === 'circle-select'} title="Ellipse select (O)" aria-label="Elliptical selection tool (O)" onClick={() => setActiveTool('circle-select')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <ellipse cx="12" cy="12" rx="10" ry="7" strokeDasharray="4 2"/>
            </svg>
          </ToolBtn>
        </div>

        {/* Copy / Cut / Paste actions — shown when a selection is active */}
        {hasSelection && (
          <>
            <Divider />
            <div role="group" aria-label="Selection actions" className="flex items-center gap-0.5">
              <ToolBtn title="Copy selection (Ctrl+C)" aria-label="Copy selection to clipboard (Ctrl+C)" onClick={copySelection}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="13" height="13" rx="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
              </ToolBtn>
              <ToolBtn title="Cut selection (Ctrl+X)" aria-label="Cut selection — copy and erase (Ctrl+X)" onClick={cutSelection}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="6" cy="20" r="2"/><circle cx="6" cy="4" r="2"/>
                  <line x1="8.12" y1="5.5" x2="20" y2="19"/><line x1="20" y1="5" x2="8.12" y2="18.5"/>
                  <line x1="8.12" y1="5.5" x2="14" y2="12"/><line x1="8.12" y1="18.5" x2="14" y2="12"/>
                </svg>
              </ToolBtn>
              <ToolBtn title="Paste (Ctrl+V)" aria-label="Paste copied selection (Ctrl+V)" onClick={pasteSelection}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                  <rect x="8" y="2" width="8" height="4" rx="1"/>
                </svg>
              </ToolBtn>
            </div>
          </>
        )}

        {/* ── Filled / outlined toggle (shape tools only) ── */}
        {isShapeTool && (
          <>
            <Divider />
            <div role="group" aria-label="Shape fill mode" className="flex items-center gap-0.5">
              <ToolBtn
                active={!filled}
                title="Outlined shape"
                aria-label="Outlined shape"
                onClick={() => setFilled(false)}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                  <rect x="1.5" y="1.5" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.8"/>
                </svg>
              </ToolBtn>
              <ToolBtn
                active={filled}
                title="Filled shape"
                aria-label="Filled shape"
                onClick={() => setFilled(true)}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                  <rect x="1.5" y="1.5" width="11" height="11" fill="currentColor"/>
                </svg>
              </ToolBtn>
            </div>
          </>
        )}

        <Divider />

        {/* ── Color swatches ── */}
        <div className="flex items-center gap-1" role="group" aria-label="Color palette">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              title={c}
              aria-label={`Color ${c}${color === c ? ' (selected)' : ''}`}
              aria-pressed={color === c}
              onClick={() => { setColor(c); if (activeTool === 'fill' || activeTool === 'rect' || activeTool === 'ellipse') { /* keep tool */ } else setActiveTool('pen'); }}
              className="h-5 w-5 rounded-full border-2 transition-transform hover:scale-110 focus:outline-none"
              style={{
                backgroundColor: c,
                borderColor: color === c ? '#3b82f6' : c === '#ffffff' ? '#d1d5db' : c,
                transform: color === c ? 'scale(1.2)' : undefined,
              }}
            />
          ))}
          {/* Custom color */}
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
              onChange={(e) => { setColor(e.target.value); }}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
        </div>

        <Divider />

        {/* ── Line / brush width (not shown for fill, comment, or select tools) ── */}
        {activeTool !== 'fill' && activeTool !== 'comment' && !isSelectTool && (
          <div ref={sizeGroupRef} role="group" aria-label="Brush size" className="flex items-center">
            {/* Collapsed trigger — shows current size dot */}
            <button
              title="Brush size"
              aria-label={`Brush size (current: ${lineWidth}px). Click to ${sizeExpanded ? 'collapse' : 'expand'}`}
              aria-expanded={sizeExpanded}
              onClick={() => setSizeExpanded((o) => !o)}
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                sizeExpanded ? 'bg-blue-100' : 'hover:bg-gray-100'
              }`}
            >
              <span
                className="rounded-full bg-gray-700"
                style={{ width: Math.min(4 + lineWidth, 16), height: Math.min(4 + lineWidth, 16) }}
                aria-hidden="true"
              />
            </button>
            {/* Expanded options */}
            {sizeExpanded && LINE_WIDTHS.map((w) => {
              const dot = Math.min(4 + w, 16);
              return (
                <button
                  key={w}
                  title={`Size ${w}px`}
                  aria-label={`Size ${w}px${lineWidth === w ? ' (selected)' : ''}`}
                  aria-pressed={lineWidth === w}
                  onClick={() => { setLineWidth(w); setSizeExpanded(false); }}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                    lineWidth === w ? 'bg-blue-100' : 'hover:bg-gray-100'
                  }`}
                >
                  <span className="rounded-full bg-gray-700" style={{ width: dot, height: dot }} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        )}

        {activeTool !== 'fill' && activeTool !== 'comment' && !isSelectTool && <Divider />}

        {/* ── Undo / Redo ── */}
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

        {/* ── Export PNG ── */}
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

        {/* ── Clear ── */}
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

        {/* ── Connection status ── */}
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
        'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
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
