import React, { useEffect, useMemo, useRef, useState } from 'react';

const ASCII_SET = [' ', '.', ':', '-', '=', '+', '*', '#', '%', '@'];
const STAGES = [
  { key: 'ingest', label: '素材接入中' },
  { key: 'shape', label: '人格结构成型中' },
  { key: 'converge', label: '人格收敛中' },
] as const;

type Props = {
  name: string;
  subtitle?: string;
};

type Cell = {
  x: number;
  y: number;
  phase: number;
  seed: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function buildCells(columns: number, rows: number): Cell[] {
  const cells: Cell[] = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const seed = Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
      cells.push({ x, y, phase: seed, seed });
    }
  }
  return cells;
}

export function PersonaGenesisAscii({ name, subtitle = '统一素材池正在同步、抽取并组织人格结构' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const label = useMemo(() => (name.trim() || 'N').slice(0, 1).toUpperCase(), [name]);
  const [stageIndex, setStageIndex] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
    };

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    const maskCanvas = document.createElement('canvas');
    maskCanvasRef.current = maskCanvas;
    const maskCtx = maskCanvas.getContext('2d');
    if (!maskCtx) return;

    let raf = 0;
    const startedAt = performance.now();

    const render = (now: number) => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const fontSize = clamp(Math.floor(width / 34), 11, 16);
      const columns = Math.max(24, Math.floor(width / fontSize));
      const rows = Math.max(16, Math.floor(height / (fontSize * 1.08)));
      const cells = buildCells(columns, rows);
      const cellW = width / columns;
      const cellH = height / rows;
      const elapsed = (now - startedAt) / 1000;
      const loop = 7.8;
      const progress = (elapsed % loop) / loop;
      const nextStageIndex = progress < 0.34 ? 0 : progress < 0.7 ? 1 : 2;
      setStageIndex((current) => current === nextStageIndex ? current : nextStageIndex);
      const stageProgress = nextStageIndex === 0
        ? progress / 0.34
        : nextStageIndex === 1
          ? (progress - 0.34) / 0.36
          : (progress - 0.7) / 0.3;

      maskCanvas.width = columns;
      maskCanvas.height = rows;
      maskCtx.clearRect(0, 0, columns, rows);
      maskCtx.fillStyle = '#000';
      maskCtx.fillRect(0, 0, columns, rows);
      maskCtx.fillStyle = '#fff';
      maskCtx.font = `bold ${Math.floor(rows * 0.52)}px sans-serif`;
      maskCtx.textAlign = 'center';
      maskCtx.textBaseline = 'middle';
      maskCtx.fillText(label, columns / 2, rows / 2 + rows * 0.03);
      const maskData = maskCtx.getImageData(0, 0, columns, rows).data;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = 'rgba(250,250,250,0.98)';
      ctx.fillRect(0, 0, width, height);

      ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;

      for (const cell of cells) {
        const idx = (cell.y * columns + cell.x) * 4;
        const inMask = maskData[idx] > 10;
        const centerDist = Math.hypot(cell.x - columns / 2, cell.y - rows / 2);
        const centerFalloff = 1 - clamp(centerDist / (Math.min(columns, rows) * 0.62), 0, 1);
        const shimmer = 0.5 + 0.5 * Math.sin(elapsed * 4.2 + cell.phase * 8 + cell.y * 0.25);
        const wave = 0.5 + 0.5 * Math.sin(elapsed * 2.6 - cell.x * 0.23 + cell.y * 0.17);

        let density = 0;
        if (nextStageIndex === 0) {
          density = clamp(0.12 + shimmer * 0.38 + centerFalloff * 0.18, 0, 0.72);
        } else if (nextStageIndex === 1) {
          const gather = easeOutCubic(stageProgress);
          density = inMask
            ? clamp(0.4 + gather * 0.5 + shimmer * 0.18, 0, 1)
            : clamp(0.08 + (1 - gather) * 0.32 + wave * 0.12, 0, 0.48);
        } else {
          const settle = easeOutCubic(stageProgress);
          density = inMask
            ? clamp(0.72 + settle * 0.28 + shimmer * 0.08, 0, 1)
            : clamp(0.04 + (1 - settle) * 0.18 + wave * 0.06, 0, 0.22);
        }

        if (density < 0.08) continue;
        const charIndex = clamp(Math.floor(density * (ASCII_SET.length - 1)), 0, ASCII_SET.length - 1);
        const char = ASCII_SET[charIndex];

        const hueBase = nextStageIndex === 0 ? 205 : nextStageIndex === 1 ? 227 : 246;
        const hue = hueBase + Math.sin(elapsed * 1.8 + cell.seed * 10) * (nextStageIndex === 2 ? 10 : 18);
        const sat = lerp(34, 74, density);
        const light = inMask
          ? lerp(44, 64, 0.55 + shimmer * 0.45)
          : lerp(58, 78, 0.4 + wave * 0.6);
        const alpha = inMask ? lerp(0.4, 0.95, density) : lerp(0.18, 0.46, density);

        ctx.fillStyle = `hsla(${hue}, ${sat}%, ${light}%, ${alpha})`;
        ctx.fillText(char, cell.x * cellW + cellW / 2, cell.y * cellH + cellH / 2);
      }

      const radial = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.min(width, height) * 0.36);
      radial.addColorStop(0, 'rgba(59,130,246,0.08)');
      radial.addColorStop(1, 'rgba(59,130,246,0)');
      ctx.fillStyle = radial;
      ctx.fillRect(0, 0, width, height);

      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
    };
  }, [label]);

  const activeStage = STAGES[stageIndex];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minHeight: 520 }}>
      <div>
        <div style={{ fontSize: 22, fontWeight: 700, color: 'rgb(var(--text-primary))' }}>人格生成中</div>
        <div style={{ fontSize: 13, color: 'rgb(var(--text-tertiary))', marginTop: 8, lineHeight: 1.6 }}>{subtitle}</div>
      </div>

      <div
        className="card"
        style={{
          flex: 1,
          minHeight: 360,
          padding: 18,
          background: 'linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(248,250,252,0.94) 100%)',
          border: '1px solid rgb(var(--border-light))',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', borderRadius: 12 }} />
        <div style={{ position: 'absolute', left: 20, right: 20, bottom: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'rgb(var(--accent))', textTransform: 'uppercase' }}>{activeStage.label}</div>
            <div style={{ fontSize: 12, color: 'rgb(var(--text-secondary))', marginTop: 6 }}>字符场正在吸附、重排并收敛为稳定人格轮廓</div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {STAGES.map((stage, index) => (
              <div key={stage.key} style={{ width: index === 1 ? 28 : 18, height: 4, borderRadius: 999, background: stage.key === activeStage.key ? 'rgb(var(--accent))' : 'rgb(var(--border))', transition: 'all 160ms ease' }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
