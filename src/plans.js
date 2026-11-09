/** Planes de DocSure. monthlyEnvelopes = null significa sin límite. */
export const PLANS = {
  gratis: { name: 'Gratis', monthlyEnvelopes: 5 },
  personal: { name: 'Personal', monthlyEnvelopes: 25 },
  profesional: { name: 'Profesional', monthlyEnvelopes: null },
  empresa: { name: 'Empresa', monthlyEnvelopes: null },
};

export function planOf(key) {
  return PLANS[key] || PLANS.gratis;
}
