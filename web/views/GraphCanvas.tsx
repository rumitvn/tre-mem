import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { useEffect, useMemo, useRef } from 'react';

import type { GraphNode, GraphResponse } from '../lib.js';

interface SimNode extends SimulationNodeDatum, GraphNode {}
type SimEdge = SimulationLinkDatum<SimNode> & { kind: string };

interface GraphCanvasProps {
  graph: GraphResponse;
  /** Highlight every node authored by / belonging to this contributor. */
  highlight: string | null;
  /** Time-lapse: only show fact nodes at or before this epoch (null = all). */
  cutoffEpoch: number | null;
  onOpenBranch: (branch: string) => void;
  onSelectContributor: (author: string | null) => void;
}

/** Read a CSS custom property so canvas colors track the light/dark theme. */
function token(name: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || '#888';
}

function radius(n: GraphNode): number {
  if (n.kind === 'root') return 16;
  if (n.kind === 'contributor') return 7 + Math.min(14, (n.weight ?? 0) * 1.4);
  if (n.kind === 'branch') return 6 + Math.min(10, (n.weight ?? 0) * 0.8);
  return n.factKind === 'graduated' ? 7 : 4.5; // mature culm vs young shoot
}

export function GraphCanvas({
  graph,
  highlight,
  cutoffEpoch,
  onOpenBranch,
  onSelectContributor,
}: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hoverRef = useRef<SimNode | null>(null);
  const cbRef = useRef({ onOpenBranch, onSelectContributor });
  cbRef.current = { onOpenBranch, onSelectContributor };

  // Visible subset honors the time-lapse cutoff (fact nodes only).
  const { nodes, edges } = useMemo(() => {
    const visible = new Set(
      graph.nodes
        .filter((n) => n.kind !== 'fact' || cutoffEpoch === null || (n.epoch ?? 0) <= cutoffEpoch)
        .map((n) => n.id),
    );
    return {
      nodes: graph.nodes.filter((n) => visible.has(n.id)),
      edges: graph.edges.filter(
        (e) => visible.has(e.source as string) && visible.has(e.target as string),
      ),
    };
  }, [graph, cutoffEpoch]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    };
    resize();

    const simNodes: SimNode[] = nodes.map((n) => ({ ...n }));
    const byId = new Map(simNodes.map((n) => [n.id, n]));
    const simEdges: SimEdge[] = edges
      .filter((e) => byId.has(e.source as string) && byId.has(e.target as string))
      .map((e) => ({ source: e.source as string, target: e.target as string, kind: e.kind }));

    const colors = {
      root: token('--bamboo'),
      branch: token('--branch'),
      contributor: token('--branch'),
      growth: token('--growth'),
      pin: token('--pin'),
      contrib: token('--bamboo-deep'),
      line: token('--line-strong'),
      ink: token('--ink'),
      paper: token('--surface'),
    };
    const nodeColor = (n: SimNode): string => {
      if (n.kind === 'root') return colors.root;
      if (n.kind === 'contributor') return colors.contrib;
      if (n.kind === 'branch') return colors.branch;
      return n.factKind === 'graduated' ? colors.growth : colors.pin;
    };
    const isLit = (n: SimNode): boolean => {
      if (!highlight) return true;
      if (n.kind === 'contributor') return n.author === highlight;
      if (n.kind === 'fact') return n.author === highlight;
      return false;
    };

    const w = (): number => canvas.width / dpr;
    const h = (): number => canvas.height / dpr;

    const sim = forceSimulation<SimNode>(simNodes)
      .force(
        'link',
        forceLink<SimNode, SimEdge>(simEdges)
          .id((d) => d.id)
          .distance((l) => ((l as SimEdge).kind === 'graduates_into' ? 70 : 45))
          .strength(0.3),
      )
      .force('charge', forceManyBody().strength(-130))
      .force('center', forceCenter(w() / 2, h() / 2))
      .force(
        'collide',
        forceCollide<SimNode>().radius((d) => radius(d) + 3),
      );

    const draw = (): void => {
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w(), h());

      ctx.lineWidth = 1;
      for (const e of simEdges) {
        const s = e.source as SimNode;
        const t = e.target as SimNode;
        if (s.x == null || t.x == null) continue;
        const lit = isLit(s) || isLit(t);
        ctx.strokeStyle = colors.line;
        ctx.globalAlpha = highlight && !lit ? 0.08 : 0.4;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y as number);
        ctx.lineTo(t.x, t.y as number);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      for (const n of simNodes) {
        if (n.x == null || n.y == null) continue;
        const r = radius(n);
        const lit = isLit(n);
        ctx.globalAlpha = highlight && !lit ? 0.18 : 1;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = nodeColor(n);
        ctx.fill();
        if (n === hoverRef.current || (highlight && lit && n.kind === 'contributor')) {
          ctx.lineWidth = 2;
          ctx.strokeStyle = colors.ink;
          ctx.stroke();
        }
        if (n.kind === 'root' || n.kind === 'contributor' || n === hoverRef.current) {
          ctx.globalAlpha = highlight && !lit ? 0.18 : 1;
          ctx.fillStyle = colors.ink;
          ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(n.label.slice(0, 28), n.x, n.y - r - 4);
        }
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    };

    sim.on('tick', draw);

    const pick = (ev: PointerEvent): SimNode | null => {
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      let best: SimNode | null = null;
      let bestD = Infinity;
      for (const n of simNodes) {
        if (n.x == null || n.y == null) continue;
        const d = Math.hypot(n.x - x, n.y - y);
        if (d < radius(n) + 4 && d < bestD) {
          best = n;
          bestD = d;
        }
      }
      return best;
    };

    const onMove = (ev: PointerEvent): void => {
      const hit = pick(ev);
      hoverRef.current = hit;
      canvas.style.cursor = hit && hit.kind !== 'fact' ? 'pointer' : hit ? 'help' : 'default';
      canvas.title = hit ? tooltip(hit) : '';
      draw();
    };
    const onClick = (ev: PointerEvent): void => {
      const hit = pick(ev);
      if (!hit) return cbRef.current.onSelectContributor(null);
      if (hit.kind === 'branch' && hit.branch) cbRef.current.onOpenBranch(hit.branch);
      else if (hit.kind === 'contributor' && hit.author)
        cbRef.current.onSelectContributor(hit.author);
      else if (hit.kind === 'fact' && hit.branch) cbRef.current.onOpenBranch(hit.branch);
    };

    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onClick);
    const ro = new ResizeObserver(() => {
      resize();
      sim.force('center', forceCenter(w() / 2, h() / 2));
      sim.alpha(0.3).restart();
    });
    ro.observe(canvas);

    return () => {
      sim.stop();
      ro.disconnect();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onClick);
    };
  }, [nodes, edges, highlight]);

  return <canvas ref={canvasRef} className="grove-canvas" aria-label="Contributor grove graph" />;
}

function tooltip(n: GraphNode): string {
  if (n.kind === 'contributor') return `${n.label} — ${n.weight ?? 0} score`;
  if (n.kind === 'branch') return `branch ${n.label} — ${n.weight ?? 0} facts`;
  if (n.kind === 'fact') {
    const who = n.author ? ` · ${n.author}` : '';
    return `${n.factKind === 'graduated' ? 'rooted fact' : 'pin'}: ${n.label}${who}`;
  }
  return n.label;
}
