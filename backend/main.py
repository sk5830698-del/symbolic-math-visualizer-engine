"""
╔══════════════════════════════════════════════════════════════════════════════╗
║          WHITEBOARD ENGINE — FastAPI + SymPy Symbolic Computation Core       ║
║                        Loopback Server: 127.0.0.1:8000                       ║
╚══════════════════════════════════════════════════════════════════════════════╝

Supported Operations
────────────────────
  • Symbolic Differentiation  (single & higher-order, partial)
  • Symbolic Integration       (indefinite & definite)
  • Laplace Transform          (forward & inverse)
  • ODE Solver                 (dsolve via classify_ode)
  • Taylor / Maclaurin Series  (configurable order)
  • Limit Evaluation
  • Cyclic / Repeating Decimal Expansion
  • Expression Simplification & Factoring
  • Matrix Operations          (det, inverse, eigenvalues)
"""

from __future__ import annotations

import re
import math
import traceback
from enum import Enum
from typing import Any, Optional

import sympy as sp
from sympy import (
    Symbol, symbols, Function, latex, simplify, factor, expand,
    diff, integrate, limit, oo, series, Matrix,
    laplace_transform, inverse_laplace_transform,
    dsolve, classify_ode,
    sin, cos, tan, exp, log, sqrt, pi, E, I,
    Rational, Integer, Float,
    Heaviside, DiracDelta,
)
from sympy.parsing.sympy_parser import (
    parse_expr,
    standard_transformations,
    implicit_multiplication_application,
    convert_xor,
    auto_symbol,
)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator

# ─────────────────────────── App Initialisation ───────────────────────────── #

app = FastAPI(
    title="Whiteboard Engine API",
    description="Symbolic math computation via SymPy",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # loopback frontend — open for local use
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────── Supported Operations ─────────────────────────── #

class Operation(str, Enum):
    DERIVATIVE        = "derivative"
    INTEGRAL          = "integral"
    DEFINITE_INTEGRAL = "definite_integral"
    LAPLACE           = "laplace"
    INVERSE_LAPLACE   = "inverse_laplace"
    ODE               = "ode"
    SERIES            = "series"
    LIMIT             = "limit"
    SIMPLIFY          = "simplify"
    FACTOR            = "factor"
    EXPAND            = "expand"
    CYCLIC_DECIMAL    = "cyclic_decimal"
    MATRIX_DET        = "matrix_det"
    MATRIX_INV        = "matrix_inv"
    MATRIX_EIGEN      = "matrix_eigen"

# ─────────────────────────────── Request Model ────────────────────────────── #

class SolveRequest(BaseModel):
    expression: str
    operation:  Operation
    variable:   Optional[str] = "x"
    order:      Optional[int] = 1          # derivative order / series order
    lower:      Optional[str] = None       # definite integral / limit lower bound
    upper:      Optional[str] = None       # definite integral limit upper bound
    point:      Optional[str] = "0"        # series expansion / limit point
    direction:  Optional[str] = "+"        # limit direction (+, -, +-. two-sided)

    @field_validator("expression")
    @classmethod
    def _sanitize_expression(cls, v: str) -> str:
        """
        Reject strings that contain Python builtins, dunder patterns, or
        shell-injection fragments that have no legitimate place in a math expr.
        """
        v = v.strip()
        if len(v) > 1_000:
            raise ValueError("Expression too long (max 1000 characters).")

        # Block Python execution patterns
        BLOCKED = [
            r"__\w+__",          # dunder attributes  (__import__, __class__ …)
            r"\bimport\b",       # import statements
            r"\bexec\b",
            r"\beval\b",
            r"\bcompile\b",
            r"\bopen\b",
            r"\bos\b",
            r"\bsys\b",
            r"\bsubprocess\b",
            r"\bgetattr\b",
            r"\bsetattr\b",
            r"\bdelattr\b",
            r"\bglobals\b",
            r"\blocals\b",
            r"\bvars\b",
            r"\bbuiltins\b",
            r"\\x[0-9a-fA-F]{2}",   # hex escapes
            r"\\u[0-9a-fA-F]{4}",   # unicode escapes
        ]
        for pattern in BLOCKED:
            if re.search(pattern, v, re.IGNORECASE):
                raise ValueError(
                    f"Expression contains a disallowed pattern: '{pattern}'. "
                    "Only mathematical expressions are accepted."
                )
        return v

    @field_validator("variable")
    @classmethod
    def _sanitize_variable(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return "x"
        v = v.strip()
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", v):
            raise ValueError("Variable must be a valid Python identifier (e.g. x, t, y0).")
        return v

    @field_validator("order")
    @classmethod
    def _validate_order(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and not (1 <= v <= 10):
            raise ValueError("Order must be between 1 and 10.")
        return v

# ─────────────────────────────── Response Model ───────────────────────────── #

class Step(BaseModel):
    label:   str
    latex:   str
    note:    Optional[str] = None

class SolveResponse(BaseModel):
    operation:    str
    expression:   str
    result_latex: str
    steps:        list[Step]
    error:        Optional[str] = None

# ──────────────────────────── Safe Expression Parser ──────────────────────── #

# Allowed names: SymPy symbols + a safe mathematical namespace
_SAFE_NAMESPACE: dict[str, Any] = {
    # SymPy top-level
    "sin": sp.sin, "cos": sp.cos, "tan": sp.tan, "cot": sp.cot,
    "sec": sp.sec, "csc": sp.csc,
    "asin": sp.asin, "acos": sp.acos, "atan": sp.atan, "atan2": sp.atan2,
    "sinh": sp.sinh, "cosh": sp.cosh, "tanh": sp.tanh,
    "exp": sp.exp, "log": sp.log, "ln": sp.log,
    "sqrt": sp.sqrt, "Abs": sp.Abs, "sign": sp.sign,
    "factorial": sp.factorial, "gamma": sp.gamma, "zeta": sp.zeta,
    "Heaviside": sp.Heaviside, "DiracDelta": sp.DiracDelta,
    "pi": sp.pi, "E": sp.E, "I": sp.I, "oo": sp.oo,
    "Rational": sp.Rational, "Integer": sp.Integer,
    # Matrix (for matrix ops)
    "Matrix": sp.Matrix,
}

_PARSE_TRANSFORMATIONS = (
    standard_transformations
    + (implicit_multiplication_application, convert_xor, auto_symbol)
)

def safe_parse(expr_str: str, local_syms: Optional[dict[str, Any]] = None) -> sp.Expr:
    """
    Parse a user-supplied expression string into a SymPy object.
    Raises ValueError on any parse or safety failure.
    """
    ns = {**_SAFE_NAMESPACE, **(local_syms or {})}
    try:
        parsed = parse_expr(
            expr_str,
            local_dict=ns,
            transformations=_PARSE_TRANSFORMATIONS,
        )
        return parsed
    except Exception as exc:
        raise ValueError(f"Could not parse expression '{expr_str}': {exc}") from exc

# ──────────────────────────────── Step Builders ───────────────────────────── #

def _step(label: str, expr: Any, note: Optional[str] = None) -> Step:
    return Step(label=label, latex=latex(expr), note=note)

def _step_raw(label: str, latex_str: str, note: Optional[str] = None) -> Step:
    return Step(label=label, latex=latex_str, note=note)

# ──────────────────────────── Operation Handlers ──────────────────────────── #

def handle_derivative(req: SolveRequest) -> SolveResponse:
    x   = symbols(req.variable)
    ns  = {req.variable: x}
    f   = safe_parse(req.expression, ns)
    n   = req.order or 1
    steps: list[Step] = []

    steps.append(_step("Original expression f(x)", f,
                        note=f"Differentiating with respect to {req.variable}"))

    accumulated = f
    for k in range(1, n + 1):
        d_accumulated = diff(accumulated, x)
        ordinal = {1:"1st",2:"2nd",3:"3rd"}.get(k, f"{k}th")
        steps.append(_step(
            f"Apply differentiation — {ordinal} derivative",
            d_accumulated,
            note=f"d{'ⁿ' if k>1 else ''}f/d{req.variable}{'ⁿ' if k>1 else ''} where n={k}",
        ))
        # intermediate simplification
        simplified = simplify(d_accumulated)
        if simplified != d_accumulated:
            steps.append(_step(f"Simplify {ordinal} derivative", simplified,
                               note="Algebraic simplification"))
        accumulated = simplified

    return SolveResponse(
        operation=req.operation,
        expression=req.expression,
        result_latex=latex(accumulated),
        steps=steps,
    )


def handle_integral(req: SolveRequest) -> SolveResponse:
    x   = symbols(req.variable)
    ns  = {req.variable: x}
    f   = safe_parse(req.expression, ns)
    steps: list[Step] = []

    steps.append(_step("Integrand f(x)", f,
                        note=f"Computing indefinite integral w.r.t. {req.variable}"))

    # Attempt to identify integration technique
    f_expanded = expand(f)
    if f_expanded != f:
        steps.append(_step("Expand integrand", f_expanded, note="Expand before integrating"))
        f_work = f_expanded
    else:
        f_work = f

    result = integrate(f_work, x)

    # Show result without + C first, then add constant
    steps.append(_step("Apply integration rules", result,
                        note="SymPy applies power rule, u-substitution, integration by parts as needed"))
    steps.append(_step_raw(
        "Add constant of integration",
        latex(result) + " + C",
        note="Don't forget the arbitrary constant C for indefinite integrals",
    ))

    return SolveResponse(
        operation=req.operation,
        expression=req.expression,
        result_latex=latex(result) + " + C",
        steps=steps,
    )


def handle_definite_integral(req: SolveRequest) -> SolveResponse:
    x   = symbols(req.variable)
    ns  = {req.variable: x}
    f   = safe_parse(req.expression, ns)
    steps: list[Step] = []

    if req.lower is None or req.upper is None:
        raise HTTPException(status_code=400,
                            detail="Definite integral requires 'lower' and 'upper' bounds.")

    a = safe_parse(req.lower,  ns)
    b = safe_parse(req.upper,  ns)

    steps.append(_step("Integrand f(x)", f,
                        note=f"Evaluating definite integral from {req.lower} to {req.upper}"))
    steps.append(_step_raw(
        "Set up definite integral",
        r"\int_{" + latex(a) + r"}^{" + latex(b) + r"} " + latex(f) + r" \, d" + req.variable,
    ))

    antideriv = integrate(f, x)
    steps.append(_step("Antiderivative F(x)", antideriv,
                        note="Find F(x) such that F'(x) = f(x)"))

    val_upper = antideriv.subs(x, b)
    val_lower = antideriv.subs(x, a)
    steps.append(_step_raw(
        "Apply Fundamental Theorem of Calculus",
        r"F(" + latex(b) + r") - F(" + latex(a) + r") = "
        + latex(val_upper) + r" - \left(" + latex(val_lower) + r"\right)",
        note="F(b) − F(a)",
    ))

    result = simplify(val_upper - val_lower)
    steps.append(_step("Evaluate & simplify", result, note="Final numerical / symbolic result"))

    return SolveResponse(
        operation=req.operation,
        expression=req.expression,
        result_latex=latex(result),
        steps=steps,
    )


def handle_laplace(req: SolveRequest) -> SolveResponse:
    t, s = symbols("t s", positive=True)
    var_sym = t  # Laplace is always over t → s
    ns = {"t": t, "s": s}
    f = safe_parse(req.expression, ns)
    steps: list[Step] = []

    steps.append(_step("Original time-domain function f(t)", f,
                        note="Taking Laplace transform ℒ{f(t)} = F(s)"))
    steps.append(_step_raw(
        "Apply Laplace Transform definition",
        r"\mathcal{L}\{f(t)\} = \int_0^{\infty} f(t)\, e^{-st}\, dt",
        note="The bilateral Laplace integral converges for Re(s) > σ₀",
    ))

    raw = laplace_transform(f, t, s, noconds=False)
    if isinstance(raw, tuple):
        F, a, cond = raw
    else:
        F, a, cond = raw, None, True

    steps.append(_step("Transform result F(s)", F,
                        note=f"Region of convergence: Re(s) > {latex(a) if a is not None else '?'}"))

    F_simplified = simplify(F)
    if F_simplified != F:
        steps.append(_step("Simplify F(s)", F_simplified, note="Algebraic simplification"))
        F = F_simplified

    return SolveResponse(
        operation=req.operation,
        expression=req.expression,
        result_latex=latex(F),
        steps=steps,
    )


def handle_inverse_laplace(req: SolveRequest) -> SolveResponse:
    t, s = symbols("t s", positive=True)
    ns = {"t": t, "s": s}
    F = safe_parse(req.expression, ns)
    steps: list[Step] = []

    steps.append(_step("F(s) — Laplace-domain expression", F,
                        note="Computing ℒ⁻¹{F(s)} = f(t)"))
    steps.append(_step_raw(
        "Apply Inverse Laplace definition",
        r"f(t) = \frac{1}{2\pi j}\int_{\sigma-j\infty}^{\sigma+j\infty} F(s)\,e^{st}\,ds",
        note="Bromwich integral — SymPy uses partial fractions + table lookup",
    ))

    # Partial-fraction decomposition for educational display
    try:
        pf = sp.apart(F, s)
        if pf != F:
            steps.append(_step("Partial fraction decomposition", pf,
                               note="Decompose into recognisable Laplace pairs"))
            F_work = pf
        else:
            F_work = F
    except Exception:
        F_work = F

    result = inverse_laplace_transform(F_work, s, t)
    result_simplified = simplify(result)

    steps.append(_step("Apply inverse transform", result,
                        note="Match to known Laplace pair table"))
    if result_simplified != result:
        steps.append(_step("Simplify f(t)", result_simplified,
                           note="Trigonometric / exponential simplification"))
        result_simplified_final = result_simplified
    else:
        result_simplified_final = result

    return SolveResponse(
        operation=req.operation,
        expression=req.expression,
        result_latex=latex(result_simplified_final),
        steps=steps,
    )


def handle_ode(req: SolveRequest) -> SolveResponse:
    """
    ODE solver.  The user writes the ODE with y as a function of x, e.g.:
        f(x).diff(x,2) + f(x).diff(x) - 2*f(x)
    or using standard notation which we pre-process.
    """
    x = symbols(req.variable)
    f = Function("f")
    ns: dict[str, Any] = {req.variable: x, "f": f, "y": f}
    steps: list[Step] = []

    ode_expr = safe_parse(req.expression, ns)
    steps.append(_step("ODE (set equal to zero)", ode_expr,
                        note="We solve ODE = 0 for f(x)"))

    hints = classify_ode(ode_expr, f(x))
    if hints:
        steps.append(Step(
            label="ODE Classification",
            latex=r"\text{Type: }" + r",\; ".join(hints[:3]),
            note="SymPy classified the ODE — choosing best solution method",
        ))

    sol = dsolve(ode_expr, f(x))
    steps.append(_step("General solution", sol, note="C1, C2, … are arbitrary constants"))

    return SolveResponse(
        operation=req.operation,
        expression=req.expression,
        result_latex=latex(sol),
        steps=steps,
    )


def handle_series(req: SolveRequest) -> SolveResponse:
    x   = symbols(req.variable)
    ns  = {req.variable: x}
    f   = safe_parse(req.expression, ns)
    pt  = safe_parse(req.point or "0", ns)
    n   = min(req.order or 6, 10) + 1   # terms = order + 1, cap at 11
    steps: list[Step] = []

    steps.append(_step("Function f(x)", f,
                        note=f"Expanding as Taylor/Maclaurin series around x = {req.point}"))
    steps.append(_step_raw(
        "Taylor series formula",
        r"f(x) = \sum_{n=0}^{\infty} \frac{f^{(n)}(a)}{n!}(x-a)^n",
        note=f"a = {req.point}",
    ))

    # Show first few derivatives evaluated at the point
    for k in range(min(3, n)):
        dk = diff(f, x, k)
        val = dk.subs(x, pt)
        steps.append(_step(
            f"f{'⁽' + str(k) + '⁾' if k > 0 else ''}({req.point}) = {latex(val)}",
            dk,
            note=f"Evaluate {k}-th derivative at x={req.point}",
        ))

    s_expr = series(f, x, pt, n)
    steps.append(_step(
        f"Series expansion up to order {n-1}",
        s_expr,
        note="Big-O notation shows the truncation error order",
    ))

    return SolveResponse(
        operation=req.operation,
        expression=req.expression,
        result_latex=latex(s_expr),
        steps=steps,
    )


def handle_limit(req: SolveRequest) -> SolveResponse:
    x   = symbols(req.variable)
    ns  = {req.variable: x, "oo": sp.oo, "inf": sp.oo}
    f   = safe_parse(req.expression, ns)
    pt  = safe_parse(req.point or "0",  ns)
    dir_map = {"+": "+", "-": "-", "+-": "+-", "two-sided": "+-"}
    direction = dir_map.get(req.direction or "+", "+")
    steps: list[Step] = []

    direction_text = {"+" : "from the right (x → a⁺)",
                      "-" : "from the left  (x → a⁻)",
                      "+-": "two-sided      (x → a)"}[direction]

    steps.append(_step("Expression f(x)", f,
                        note=f"Computing limit as {req.variable} → {req.point} {direction_text}"))
    steps.append(_step_raw(
        "Limit notation",
        r"\lim_{" + req.variable + r" \to " + latex(pt) + r"} " + latex(f),
    ))

    # Check direct substitution
    try:
        direct = f.subs(x, pt)
        if direct.is_finite and direct != sp.nan:
            steps.append(_step("Direct substitution", direct,
                               note="Expression is defined at the point — direct substitution works"))
    except Exception:
        steps.append(Step(label="Direct substitution",
                          latex=r"\text{Indeterminate — applying L'Hôpital / algebraic techniques}",
                          note="Form 0/0 or ∞/∞ — further analysis needed"))

    result = limit(f, x, pt, direction)
    steps.append(_step("Final limit result", result,
                        note="SymPy applies L'Hôpital's rule, series expansion, or algebraic manipulation as needed"))

    return SolveResponse(
        operation=req.operation,
        expression=req.expression,
        result_latex=latex(result),
        steps=steps,
    )


def handle_simplify(req: SolveRequest) -> SolveResponse:
    x  = symbols(req.variable)
    ns = {req.variable: x}
    f  = safe_parse(req.expression, ns)
    steps: list[Step] = []

    steps.append(_step("Original expression", f))
    expanded = expand(f)
    steps.append(_step("Expand", expanded, note="Expand all products and powers"))
    result = simplify(f)
    steps.append(_step("Simplify", result,
                        note="Apply trigonometric identities, factor, cancel common terms"))

    return SolveResponse(
        operation=req.operation,
        expression=req.expression,
        result_latex=latex(result),
        steps=steps,
    )


def handle_factor(req: SolveRequest) -> SolveResponse:
    x  = symbols(req.variable)
    ns = {req.variable: x}
    f  = safe_parse(req.expression, ns)
    steps: list[Step] = []

    steps.append(_step("Original expression", f))
    expanded = expand(f)
    steps.append(_step("Expand first", expanded, note="Ensure polynomial is in standard form"))
    result = factor(expanded)
    steps.append(_step("Factored form", result,
                        note="Factor over ℤ (integers) — use extension=True for ℂ or algebraic factors"))

    return SolveResponse(
        operation=req.operation,
        expression=req.expression,
        result_latex=latex(result),
        steps=steps,
    )


def handle_expand(req: SolveRequest) -> SolveResponse:
    x  = symbols(req.variable)
    ns = {req.variable: x}
    f  = safe_parse(req.expression, ns)
    steps: list[Step] = []

    steps.append(_step("Original expression", f))
    result = expand(f)
    steps.append(_step("Expanded form", result, note="Distribute and expand all terms"))

    return SolveResponse(
        operation=req.operation,
        expression=req.expression,
        result_latex=latex(result),
        steps=steps,
    )


def handle_cyclic_decimal(req: SolveRequest) -> SolveResponse:
    """
    Convert a fraction p/q to its decimal expansion, identifying the cyclic
    (repeating) block length and period. Expression should be like '1/7' or '355/113'.
    """
    steps: list[Step] = []

    # Parse as Rational
    try:
        r = sp.Rational(req.expression)
    except Exception:
        ns: dict[str, Any] = {}
        parsed = safe_parse(req.expression, ns)
        r = sp.Rational(parsed)

    p, q = int(r.p), int(r.q)
    steps.append(Step(
        label="Input fraction",
        latex=rf"\frac{{{p}}}{{{q}}}",
        note=f"Numerator = {p}, Denominator = {q}",
    ))

    # Reduce
    from math import gcd
    g = gcd(abs(p), abs(q))
    p, q = p // g, q // g
    steps.append(Step(
        label="Reduced fraction",
        latex=rf"\frac{{{p}}}{{{q}}}",
        note="Divide numerator and denominator by GCD",
    ))

    # Integer part
    integer_part = p // q
    remainder = abs(p) % q
    steps.append(Step(
        label="Integer part",
        latex=str(integer_part),
        note=f"{p} ÷ {q} = {integer_part} remainder {remainder}",
    ))

    # Long division to find decimal digits & cycle
    digits: list[str] = []
    remainders: dict[int, int] = {}
    cycle_start = -1

    while remainder != 0:
        if remainder in remainders:
            cycle_start = remainders[remainder]
            break
        remainders[remainder] = len(digits)
        remainder *= 10
        digits.append(str(remainder // q))
        remainder %= q

    non_repeating = "".join(digits[:cycle_start]) if cycle_start >= 0 else "".join(digits)
    repeating     = "".join(digits[cycle_start:]) if cycle_start >= 0 else ""

    decimal_str = f"{integer_part}."
    if non_repeating:
        decimal_str += non_repeating
    if repeating:
        decimal_str += f"\\overline{{{repeating}}}"
    else:
        decimal_str += "0" if not non_repeating else ""

    steps.append(Step(
        label="Long-division decimal expansion",
        latex=decimal_str,
        note=f"Non-repeating block: '{non_repeating or 'none'}' | Repeating (cyclic) block: '{repeating or 'none'}'",
    ))

    if repeating:
        period = len(repeating)
        steps.append(Step(
            label="Cycle period",
            latex=rf"\text{{Period}} = {period}, \quad \overline{{{repeating}}}",
            note=(
                f"The sequence '{repeating}' repeats every {period} digit(s). "
                f"This is related to the multiplicative order of 10 modulo {q}."
            ),
        ))
        # Proof via geometric series
        steps.append(Step(
            label="Verify via geometric series",
            latex=(
                rf"\frac{{{p}}}{{{q}}} = {integer_part} + "
                rf"\frac{{{repeating}}}{{{'9' * period}}}"
                + (rf" \cdot 10^{{-{len(non_repeating)}}}" if non_repeating else "")
            ),
            note="Each repeating decimal maps to a fraction with denominator 9, 99, 999, …",
        ))

    return SolveResponse(
        operation=req.operation,
        expression=req.expression,
        result_latex=decimal_str,
        steps=steps,
    )


def handle_matrix_det(req: SolveRequest) -> SolveResponse:
    """Matrix determinant.  Expression: '[[1,2],[3,4]]'"""
    ns: dict[str, Any] = {"Matrix": sp.Matrix}
    M = safe_parse(req.expression, ns)
    if not isinstance(M, sp.MatrixBase):
        M = sp.Matrix(M)
    steps: list[Step] = []

    steps.append(_step("Matrix A", M, note="Computing det(A)"))
    det_val = M.det()
    steps.append(_step("Determinant", det_val,
                        note="Computed via cofactor expansion / LU decomposition"))
    steps.append(_step("Simplified determinant", simplify(det_val)))

    return SolveResponse(
        operation=req.operation,
        expression=req.expression,
        result_latex=latex(simplify(det_val)),
        steps=steps,
    )


def handle_matrix_inv(req: SolveRequest) -> SolveResponse:
    ns: dict[str, Any] = {"Matrix": sp.Matrix}
    M = safe_parse(req.expression, ns)
    if not isinstance(M, sp.MatrixBase):
        M = sp.Matrix(M)
    steps: list[Step] = []

    steps.append(_step("Matrix A", M))
    det_val = M.det()
    steps.append(_step("det(A)", det_val, note="Matrix is invertible iff det ≠ 0"))
    if det_val == 0:
        raise HTTPException(status_code=400, detail="Matrix is singular — no inverse exists.")
    inv = M.inv()
    steps.append(_step("A⁻¹ (raw)", inv, note="Computed via adjugate / LU"))
    steps.append(_step("A⁻¹ (simplified)", simplify(inv)))

    return SolveResponse(
        operation=req.operation,
        expression=req.expression,
        result_latex=latex(simplify(inv)),
        steps=steps,
    )


def handle_matrix_eigen(req: SolveRequest) -> SolveResponse:
    ns: dict[str, Any] = {"Matrix": sp.Matrix}
    M = safe_parse(req.expression, ns)
    if not isinstance(M, sp.MatrixBase):
        M = sp.Matrix(M)
    steps: list[Step] = []

    steps.append(_step("Matrix A", M))
    steps.append(_step_raw(
        "Characteristic equation",
        r"\det(A - \lambda I) = 0",
        note="Solve for eigenvalues λ",
    ))

    char_poly = M.charpoly(sp.Symbol("lambda"))
    steps.append(_step("Characteristic polynomial", char_poly,
                        note="Set this equal to zero and solve for λ"))

    eigenvals = M.eigenvals()
    eigen_latex = r",\quad ".join(
        [rf"\lambda = {latex(ev)}\;(\text{{mult.}}\;{mult})" for ev, mult in eigenvals.items()]
    )
    steps.append(Step(label="Eigenvalues", latex=eigen_latex,
                      note="Algebraic multiplicities shown"))

    eigenvects = M.eigenvects()
    for ev, mult, vects in eigenvects[:4]:   # cap display at 4
        for v in vects:
            steps.append(_step(
                f"Eigenvector for λ = {latex(ev)}",
                v,
                note=f"Solve (A − {latex(ev)}I)v = 0",
            ))

    return SolveResponse(
        operation=req.operation,
        expression=req.expression,
        result_latex=eigen_latex,
        steps=steps,
    )


# ─────────────────────────────── Route Dispatch ───────────────────────────── #

_HANDLERS = {
    Operation.DERIVATIVE:        handle_derivative,
    Operation.INTEGRAL:          handle_integral,
    Operation.DEFINITE_INTEGRAL: handle_definite_integral,
    Operation.LAPLACE:           handle_laplace,
    Operation.INVERSE_LAPLACE:   handle_inverse_laplace,
    Operation.ODE:               handle_ode,
    Operation.SERIES:            handle_series,
    Operation.LIMIT:             handle_limit,
    Operation.SIMPLIFY:          handle_simplify,
    Operation.FACTOR:            handle_factor,
    Operation.EXPAND:            handle_expand,
    Operation.CYCLIC_DECIMAL:    handle_cyclic_decimal,
    Operation.MATRIX_DET:        handle_matrix_det,
    Operation.MATRIX_INV:        handle_matrix_inv,
    Operation.MATRIX_EIGEN:      handle_matrix_eigen,
}

@app.get("/")
def root():
    return {"service": "Whiteboard Engine API", "status": "running", "version": "1.0.0"}

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/operations")
def list_operations():
    return {"operations": [op.value for op in Operation]}

@app.post("/solve", response_model=SolveResponse)
def solve(req: SolveRequest):
    handler = _HANDLERS.get(req.operation)
    if handler is None:
        raise HTTPException(status_code=400, detail=f"Unknown operation: {req.operation}")
    try:
        return handler(req)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        # Log full traceback server-side; return sanitized message to client
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Computation error: {str(exc)[:300]}",
        ) from exc


# ────────────────────────────── Entry Point ───────────────────────────────── #

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        log_level="info",
    )
