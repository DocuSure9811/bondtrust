/**
 * Fórmulas de campos numéricos, sin eval: números, + - * /, paréntesis y referencias {Etiqueta}
 * a otros campos numéricos del mismo firmante. Lo usan el navegador (vista previa) y el servidor (valor final).
 */
const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, neg: 3 };

export function tokenize(src) {
  const s = String(src ?? '');
  if (s.length > 300) throw new Error('La fórmula es demasiado larga.');
  const out = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (/[0-9.,]/.test(ch)) {
      const m = s.slice(i).match(/^\d+([.,]\d+)?|^[.,]\d+/);
      if (!m) throw new Error('Número inválido en la fórmula.');
      out.push({ t: 'num', v: Number(m[0].replace(',', '.')) });
      i += m[0].length;
    } else if (ch === '{') {
      const end = s.indexOf('}', i);
      if (end < 0) throw new Error('Falta cerrar una llave } en la fórmula.');
      const name = s.slice(i + 1, end).trim();
      if (!name) throw new Error('Hay una referencia vacía {} en la fórmula.');
      out.push({ t: 'ref', name: name.toLowerCase() });
      i = end + 1;
    } else if ('+-*/'.includes(ch)) {
      const prev = out[out.length - 1];
      const unary = ch === '-' && (!prev || prev.t === 'op' || prev.t === '(');
      out.push({ t: 'op', v: unary ? 'neg' : ch });
      i += 1;
    } else if (ch === '(' || ch === ')') {
      out.push({ t: ch });
      i += 1;
    } else {
      throw new Error(`Carácter no permitido en la fórmula: "${ch}".`);
    }
  }
  if (!out.length) throw new Error('La fórmula está vacía.');
  return out;
}

/** Convierte a notación polaca inversa validando la sintaxis. */
export function parseFormula(src) {
  const output = [];
  const stack = [];
  let expectOperand = true;
  for (const tok of tokenize(src)) {
    if (tok.t === 'num' || tok.t === 'ref') {
      if (!expectOperand) throw new Error('Falta un operador entre dos valores.');
      output.push(tok);
      expectOperand = false;
    } else if (tok.t === 'op') {
      if (tok.v === 'neg') {
        if (!expectOperand) throw new Error('Operador mal ubicado.');
      } else if (expectOperand) {
        throw new Error('Falta un valor antes de un operador.');
      }
      while (stack.length && stack[stack.length - 1].t === 'op' && tok.v !== 'neg' && PREC[stack[stack.length - 1].v] >= PREC[tok.v]) output.push(stack.pop());
      stack.push(tok);
      expectOperand = true;
    } else if (tok.t === '(') {
      if (!expectOperand) throw new Error('Falta un operador antes de "(".');
      stack.push(tok);
    } else {
      if (expectOperand) throw new Error('Paréntesis vacío o incompleto.');
      while (stack.length && stack[stack.length - 1].t !== '(') output.push(stack.pop());
      if (!stack.length) throw new Error('Sobra un paréntesis ")".');
      stack.pop();
    }
  }
  if (expectOperand) throw new Error('La fórmula termina en un operador.');
  while (stack.length) {
    const tok = stack.pop();
    if (tok.t === '(') throw new Error('Falta cerrar un paréntesis.');
    output.push(tok);
  }
  return output;
}

export const formulaRefs = (src) => [...new Set(tokenize(src).filter((t) => t.t === 'ref').map((t) => t.name))];

/** Evalúa la fórmula. `lookup(nombre)` devuelve el valor numérico del campo referido (vacío = 0). Devuelve null si divide por cero. */
export function evaluateFormula(src, lookup) {
  const st = [];
  for (const tok of parseFormula(src)) {
    if (tok.t === 'num') st.push(tok.v);
    else if (tok.t === 'ref') st.push(Number(lookup(tok.name)) || 0);
    else if (tok.v === 'neg') st.push(-st.pop());
    else {
      const b = st.pop();
      const a = st.pop();
      if (tok.v === '/' && b === 0) return null;
      st.push(tok.v === '+' ? a + b : tok.v === '-' ? a - b : tok.v === '*' ? a * b : a / b);
    }
  }
  const v = st[0];
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

/** Texto para mostrar: hasta 2 decimales, con coma decimal. */
export const formatNumber = (v) => (v === null || v === undefined || v === '' ? '' : String(Math.round(Number(v) * 100) / 100).replace('.', ','));

/** Interpreta lo que escribe una persona: "1.234,5" o "1234.5". */
export function parseNumber(text) {
  const s = String(text ?? '').trim().replace(/\s/g, '');
  if (!s) return null;
  const normalized = /,\d{1,}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : NaN;
}
