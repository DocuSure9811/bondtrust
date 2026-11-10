import { HttpError, cleanNumber, cleanText } from '../validate.js';

export const FIELD_TYPES = new Set(['signature', 'initials', 'date', 'name', 'email', 'text', 'checkbox', 'select']);
/** Tipos cuyo valor puede controlar si otro campo se muestra. */
export const CONTROL_TYPES = new Set(['checkbox', 'select', 'text']);
export const VALIDATIONS = {
  email: { re: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'un email válido' },
  number: { re: /^-?\d+([.,]\d+)?$/, message: 'un número' },
  id: { re: /^[0-9A-Za-z.\- ]{5,20}$/, message: 'un número de documento válido' },
  phone: { re: /^\+?[\d\s().-]{7,20}$/, message: 'un teléfono válido' },
};
const MAX_OPTIONS = 30;

/**
 * Valida y normaliza los campos que llegan del editor o de la API.
 * Cada campo puede traer `key` (referencia propia) y `showIf: { key, equals }` (se muestra solo
 * si el campo `key` del mismo firmante tiene ese valor; en casillas "true" o "false").
 */
export function cleanFields(fieldsIn, recipients, pageCount) {
  const fields = fieldsIn.map((f, i) => {
    if (!FIELD_TYPES.has(f?.type)) throw new HttpError(400, 'Tipo de campo inválido.', 'validation');
    const recipient = recipients.find((r) => r.key === f.recipientKey);
    if (!recipient || recipient.role !== 'signer') throw new HttpError(400, 'Cada campo debe pertenecer a un firmante.', 'validation');
    const x = cleanNumber(f.x, { min: 0, max: 1, field: 'La posición' });
    const y = cleanNumber(f.y, { min: 0, max: 1, field: 'La posición' });
    const w = cleanNumber(f.w, { min: 0.01, max: 1, field: 'El ancho' });
    const h = cleanNumber(f.h, { min: 0.005, max: 1, field: 'El alto' });
    let options = null;
    if (f.type === 'select') {
      const list = Array.isArray(f.options) ? f.options.map((o) => cleanText(o, { max: 80, field: 'una opción de la lista', required: false })).filter(Boolean) : [];
      options = [...new Set(list)];
      if (options.length < 1 || options.length > MAX_OPTIONS) throw new HttpError(400, `Cada lista necesita entre 1 y ${MAX_OPTIONS} opciones distintas.`, 'validation');
    }
    const validation = f.type === 'text' && f.validation ? String(f.validation) : null;
    if (validation && !VALIDATIONS[validation]) throw new HttpError(400, 'Formato de campo inválido (email, number, id o phone).', 'validation');
    return {
      key: f.key === undefined || f.key === null ? `#${i}` : cleanText(String(f.key), { max: 60, field: 'la clave del campo' }),
      recipientKey: recipient.key,
      type: f.type,
      page: cleanNumber(f.page, { min: 1, max: pageCount, field: 'La página' }),
      x: Math.min(x, 1 - w),
      y: Math.min(y, 1 - h),
      w,
      h,
      required: f.type === 'checkbox' ? f.required === true : f.required !== false,
      label: cleanText(f.label ?? '', { max: 60, field: 'la etiqueta', required: false }),
      options,
      validation,
      showIf: f.showIf ?? null,
    };
  });

  const byKey = new Map();
  for (const f of fields) {
    if (byKey.has(f.key)) throw new HttpError(400, 'Hay dos campos con la misma clave.', 'validation');
    byKey.set(f.key, f);
  }
  for (const f of fields) {
    if (!f.showIf) continue;
    if (f.type === 'signature') throw new HttpError(400, 'La firma no puede ser condicional: cada firmante necesita una firma siempre visible.', 'validation');
    const parent = byKey.get(String(f.showIf.key));
    if (!parent || parent === f) throw new HttpError(400, 'La condición apunta a un campo que no existe.', 'validation');
    if (!CONTROL_TYPES.has(parent.type)) throw new HttpError(400, 'Solo una casilla, una lista o un texto pueden controlar otro campo.', 'validation');
    if (parent.recipientKey !== f.recipientKey) throw new HttpError(400, 'La condición tiene que usar un campo del mismo firmante.', 'validation');
    const equals = cleanText(String(f.showIf.equals ?? ''), { max: 80, field: 'el valor de la condición' });
    if (parent.type === 'checkbox' && !['true', 'false'].includes(equals)) throw new HttpError(400, 'Con una casilla, la condición es "true" (marcada) o "false" (sin marcar).', 'validation');
    if (parent.type === 'select' && !parent.options.includes(equals)) throw new HttpError(400, 'La condición tiene que usar una de las opciones de la lista.', 'validation');
    f.showIf = { key: parent.key, equals };
  }
  // Sin ciclos: cada cadena de condiciones termina en un campo siempre visible.
  for (const f of fields) {
    const seen = new Set();
    for (let cur = f; cur?.showIf; cur = byKey.get(cur.showIf.key)) {
      if (seen.has(cur.key)) throw new HttpError(400, 'Las condiciones forman un ciclo.', 'validation');
      seen.add(cur.key);
    }
  }
  return fields;
}

/** Inserta los campos normalizados y enlaza sus condiciones. */
export async function insertFields(db, envelopeId, fields, recipientIdOf) {
  const idByKey = new Map();
  for (const f of fields) {
    const { rows: [row] } = await db.query(
      `INSERT INTO fields (envelope_id, recipient_id, type, page, x, y, w, h, required, label, options, validation)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [envelopeId, recipientIdOf(f.recipientKey), f.type, f.page, f.x, f.y, f.w, f.h, f.required, f.label, f.options ? JSON.stringify(f.options) : null, f.validation],
    );
    idByKey.set(f.key, row.id);
  }
  for (const f of fields) {
    if (f.showIf) await db.query('UPDATE fields SET cond_field_id = $2, cond_value = $3 WHERE id = $1', [idByKey.get(f.key), idByKey.get(f.showIf.key), f.showIf.equals]);
  }
}

/** Convierte filas de la base al formato de entrada (para copiar sobres o plantillas). */
export function fieldsAsInput(rows, recipientKeyOf) {
  return rows.map((f) => ({
    key: f.id,
    recipientKey: recipientKeyOf(f),
    type: f.type, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, required: f.required, label: f.label,
    options: f.options, validation: f.validation,
    showIf: f.cond_field_id ? { key: f.cond_field_id, equals: f.cond_value } : null,
  }));
}

/** Decide qué campos ve el firmante según los valores cargados (los ocultos no se exigen ni se guardan). */
export function visibleFields(fields, valueOf) {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const memo = new Map();
  const visible = (f) => {
    if (memo.has(f.id)) return memo.get(f.id);
    memo.set(f.id, false);
    const parent = f.cond_field_id ? byId.get(f.cond_field_id) : null;
    const v = !f.cond_field_id || (parent ? visible(parent) && (valueOf(parent) ?? '') === f.cond_value : true);
    memo.set(f.id, v);
    return v;
  };
  return new Set(fields.filter(visible).map((f) => f.id));
}
