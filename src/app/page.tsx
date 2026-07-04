"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────────────────────

type Operation =
  | "derivative" | "integral" | "definite_integral" | "limit" | "series" | "ode"
  | "laplace" | "inverse_laplace" | "simplify" | "factor" | "expand"
  | "cyclic_decimal" | "matrix_det" | "matrix_inv" | "matrix_eigen";

interface Step {
  label: string;
  latex: string;
  note?: string;
}

interface SolveResponse {
  operation: string;
  expression: string;
  result_latex: string;
  steps: Step[];
  error?: string;
}

interface Example {
  op: Operation;
  expr: string;
  order?: number;
  lower?: string;
  upper?: string;
  point?: string;
  variable?: string;
  label: "calc" | "xfm" | "alg" | "num" | "mat";
  desc: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = "/api/python";

const CHALK_COLORS = [
  "var(--chalk-1)", "var(--chalk-2)", "var(--chalk-3)",
  "var(--chalk-4)", "var(--chalk-5)", "var(--chalk-6)",
];

const EXAMPLES: Example[] = [
  { op: "derivative",        expr: "x**3*sin(x) + exp(-x**2)",   order: 1,  label: "calc", desc: "d/dx product rule" },
  { op: "integral",          expr: "x**2 * exp(-x)",              label: "calc", desc: "IBP integral" },
  { op: "definite_integral", expr: "sin(x)",  lower: "0", upper: "pi",  label: "calc", desc: "∫₀π sin x" },
  { op: "limit",             expr: "sin(x)/x",                    point: "0",  label: "calc", desc: "sinc limit" },
  { op: "series",            expr: "exp(x)",  order: 6,  point: "0",   label: "calc", desc: "eˣ Maclaurin" },
  { op: "ode",               expr: "f(x).diff(x,2) + f(x)",       label: "calc", desc: "Simple harmonic ODE" },
  { op: "laplace",           expr: "t**2 * exp(-3*t)",             label: "xfm",  desc: "ℒ{t²e⁻³ᵗ}" },
  { op: "laplace",           expr: "sin(2*t)",                     label: "xfm",  desc: "ℒ{sin 2t}" },
  { op: "inverse_laplace",   expr: "1/(s**2 + 4)",                 label: "xfm",  desc: "ℒ⁻¹{1/(s²+4)}" },
  { op: "simplify",          expr: "sin(x)**2 + cos(x)**2",        label: "alg",  desc: "Pythagorean identity" },
  { op: "factor",            expr: "x**4 - 1",                     label: "alg",  desc: "Diff of squares" },
  { op: "expand",            expr: "(x+y)**5",                     label: "alg",  desc: "Binomial expansion" },
  { op: "cyclic_decimal",    expr: "1/7",                          label: "num",  desc: "Period-6 cycle" },
  { op: "cyclic_decimal",    expr: "1/13",                         label: "num",  desc: "1/13 period 6" },
  { op: "matrix_eigen",      expr: "Matrix([[4,-2],[1,1]])",        label: "mat",  desc: "Eigenvalues 2×2" },
  { op: "matrix_inv",        expr: "Matrix([[2,1],[5,3]])",         label: "mat",  desc: "2×2 inverse" },
];

const OP_OPTIONS: Record<string, Record<string, boolean>> = {
  derivative:        { order: true,  variable: true },
  integral:          { variable: true },
  definite_integral: { variable: true, lower: true, upper: true },
  limit:             { variable: true, point: true, direction: true },
  series:            { variable: true, order: true, point: true },
  ode:               { variable: true },
  laplace:           {},
  inverse_laplace:   {},
  simplify:          { variable: true },
  factor:            { variable: true },
  expand:            { variable: true },
  cyclic_decimal:    {},
  matrix_det:        {},
  matrix_inv:        {},
  matrix_eigen:      {},
};

// ─────────────────────────────────────────────────────────────────────────────
//  KaTeX renderer helper (client-side only)
// ─────────────────────────────────────────────────────────────────────────────

function renderLatex(container: HTMLElement, latexStr: string, display = false) {
  if (typeof window === "undefined") return;
  const win = window as typeof window & { katex?: { render: (l: string, e: HTMLElement, o: object) => void } };
  if (!win.katex) {
    container.textContent = latexStr;
    return;
  }
  try {
    win.katex.render(latexStr, container, {
      displayMode: display,
      throwOnError: false,
      errorColor: "#fc8181",
    });
  } catch {
    container.textContent = latexStr;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function KaTeXSpan({ latex, display = false }: { latex: string; display?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current) renderLatex(ref.current, latex, display);
  }, [latex, display]);
  return <span ref={ref} />;
}

function KaTeXDiv({ latex, display = false }: { latex: string; display?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) renderLatex(ref.current, latex, display);
  }, [latex, display]);
  return <div ref={ref} />;
}

interface StepCardProps {
  step: Step;
  index: number;
}

function StepCard({ step, index }: StepCardProps) {
  const color = CHALK_COLORS[index % CHALK_COLORS.length];
  return (
    <li
      className="wb-step-card"
      style={{ ["--step-color" as string]: color, animationDelay: `${index * 50}ms` }}
    >
      <div className="wb-step-num">{index + 1}</div>
      <div className="wb-step-body">
        <div className="wb-step-label">{step.label}</div>
        <div className="wb-step-math">
          <KaTeXSpan latex={step.latex} display={step.latex.length > 40} />
        </div>
        {step.note && <div className="wb-step-note">{step.note}</div>}
      </div>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main Page Component
// ─────────────────────────────────────────────────────────────────────────────

export default function WhiteboardPage() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [theme, setTheme]               = useState<"dark" | "light">("dark");
  const [apiStatus, setApiStatus]       = useState<"connecting" | "connected" | "error">("connecting");

  const [op, setOp]                     = useState<Operation>("derivative");
  const [expr, setExpr]                 = useState("");
  const [variable, setVariable]         = useState("x");
  const [order, setOrder]               = useState(1);
  const [lower, setLower]               = useState("");
  const [upper, setUpper]               = useState("");
  const [point, setPoint]               = useState("0");
  const [direction, setDirection]       = useState("+");

  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [result, setResult]             = useState<SolveResponse | null>(null);
  const [showModal, setShowModal]       = useState(false);

  const exprRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLSpanElement>(null);

  // ── Theme ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem("wb-theme") as "dark" | "light" | null;
    if (saved) setTheme(saved);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("wb-theme", theme);
  }, [theme]);

  // ── KaTeX script loader ────────────────────────────────────────────────────
  useEffect(() => {
    if (document.getElementById("katex-script")) return;
    const script = document.createElement("script");
    script.id  = "katex-script";
    script.src = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js";
    script.defer = true;
    document.head.appendChild(script);
  }, []);

  // ── Live preview ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!previewRef.current) return;
    if (!expr.trim()) { previewRef.current.textContent = ""; return; }
    const tex = expr
      .replace(/\*\*/g, "^").replace(/\*/g, "\\cdot ")
      .replace(/sqrt\(([^)]+)\)/g, "\\sqrt{$1}")
      .replace(/\bsin\b/g, "\\sin").replace(/\bcos\b/g, "\\cos")
      .replace(/\btan\b/g, "\\tan").replace(/\bexp\(/g, "e^{")
      .replace(/\blog\(/g, "\\ln(").replace(/\bpi\b/g, "\\pi")
      .replace(/\boo\b/g, "\\infty");
    renderLatex(previewRef.current, tex, false);
  }, [expr]);

  // ── API health check ───────────────────────────────────────────────────────
  const checkHealth = useCallback(async () => {
    setApiStatus("connecting");
    try {
      const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(4000) });
      setApiStatus(res.ok ? "connected" : "error");
    } catch {
      setApiStatus("error");
    }
  }, []);

  useEffect(() => {
    checkHealth();
    const id = setInterval(checkHealth, 30_000);
    return () => clearInterval(id);
  }, [checkHealth]);

  // ── Keyboard shortcut ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); handleSolve(); }
      if (e.key === "Escape") setShowModal(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  // ── Solve ──────────────────────────────────────────────────────────────────
  async function handleSolve() {
    const expression = expr.trim();
    if (!expression) { exprRef.current?.focus(); return; }

    setLoading(true);
    setError(null);
    setResult(null);

    const payload: Record<string, unknown> = {
      expression, operation: op,
      variable: variable || "x",
      order: order || 1,
      point: point || "0",
      direction: direction || "+",
    };
    if (lower.trim()) payload.lower = lower.trim();
    if (upper.trim()) payload.upper = upper.trim();

    try {
      const res = await fetch(`${API_BASE}/solve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
      const data = await res.json() as SolveResponse & { detail?: string };
      if (!res.ok) { setError(data.detail ?? `HTTP ${res.status}`); return; }
      setResult(data);
    } catch (err) {
      const e = err as Error;
      if (e.name === "TimeoutError") setError("Request timed out. Try a simpler expression.");
      else setError(`Network error — cannot reach compute server.\nMake sure FastAPI is running:\n  cd backend && python main.py`);
    } finally {
      setLoading(false);
    }
  }

  // ── Quick-insert ───────────────────────────────────────────────────────────
  function quickInsert(text: string) {
    const ta = exprRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? expr.length;
    const end   = ta.selectionEnd   ?? expr.length;
    const next  = expr.slice(0, start) + text + expr.slice(end);
    setExpr(next);
    setTimeout(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + text.length;
    }, 0);
  }

  // ── Load example ──────────────────────────────────────────────────────────
  function loadExample(ex: Example) {
    setOp(ex.op);
    setExpr(ex.expr);
    if (ex.order    !== undefined) setOrder(ex.order);
    if (ex.lower    !== undefined) setLower(ex.lower);
    if (ex.upper    !== undefined) setUpper(ex.upper);
    if (ex.point    !== undefined) setPoint(ex.point);
    if (ex.variable !== undefined) setVariable(ex.variable);
    setError(null);
    setResult(null);
    setTimeout(() => handleSolve(), 150);
  }

  // ── Copy LaTeX ────────────────────────────────────────────────────────────
  const [copyLabel, setCopyLabel] = useState("Copy LaTeX");
  async function copyLatex() {
    if (!result) return;
    try { await navigator.clipboard.writeText(result.result_latex); }
    catch { /* ignore */ }
    setCopyLabel("Copied ✓");
    setTimeout(() => setCopyLabel("Copy LaTeX"), 2000);
  }

  const opts = OP_OPTIONS[op] ?? {};

  // ─────────────────────────────────────────────────────────────────────────
  //  Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* NAVBAR */}
      <nav className="wb-navbar">
        <div className="wb-brand">
          <span className="wb-brand-icon">∂</span>
          <div className="wb-brand-text">
            <span className="wb-brand-name">Whiteboard Engine</span>
            <span className="wb-brand-tag">Advanced Math Visualizer</span>
          </div>
        </div>
        <div className="wb-navbar-right">
          <span className={`wb-api-badge ${apiStatus}`}>
            <span className="wb-status-dot" />
            <span>
              {apiStatus === "connecting" ? "Connecting…" : apiStatus === "connected" ? "API Online" : "API Offline"}
            </span>
          </span>
          <button
            className="wb-btn-icon"
            onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
            aria-label="Toggle theme"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="5"/>
              <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
              <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
            </svg>
          </button>
        </div>
      </nav>

      {/* HERO */}
      <header className="wb-hero">
        <div className="wb-hero-inner">
          <p className="wb-hero-eyebrow">Symbolic Computation Engine</p>
          <h1 className="wb-hero-title">
            Solve. Visualize.<br />
            <span className="wb-gradient-text">Understand the Steps.</span>
          </h1>
          <p className="wb-hero-sub">
            Type any mathematical expression — derivatives, integrals, Laplace transforms,
            ODEs, series expansions, and more. Every computation broken down into
            transparent, teachable steps rendered in beautiful LaTeX.
          </p>
        </div>
        <div className="wb-hero-grid" aria-hidden="true" />
      </header>

      {/* WORKSPACE */}
      <main className="wb-workspace">

        {/* ── INPUT PANEL ── */}
        <section className="wb-panel" style={{ paddingBottom: "1rem" }}>
          <div className="wb-panel-header">
            <span className="wb-panel-icon">⌨</span>
            <h2 className="wb-panel-title">Expression Input</h2>
          </div>

          {/* Operation select */}
          <div className="wb-field-group">
            <label className="wb-field-label" htmlFor="op-select">Operation</label>
            <div className="wb-select-wrapper">
              <select
                id="op-select"
                className="wb-select"
                value={op}
                onChange={e => { setOp(e.target.value as Operation); setResult(null); setError(null); }}
              >
                <optgroup label="Calculus">
                  <option value="derivative">∂  Derivative (d/dx)</option>
                  <option value="integral">∫  Indefinite Integral</option>
                  <option value="definite_integral">∫ₐᵇ Definite Integral</option>
                  <option value="limit">lim Limit Evaluation</option>
                  <option value="series">∑  Taylor / Maclaurin Series</option>
                  <option value="ode">y″  ODE Solver (dsolve)</option>
                </optgroup>
                <optgroup label="Transforms">
                  <option value="laplace">ℒ  Laplace Transform</option>
                  <option value="inverse_laplace">ℒ⁻¹ Inverse Laplace</option>
                </optgroup>
                <optgroup label="Algebra">
                  <option value="simplify">✦  Simplify Expression</option>
                  <option value="factor">◆  Factor Polynomial</option>
                  <option value="expand">◇  Expand Expression</option>
                </optgroup>
                <optgroup label="Number Theory">
                  <option value="cyclic_decimal">⟳  Cyclic / Repeating Decimal</option>
                </optgroup>
                <optgroup label="Linear Algebra">
                  <option value="matrix_det">■  Matrix Determinant</option>
                  <option value="matrix_inv">■⁻¹ Matrix Inverse</option>
                  <option value="matrix_eigen">λ  Eigenvalues &amp; Eigenvectors</option>
                </optgroup>
              </select>
              <span className="wb-select-arrow">▾</span>
            </div>
          </div>

          {/* Expression */}
          <div className="wb-field-group">
            <label className="wb-field-label" htmlFor="expr-input">
              Mathematical Expression
              <span className="wb-field-hint">
                Python / SymPy notation — e.g. <code>x**3 + sin(x)</code>
              </span>
            </label>
            <div className="wb-expr-input-wrapper">
              <textarea
                id="expr-input"
                ref={exprRef}
                className="wb-textarea"
                rows={3}
                value={expr}
                onChange={e => setExpr(e.target.value)}
                placeholder="e.g.  x**3 + sin(x)*exp(-x)"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
              />
              <div className="wb-preview">
                <span className="wb-preview-label">Live preview:</span>
                <span ref={previewRef} />
              </div>
            </div>
          </div>

          {/* Dynamic Options */}
          <div className="wb-options-grid">
            {opts.variable && (
              <div className="wb-field-group">
                <label className="wb-field-label" htmlFor="var-input">Variable</label>
                <input id="var-input" className="wb-input" type="text" value={variable} maxLength={4}
                  onChange={e => setVariable(e.target.value)} />
              </div>
            )}
            {opts.order && (
              <div className="wb-field-group">
                <label className="wb-field-label" htmlFor="order-input">
                  {op === "series" ? "Num. Terms" : "Order"}
                </label>
                <input id="order-input" className="wb-input" type="number" value={order}
                  min={1} max={10} onChange={e => setOrder(Number(e.target.value))} />
              </div>
            )}
            {opts.lower && (
              <div className="wb-field-group">
                <label className="wb-field-label" htmlFor="lower-input">Lower Bound <i>a</i></label>
                <input id="lower-input" className="wb-input" type="text" value={lower}
                  placeholder="0" onChange={e => setLower(e.target.value)} />
              </div>
            )}
            {opts.upper && (
              <div className="wb-field-group">
                <label className="wb-field-label" htmlFor="upper-input">Upper Bound <i>b</i></label>
                <input id="upper-input" className="wb-input" type="text" value={upper}
                  placeholder="1" onChange={e => setUpper(e.target.value)} />
              </div>
            )}
            {opts.point && (
              <div className="wb-field-group">
                <label className="wb-field-label" htmlFor="point-input">Expand Around</label>
                <input id="point-input" className="wb-input" type="text" value={point}
                  onChange={e => setPoint(e.target.value)} />
              </div>
            )}
            {opts.direction && (
              <div className="wb-field-group">
                <label className="wb-field-label" htmlFor="dir-select">Direction</label>
                <div className="wb-select-wrapper">
                  <select id="dir-select" className="wb-select small" value={direction}
                    onChange={e => setDirection(e.target.value)}>
                    <option value="+">x → a⁺ (right)</option>
                    <option value="-">x → a⁻ (left)</option>
                    <option value="+-">x → a (two-sided)</option>
                  </select>
                  <span className="wb-select-arrow">▾</span>
                </div>
              </div>
            )}
          </div>

          {/* Quick-insert */}
          <div className="wb-quickbar">
            <span className="wb-quickbar-label">Quick insert:</span>
            <div className="wb-quickbar-btns">
              {[
                ["**2","x²"], ["**3","x³"], ["sqrt(","√"], ["sin(","sin"],
                ["cos(","cos"], ["tan(","tan"], ["exp(","eˣ"], ["log(","ln"],
                ["pi","π"], ["oo","∞"], ["Rational(","p/q"], ["Matrix([[","[ ]"],
              ].map(([ins, label]) => (
                <button key={ins} className="wb-qbtn" title={ins} onClick={() => quickInsert(ins)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Solve button */}
          <button className="wb-btn-solve" onClick={handleSolve} disabled={loading}>
            <span className="wb-btn-icon-left">{loading ? "⟳" : "▶"}</span>
            <span className="wb-btn-label">{loading ? "Computing…" : "Solve"}</span>
            <span className="wb-btn-shortcut">⌘ Enter</span>
          </button>

          {/* Examples */}
          <div className="wb-examples-section">
            <p className="wb-examples-title">Examples — click to load</p>
            <div className="wb-examples-grid">
              {EXAMPLES.map((ex, i) => (
                <button key={i} className="wb-example-card" onClick={() => loadExample(ex)}>
                  <span className={`wb-chip chip-${ex.label}`}>{ex.label.toUpperCase()}</span>
                  <span className="wb-example-expr">{ex.expr}</span>
                  <span className="wb-example-desc">{ex.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ── OUTPUT PANEL ── */}
        <section className="wb-panel wb-panel-output">
          <div className="wb-panel-header">
            <span className="wb-panel-icon">🖊</span>
            <h2 className="wb-panel-title">Whiteboard</h2>
            <div className="wb-panel-header-right">
              <button className="wb-btn-sm" onClick={copyLatex} disabled={!result}>
                {copyLabel}
              </button>
              <button className="wb-btn-sm" onClick={() => { setResult(null); setError(null); setExpr(""); }}>
                Clear
              </button>
            </div>
          </div>

          {/* Idle */}
          {!loading && !error && !result && (
            <div className="wb-idle">
              <div className="wb-idle-icon">∫</div>
              <p className="wb-idle-title">Enter an expression to get started</p>
              <p className="wb-idle-sub">
                Choose an operation, type your expression, and hit <strong>Solve</strong>
              </p>
            </div>
          )}

          {/* Loader */}
          {loading && (
            <div className="wb-loader">
              <div className="wb-loader-ring" />
              <p className="wb-loader-text">Computing symbolic solution…</p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="wb-error">
              <span className="wb-error-icon">⚠</span>
              <span className="wb-error-msg">{error}</span>
            </div>
          )}

          {/* Result */}
          {result && (
            <>
              <div className="wb-result-header">
                <div className="wb-result-meta">
                  {result.operation.replace(/_/g, " ").toUpperCase()}  ·  {result.expression}
                </div>
                <div className="wb-result-final">
                  <KaTeXDiv latex={result.result_latex} display />
                </div>
              </div>

              {result.steps.length > 0 && (
                <div className="wb-steps">
                  <div className="wb-steps-title-row">
                    <span className="wb-steps-title">Step-by-Step Solution</span>
                    <span className="wb-steps-count">
                      {result.steps.length} step{result.steps.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <ol className="wb-steps-list">
                    {result.steps.map((step, i) => (
                      <StepCard key={i} step={step} index={i} />
                    ))}
                  </ol>
                </div>
              )}
            </>
          )}
        </section>
      </main>

      {/* MODAL */}
      {showModal && (
        <div className="wb-modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div className="wb-modal">
            <div className="wb-modal-header">
              <h3>Project File Structure</h3>
              <button className="wb-modal-close" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div className="wb-modal-body">
              <pre className="wb-file-tree"><code>{`whiteboard-engine/
│
├── backend/                    ← Python FastAPI + SymPy server
│   ├── main.py                 ← Core server (127.0.0.1:8000)
│   └── requirements.txt        ← Python dependencies
│
├── public/
│   └── whiteboard/             ← Standalone vanilla frontend
│       ├── index.html          ← App shell + KaTeX CDN
│       ├── style.css           ← Dark-mode whiteboard theme
│       └── script.js           ← Fetch logic + KaTeX renderer
│
└── src/
    └── app/
        ├── page.tsx            ← Next.js React frontend
        ├── globals.css         ← Global styles
        └── api/
            └── python/
                └── [...path]/
                    └── route.ts ← Proxy → FastAPI`}</code></pre>
              <div className="wb-struct-desc">
                <h4>Start Instructions</h4>
                <ol>
                  <li>Install Python deps: <code>cd backend &amp;&amp; pip install -r requirements.txt</code></li>
                  <li>Start backend: <code>python main.py</code> → <em>http://127.0.0.1:8000</em></li>
                  <li>Start Next.js: <code>npm run dev</code> → <em>http://localhost:3000</em></li>
                  <li>Or open <code>public/whiteboard/index.html</code> directly in a browser</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FOOTER */}
      <footer className="wb-footer">
        <span>Whiteboard Engine © 2025 — FastAPI · SymPy · KaTeX · Next.js</span>
        <button className="wb-footer-link" onClick={() => setShowModal(true)}>
          View File Structure
        </button>
      </footer>
    </>
  );
}
