import { useRef, useEffect } from 'react';
import { useNR1Store } from '../store/useNR1Store';

const LAYERS = [
  { count: 5, label: 'IN',  nodeLabels: ['ASSET','EVENT','SESSION','DOW','VOL'] as string[] | null },
  { count: 8, label: 'D64', nodeLabels: null as string[] | null },
  { count: 6, label: 'D32', nodeLabels: null as string[] | null },
  { count: 7, label: 'OUT', nodeLabels: ['-3%','-2%','-1%','FLAT','+1%','+2%','+3%'] as string[] | null },
];

const BIN_LABELS = ['-3%+', '-2%', '-1%', 'Flat', '+1%', '+2%', '+3%+'];

// Canvas geometry (CSS px). Nodes sit above a reserved band for the layer labels,
// and the side padding fits the longest input ("SESSION") and output ("FLAT") labels.
const CANVAS_HEIGHT = 168;
const PAD_TOP       = 12;
const LABEL_BAND    = 30;
const PAD_LEFT      = 58;
const PAD_RIGHT     = 40;
const MONO          = 'JetBrains Mono, monospace';

type Pulse   = { fl: number; fi: number; tl: number; ti: number; progress: number };
type NodePos = { x: number; y: number };

function getBezierPoint(fn: NodePos, tn: NodePos, t: number): NodePos {
  const cp1x = fn.x + (tn.x - fn.x) * 0.4;
  const cp2x = fn.x + (tn.x - fn.x) * 0.6;
  const x =
    Math.pow(1 - t, 3) * fn.x +
    3 * Math.pow(1 - t, 2) * t * cp1x +
    3 * (1 - t) * t * t * cp2x +
    t * t * t * tn.x;
  const y =
    Math.pow(1 - t, 3) * fn.y +
    3 * Math.pow(1 - t, 2) * t * fn.y +
    3 * (1 - t) * t * t * tn.y +
    t * t * t * tn.y;
  return { x, y };
}

export function NeuralNetVisualizer() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef  = useRef<HTMLCanvasElement>(null);

  const isRunning         = useNR1Store((s) => s.isRunning);
  const nnOutput          = useNR1Store((s) => s.nnOutput);
  const nnWeightSource    = useNR1Store((s) => s.nnWeightSource);
  const nnTrainedExamples = useNR1Store((s) => s.nnTrainedExamples);

  // Mutable state kept in a ref so the rAF loop always sees current values
  const S = useRef<{
    activations:   number[][];
    pulses:        Pulse[];
    nodePositions: NodePos[][];
    width:         number;
    height:        number;
    idleFrame:     number;
    running:       boolean;
  }>({
    activations:   LAYERS.map((l) => new Array(l.count).fill(0)),
    pulses:        [],
    nodePositions: [],
    width:         0,
    height:        CANVAS_HEIGHT,
    idleFrame:     0,
    running:       false,
  });

  // ── canvas animation engine ──────────────────────────────────────────────
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas  = canvasRef.current;
    if (!wrapper || !canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const drawContext: CanvasRenderingContext2D = context;

    let animId = 0;

    function computeLayout(w: number) {
      const uw = Math.max(w - PAD_LEFT - PAD_RIGHT, 40);
      const uh = CANVAS_HEIGHT - PAD_TOP - LABEL_BAND;
      S.current.nodePositions = LAYERS.map((layer, li) => {
        const x = PAD_LEFT + (li / (LAYERS.length - 1)) * uw;
        return Array.from({ length: layer.count }, (_, ni) => ({
          x,
          y: PAD_TOP + (ni / Math.max(layer.count - 1, 1)) * uh,
        }));
      });
      S.current.activations = LAYERS.map((l) => new Array(l.count).fill(0));
    }

    function draw(ctx: CanvasRenderingContext2D) {
      const { activations, pulses, nodePositions, width, height } = S.current;
      if (!nodePositions.length || width < 10) return;
      ctx.clearRect(0, 0, width, height);

      // connections
      for (let li = 0; li < LAYERS.length - 1; li++) {
        const from = nodePositions[li];
        const to   = nodePositions[li + 1];
        if (!from || !to) continue;
        from.forEach((fn, fi) => {
          to.forEach((tn, ti) => {
            const strength = activations[li][fi] * activations[li + 1][ti];
            ctx.strokeStyle = `rgba(245,158,11,${0.06 + strength * 0.3})`;
            ctx.lineWidth = 0.5 + strength * 1.6;
            ctx.beginPath();
            const cp1x = fn.x + (tn.x - fn.x) * 0.4;
            const cp2x = fn.x + (tn.x - fn.x) * 0.6;
            ctx.moveTo(fn.x, fn.y);
            ctx.bezierCurveTo(cp1x, fn.y, cp2x, tn.y, tn.x, tn.y);
            ctx.stroke();
          });
        });
      }

      // pulses
      pulses.forEach((p) => {
        const fn = nodePositions[p.fl]?.[p.fi];
        const tn = nodePositions[p.tl]?.[p.ti];
        if (!fn || !tn) return;
        const pt = getBezierPoint(fn, tn, p.progress);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(245,158,11,0.9)';
        ctx.fill();
      });

      // nodes + labels
      LAYERS.forEach((layer, li) => {
        const r = li === 0 || li === LAYERS.length - 1 ? 5.5 : 4;
        nodePositions[li]?.forEach((pos, ni) => {
          const act = activations[li][ni];

          ctx.beginPath();
          ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
          ctx.fillStyle = act > 0.05
            ? `rgba(245,158,11,${0.08 + act * 0.55})`
            : '#111114';
          ctx.fill();
          ctx.strokeStyle = act > 0.05
            ? `rgba(245,158,11,${0.4 + act * 0.6})`
            : '#2e2e38';
          ctx.lineWidth = 1;
          ctx.stroke();

          // input labels
          if (li === 0 && layer.nodeLabels) {
            ctx.textAlign = 'right';
            ctx.fillStyle = act > 0.1 ? '#f59e0b' : '#555';
            ctx.font = `9px ${MONO}`;
            ctx.fillText(layer.nodeLabels[ni] ?? '', pos.x - 10, pos.y + 3);
          }

          // output labels
          if (li === LAYERS.length - 1 && layer.nodeLabels) {
            const activeColor = ni < 3 ? '#ef4444' : ni === 3 ? '#3b82f6' : '#22c55e';
            ctx.textAlign = 'left';
            ctx.fillStyle = act > 0.05 ? activeColor : '#555';
            ctx.font = `9px ${MONO}`;
            ctx.fillText(layer.nodeLabels[ni] ?? '', pos.x + 10, pos.y + 3);
          }
        });

        // layer label at bottom
        const firstNode = nodePositions[li]?.[0];
        if (firstNode) {
          ctx.textAlign = 'center';
          ctx.fillStyle = '#555';
          ctx.font = `9px ${MONO}`;
          ctx.fillText(layer.label, firstNode.x, height - 9);
        }
      });
    }

    function tick() {
      const st = S.current;

      // advance + resolve pulses
      st.pulses = st.pulses.filter((p) => {
        p.progress += 0.04;
        if (p.progress >= 1) {
          const node = st.nodePositions[p.tl]?.[p.ti];
          if (node !== undefined) {
            st.activations[p.tl][p.ti] = Math.min(1, st.activations[p.tl][p.ti] + 0.5);
          }
          return false;
        }
        return true;
      });

      // decay all activations
      st.activations.forEach((layer, li) => {
        layer.forEach((_, ni) => {
          st.activations[li][ni] *= 0.975;
        });
      });

      // idle flicker (skip when analysis is running)
      st.idleFrame++;
      if (st.idleFrame % 90 === 0 && !st.running) {
        const li = Math.floor(Math.random() * LAYERS.length);
        const ni = Math.floor(Math.random() * LAYERS[li].count);
        st.activations[li][ni] = 0.08 + Math.random() * 0.06;
      }

      draw(drawContext);
      animId = requestAnimationFrame(tick);
    }

    const ro = new ResizeObserver((entries) => {
      S.current.width = entries[0].contentRect.width;
      if (S.current.width < 10) return;
      // Back the canvas with device pixels so text and circles stay sharp on Retina.
      const dpr = window.devicePixelRatio || 1;
      canvas.width  = Math.round(S.current.width * dpr);
      canvas.height = Math.round(S.current.height * dpr);
      drawContext.setTransform(dpr, 0, 0, dpr, 0, 0);
      computeLayout(S.current.width);
      cancelAnimationFrame(animId);
      tick();
    });

    ro.observe(wrapper);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(animId);
    };
  }, []); // intentionally empty — engine runs once

  // ── react to isRunning ───────────────────────────────────────────────────
  const prevRunning = useRef(false);
  useEffect(() => {
    const st = S.current;
    st.running = isRunning;

    if (isRunning && !prevRunning.current) {
      // light up all input nodes immediately
      st.activations[0] = st.activations[0].map(() => 0.7 + Math.random() * 0.3);

      // schedule pulses layer by layer with jitter
      LAYERS.forEach((_, li) => {
        if (li >= LAYERS.length - 1) return;
        st.nodePositions[li]?.forEach((_, fi) => {
          st.nodePositions[li + 1]?.forEach((_, ti) => {
            if (Math.random() > 0.4) {
              const delay = li * 380 + (fi + ti) * 22 + Math.random() * 140;
              setTimeout(() => {
                st.pulses.push({ fl: li, fi, tl: li + 1, ti, progress: 0 });
              }, delay);
            }
          });
        });
      });
    }

    prevRunning.current = isRunning;
  }, [isRunning]);

  // ── sync nnOutput → output node activations ──────────────────────────────
  useEffect(() => {
    if (!nnOutput) return;
    nnOutput.forEach((v, i) => {
      S.current.activations[3][i] = v;
    });
  }, [nnOutput]);

  // ── derived display ──────────────────────────────────────────────────────
  const peakBin = nnOutput ? nnOutput.indexOf(Math.max(...nnOutput)) : -1;

  return (
    <div style={{ padding: '12px 0 0' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
        <span style={{
          color: '#f59e0b',
          fontSize: '10px',
          letterSpacing: '0.12em',
          fontFamily: MONO,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          NEURAL NET · TFJS
        </span>
        <span style={{
          fontSize: '9px',
          letterSpacing: '0.08em',
          fontFamily: MONO,
          flexShrink: 0,
          color: nnWeightSource === 'trained' ? '#22c55e' : '#555',
        }}>
          {nnWeightSource === 'trained' ? 'TRAINED' : 'SYNTHETIC'}
        </span>
      </div>

      {/* canvas wrapper — ResizeObserver reads this div's width */}
      <div ref={wrapperRef} style={{ width: '100%' }}>
        <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: CANVAS_HEIGHT }} />
      </div>

      {/* output probability bins */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
        gap: '2px',
        marginTop: '6px',
      }}>
        {BIN_LABELS.map((label, i) => (
          <div key={i} style={{
            background: '#111114',
            border: `1px solid ${nnOutput && i === peakBin ? '#f59e0b' : '#1e1e24'}`,
            padding: '4px 0',
            textAlign: 'center',
            minWidth: 0,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
          }}>
            <span style={{
              display: 'block',
              fontSize: '8px',
              color: '#555',
              marginBottom: '2px',
              fontFamily: MONO,
            }}>
              {label}
            </span>
            <span style={{
              display: 'block',
              fontSize: '10px',
              fontFamily: MONO,
              color: nnOutput && i === peakBin
                ? '#f59e0b'
                : i < 3 ? '#ef4444'
                : i === 3 ? '#3b82f6'
                : '#22c55e',
              opacity: nnOutput ? 1 : 0.35,
            }}>
              {nnOutput ? `${Math.round(nnOutput[i] * 100)}%` : '–'}
            </span>
          </div>
        ))}
      </div>

      {/* weight source footnote */}
      <div style={{
        marginTop: '6px',
        fontSize: '9px',
        letterSpacing: '0.04em',
        fontFamily: MONO,
        color: nnWeightSource === 'trained' ? 'rgba(34,197,94,0.7)' : '#555',
      }}>
        {nnWeightSource === 'synthetic'
          ? 'UNTRAINED · RANDOM WEIGHTS'
          : `TRAINED ON ${nnTrainedExamples} EXAMPLES`}
      </div>
    </div>
  );
}
