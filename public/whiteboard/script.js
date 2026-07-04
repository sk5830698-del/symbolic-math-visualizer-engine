/**
 * ═══════════════════════════════════════════════════════════════════════
 *   WHITEBOARD ENGINE — Frontend Script
 *   Fetch API ↔ FastAPI (127.0.0.1:8000) | KaTeX rendering
 * ═══════════════════════════════════════════════════════════════════════
 */

"use strict";

/* ─────────────────────────────  CONFIG  ──────────────────────────────── */

/**
 * API_BASE is determined at runtime:
 *   • When opened via Next.js (same origin)  → /api/python
 *   • When opened directly as a file / local  → http://127.0.0.1:8000
 */
const IS_NEXT_ORIGIN = window.location.port === "3000" || window.location.pathname.startsWith("/whiteboard");
const API_BASE = IS_NEXT_ORIGIN
  ? "/api/python"          // Next.js reverse-proxy route
  : "http://127.0.0.1:8000";  // Direct local FastAPI server

/* Chalk colours cycle through step cards */
const CHALK_COLORS = [
  "var(--chalk-1)", "var(--chalk-2)", "var(--chalk-3)",
  "var(--chalk-4)", "var(--chalk-5)", "var(--chalk-6)",
];

/* ─────────────────────────────  EXAMPLES  ────────────────────────────── */

const EXAMPLES = [
  // Calculus
  { op: "derivative",        expr: "x**3*sin(x) + exp(-x**2)",   order:1,  label:"calc",  desc:"d/dx product" },
  { op: "derivative",        expr: "sin(x)**2 * cos(x)",          order:3,  label:"calc",  desc:"3rd derivative" },
  { op: "integral",          expr: "x**2 * exp(-x)",              label:"calc",  desc:"IBP integral" },
  { op: "definite_integral", expr: "sin(x)",   lower:"0", upper:"pi",    label:"calc", desc:"∫₀π sin x" },
  { op: "definite_integral", expr: "x**2",     lower:"0", upper:"3",     label:"calc", desc:"∫₀³ x²" },
  { op: "limit",             expr: "sin(x)/x",                    point:"0",         label:"calc",  desc:"sinc limit" },
  { op: "limit",             expr: "(1 + 1/x)**x",                point:"oo",        label:"calc",  desc:"e definition" },
  { op: "series",            expr: "exp(x)",                      order:6, point:"0", label:"calc",  desc:"eˣ Maclaurin" },
  { op: "series",            expr: "sin(x)",                      order:7, point:"0", label:"calc",  desc:"sin Maclaurin" },
  { op: "ode",               expr: "f(x).diff(x,2) + f(x)",      label:"calc",  desc:"Simple harmonic" },
  // Transforms
  { op: "laplace",           expr: "t**2 * exp(-3*t)",            label:"xfm",   desc:"ℒ{t²e⁻³ᵗ}" },
  { op: "laplace",           expr: "sin(2*t)",                    label:"xfm",   desc:"ℒ{sin 2t}" },
  { op: "laplace",           expr: "t*cos(t)",                    label:"xfm",   desc:"ℒ{t·cos t}" },
  { op: "inverse_laplace",   expr: "1/(s**2 + 4)",               label:"xfm",   desc:"ℒ⁻¹{1/(s²+4)}" },
  { op: "inverse_laplace",   expr: "s/((s+1)*(s+3))",            label:"xfm",   desc:"Partial fractions" },
  // Algebra
  { op: "simplify",          expr: "sin(x)**2 + cos(x)**2",       label:"alg",   desc:"Pythagorean identity" },
  { op: "factor",            expr: "x**4 - 1",                    label:"alg",   desc:"Diff of squares" },
  { op: "expand",            expr: "(x+y)**5",                    label:"alg",   desc:"Binomial expansion" },
  // Number theory
  { op: "cyclic_decimal",    expr: "1/7",                         label:"num",   desc:"1/7 cyclic period 6" },
  { op: "cyclic_decimal",    expr: "22/7",                        label:"num",   desc:"π approximation" },
  { op: "cyclic_decimal",    expr: "1/13",                        label:"num",   desc:"1/13 period 6" },
  // Matrices
  { op: "matrix_det",        expr: "Matrix([[1,2,3],[4,5,6],[7,8,9]])", label:"mat", desc:"3×3 det" },
  { op: "matrix_inv",        expr: "Matrix([[2,1],[5,3]])",        label:"mat",   desc:"2×2 inverse" },
  { op: "matrix_eigen",      expr: "Matrix([[4,-2],[1,1]])",       label:"mat",   desc:"Eigenvalues" },
];

/* ─────────────────────  OPTION VISIBILITY MAP  ──────────────────────── */

const OP_OPTIONS = {
  derivative:        { order:true,  variable:true },
  integral:          { variable:true },
  definite_integral: { variable:true, lower:true, upper:true },
  limit:             { variable:true, point:true, direction:true },
  series:            { variable:true, order:true, point:true },
  ode:               { variable:true },
  laplace:           {},
  inverse_laplace:   {},
  simplify:          { variable:true },
  factor:            { variable:true },
  expand:            { variable:true },
  cyclic_decimal:    {},
  matrix_det:        {},
  matrix_inv:        {},
  matrix_eigen:      {},
};

/* ─────────────────────────────  DOM REFS  ────────────────────────────── */

const $ = (id) => document.getElementById(id);

const opSelect    = $("op-select");
const exprInput   = $("expr-input");
const varInput    = $("var-input");
const orderInput  = $("order-input");
const lowerInput  = $("lower-input");
const upperInput  = $("upper-input");
const pointInput  = $("point-input");
const dirSelect   = $("dir-select");
const solveBtn    = $("solve-btn");
const clearBtn    = $("clear-btn");
const copyBtn     = $("copy-btn");
const themeToggle = $("theme-toggle");
const apiStatus   = $("api-status");
const statusText  = apiStatus.querySelector(".status-text");
const previewKatex= $("preview-katex");
const idleState   = $("idle-state");
const loaderEl    = $("loader");
const errorBanner = $("error-banner");
const errorMsg    = $("error-msg");
const resultHeader= $("result-header");
const resultMeta  = $("result-meta");
const resultFinal = $("result-final");
const stepsCont   = $("steps-container");
const stepsCount  = $("steps-count");
const stepsList   = $("steps-list");
const examplesGrid= $("examples-grid");
const structBtn   = $("struct-btn");
const structModal = $("struct-modal");
const modalClose  = $("modal-close");

let lastResultLatex = "";

/* ══════════════════════════════════════════════════════════════════════
   KATEX UTILITIES
══════════════════════════════════════════════════════════════════════ */

function renderKaTeX(container, latex, displayMode = false) {
  if (typeof katex === "undefined") {
    container.textContent = latex;
    return;
  }
  try {
    katex.render(latex, container, {
      displayMode,
      throwOnError: false,
      errorColor: "#fc8181",
      macros: {
        "\\R": "\\mathbb{R}",
        "\\C": "\\mathbb{C}",
        "\\N": "\\mathbb{N}",
        "\\Z": "\\mathbb{Z}",
      },
    });
  } catch (e) {
    container.textContent = latex;
  }
}

/* Live preview — raw input → KaTeX (best-effort) */
function updatePreview() {
  const raw = exprInput.value.trim();
  if (!raw) { previewKatex.textContent = ""; return; }

  // Simple heuristic conversions for preview only
  let tex = raw
    .replace(/\*\*/g, "^")
    .replace(/\*/g, "\\cdot ")
    .replace(/sqrt\(([^)]+)\)/g, "\\sqrt{$1}")
    .replace(/\bsin\b/g, "\\sin")
    .replace(/\bcos\b/g, "\\cos")
    .replace(/\btan\b/g, "\\tan")
    .replace(/\bexp\(/g, "e^{")
    .replace(/\blog\(/g, "\\ln(")
    .replace(/\bpi\b/g, "\\pi")
    .replace(/\boo\b/g, "\\infty");

  renderKaTeX(previewKatex, tex, false);
}

/* ══════════════════════════════════════════════════════════════════════
   API HEALTH CHECK
══════════════════════════════════════════════════════════════════════ */

async function checkApiHealth() {
  apiStatus.className = "api-badge";
  statusText.textContent = "Connecting…";
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      apiStatus.classList.add("connected");
      statusText.textContent = "API Online";
    } else {
      throw new Error("non-ok");
    }
  } catch {
    apiStatus.classList.add("error");
    statusText.textContent = "API Offline";
    showError(
      `Cannot reach the compute server at ${API_BASE}.\n` +
      "Run: cd backend && python main.py"
    );
  }
}

/* ══════════════════════════════════════════════════════════════════════
   OPTION PANEL VISIBILITY
══════════════════════════════════════════════════════════════════════ */

function updateOptionVisibility() {
  const op    = opSelect.value;
  const opts  = OP_OPTIONS[op] || {};

  const show = (id, flag) => $(id).classList.toggle("hidden", !flag);

  show("opt-variable",  !!opts.variable);
  show("opt-order",     !!opts.order);
  show("opt-lower",     !!opts.lower);
  show("opt-upper",     !!opts.upper);
  show("opt-point",     !!opts.point);
  show("opt-direction", !!opts.direction);

  // Adjust order label
  if (op === "series") {
    orderInput.parentElement.querySelector(".field-label").textContent = "Number of Terms";
    orderInput.value = orderInput.value || "6";
    orderInput.max   = "10";
  } else {
    orderInput.parentElement.querySelector(".field-label").textContent = "Order";
    orderInput.max   = "10";
  }
}

/* ══════════════════════════════════════════════════════════════════════
   EXAMPLES GALLERY
══════════════════════════════════════════════════════════════════════ */

function buildExamples() {
  // Show a curated subset — 8 examples covering all categories
  const curated = [
    EXAMPLES.find(e => e.op === "derivative"),
    EXAMPLES.find(e => e.op === "integral"),
    EXAMPLES.find(e => e.op === "definite_integral"),
    EXAMPLES.find(e => e.op === "laplace"),
    EXAMPLES.find(e => e.op === "inverse_laplace"),
    EXAMPLES.find(e => e.op === "series"),
    EXAMPLES.find(e => e.op === "cyclic_decimal"),
    EXAMPLES.find(e => e.op === "matrix_eigen"),
    EXAMPLES.find(e => e.op === "ode"),
    EXAMPLES.find(e => e.op === "simplify"),
  ].filter(Boolean);

  examplesGrid.innerHTML = "";

  curated.forEach((ex) => {
    const btn = document.createElement("button");
    btn.className = "example-card";
    btn.innerHTML = `
      <span class="example-chip chip-${ex.label}">${ex.label.toUpperCase()}</span>
      <span class="example-expr">${ex.expr}</span>
      <span class="example-desc">${ex.desc}</span>
    `;
    btn.addEventListener("click", () => loadExample(ex));
    examplesGrid.appendChild(btn);
  });
}

function loadExample(ex) {
  opSelect.value   = ex.op;
  exprInput.value  = ex.expr;
  if (ex.order)    orderInput.value = ex.order;
  if (ex.lower)    lowerInput.value = ex.lower;
  if (ex.upper)    upperInput.value = ex.upper;
  if (ex.point)    pointInput.value = ex.point;
  if (ex.variable) varInput.value   = ex.variable;

  updateOptionVisibility();
  updatePreview();
  clearOutput();

  // Auto-solve after a short delay (nice UX)
  setTimeout(() => solveBtn.click(), 150);
}

/* ══════════════════════════════════════════════════════════════════════
   OUTPUT STATE MANAGEMENT
══════════════════════════════════════════════════════════════════════ */

function clearOutput() {
  idleState.classList.add("hidden");
  loaderEl.classList.add("hidden");
  errorBanner.classList.add("hidden");
  resultHeader.classList.add("hidden");
  stepsCont.classList.add("hidden");
  stepsList.innerHTML = "";
  copyBtn.disabled = true;
  lastResultLatex = "";
}

function showIdle() {
  clearOutput();
  idleState.classList.remove("hidden");
}

function showLoader() {
  clearOutput();
  loaderEl.classList.remove("hidden");
  solveBtn.disabled = true;
}

function hideLoader() {
  loaderEl.classList.add("hidden");
  solveBtn.disabled = false;
}

function showError(msg) {
  hideLoader();
  errorBanner.classList.remove("hidden");
  errorMsg.textContent = msg;
}

function showResult(data) {
  hideLoader();
  lastResultLatex = data.result_latex;
  copyBtn.disabled = false;

  // Meta row
  resultMeta.textContent = `${data.operation.replace(/_/g, " ").toUpperCase()}  ·  ${data.expression}`;
  resultHeader.classList.remove("hidden");

  // Final answer
  resultFinal.innerHTML = "";
  renderKaTeX(resultFinal, data.result_latex, true);

  // Steps
  if (data.steps && data.steps.length > 0) {
    stepsCount.textContent = `${data.steps.length} step${data.steps.length !== 1 ? "s" : ""}`;
    stepsList.innerHTML = "";

    data.steps.forEach((step, idx) => {
      const color = CHALK_COLORS[idx % CHALK_COLORS.length];
      const li = document.createElement("li");
      li.className = "step-card";
      li.style.setProperty("--step-color", color);
      li.style.animationDelay = `${idx * 50}ms`;

      const mathContainer = document.createElement("div");
      mathContainer.className = "step-math";
      renderKaTeX(mathContainer, step.latex, step.latex.length > 40);

      li.innerHTML = `
        <div class="step-num">${idx + 1}</div>
        <div class="step-body">
          <div class="step-label">${escHtml(step.label)}</div>
        </div>
      `;
      li.querySelector(".step-body").appendChild(mathContainer);

      if (step.note) {
        const noteEl = document.createElement("div");
        noteEl.className = "step-note";
        noteEl.textContent = step.note;
        li.querySelector(".step-body").appendChild(noteEl);
      }

      stepsList.appendChild(li);
    });

    stepsCont.classList.remove("hidden");
  }
}

/* ══════════════════════════════════════════════════════════════════════
   SOLVE REQUEST
══════════════════════════════════════════════════════════════════════ */

async function solve() {
  const expression = exprInput.value.trim();
  if (!expression) {
    exprInput.focus();
    exprInput.style.borderColor = "var(--accent-err)";
    setTimeout(() => { exprInput.style.borderColor = ""; }, 1200);
    return;
  }

  const op = opSelect.value;
  const payload = {
    expression,
    operation: op,
    variable:  varInput.value.trim() || "x",
    order:     parseInt(orderInput.value, 10) || 1,
    point:     pointInput.value.trim()  || "0",
    direction: dirSelect.value          || "+",
  };

  if (lowerInput.value.trim()) payload.lower = lowerInput.value.trim();
  if (upperInput.value.trim()) payload.upper = upperInput.value.trim();

  showLoader();

  try {
    const res = await fetch(`${API_BASE}/solve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),  // 30 s timeout for heavy computations
    });

    const data = await res.json();

    if (!res.ok) {
      const detail = data.detail || `HTTP ${res.status}`;
      showError(`Server error: ${detail}`);
      return;
    }

    showResult(data);
  } catch (err) {
    if (err.name === "TimeoutError") {
      showError("Request timed out — the computation may be too complex. Try a simpler expression.");
    } else if (err.name === "TypeError") {
      showError(
        `Network error — cannot reach ${API_BASE}.\n` +
        "Make sure the FastAPI server is running:\n  cd backend && python main.py"
      );
    } else {
      showError(`Unexpected error: ${err.message}`);
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════
   QUICK-INSERT BUTTONS
══════════════════════════════════════════════════════════════════════ */

document.querySelectorAll(".qbtn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const insert = btn.dataset.insert;
    const start  = exprInput.selectionStart;
    const end    = exprInput.selectionEnd;
    const value  = exprInput.value;
    exprInput.value = value.slice(0, start) + insert + value.slice(end);
    exprInput.selectionStart = exprInput.selectionEnd = start + insert.length;
    exprInput.focus();
    updatePreview();
  });
});

/* ══════════════════════════════════════════════════════════════════════
   THEME TOGGLE
══════════════════════════════════════════════════════════════════════ */

function toggleTheme() {
  const html = document.documentElement;
  const next = html.dataset.theme === "dark" ? "light" : "dark";
  html.dataset.theme = next;
  localStorage.setItem("wb-theme", next);
}

function initTheme() {
  const saved = localStorage.getItem("wb-theme");
  if (saved) document.documentElement.dataset.theme = saved;
}

/* ══════════════════════════════════════════════════════════════════════
   COPY LATEX
══════════════════════════════════════════════════════════════════════ */

async function copyLatex() {
  if (!lastResultLatex) return;
  try {
    await navigator.clipboard.writeText(lastResultLatex);
    copyBtn.textContent = "Copied ✓";
    setTimeout(() => { copyBtn.textContent = "Copy LaTeX"; }, 2000);
  } catch {
    // Fallback
    const ta = document.createElement("textarea");
    ta.value = lastResultLatex;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    copyBtn.textContent = "Copied ✓";
    setTimeout(() => { copyBtn.textContent = "Copy LaTeX"; }, 2000);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   UTILITY
══════════════════════════════════════════════════════════════════════ */

function escHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ══════════════════════════════════════════════════════════════════════
   EVENT WIRING
══════════════════════════════════════════════════════════════════════ */

// Operation change
opSelect.addEventListener("change", () => {
  updateOptionVisibility();
  clearOutput();
  showIdle();
});

// Expression input
exprInput.addEventListener("input", updatePreview);

// Keyboard shortcut: Cmd+Enter / Ctrl+Enter to solve
exprInput.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    solve();
  }
});

// Buttons
solveBtn .addEventListener("click", solve);
clearBtn .addEventListener("click", () => { exprInput.value = ""; updatePreview(); showIdle(); });
copyBtn  .addEventListener("click", copyLatex);
themeToggle.addEventListener("click", toggleTheme);

// Modal
structBtn  .addEventListener("click", () => structModal.classList.remove("hidden"));
modalClose .addEventListener("click", () => structModal.classList.add("hidden"));
structModal.addEventListener("click", (e) => { if (e.target === structModal) structModal.classList.add("hidden"); });

// Escape key closes modal
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") structModal.classList.add("hidden");
});

/* ══════════════════════════════════════════════════════════════════════
   INITIALISE
══════════════════════════════════════════════════════════════════════ */

(function init() {
  initTheme();
  updateOptionVisibility();
  buildExamples();
  showIdle();
  checkApiHealth();

  // Re-check health every 30 s
  setInterval(checkApiHealth, 30_000);

  // Focus expression input
  setTimeout(() => exprInput.focus(), 300);

  console.log(
    "%cWhiteboard Engine%c — Math Visualizer loaded\nAPI: " + API_BASE,
    "color:#63b3ed;font-weight:700;font-size:14px",
    "color:#9aa5c4;font-size:12px"
  );
})();
