import crypto from 'node:crypto';
import forge from 'node-forge';

function lastByteRange(buf) {
  const text = buf.toString('latin1');
  const re = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  let match;
  let last = null;
  while ((match = re.exec(text))) last = match.slice(1, 5).map(Number);
  return last;
}

/** Huella SHA-256 del certificado contenido en un PKCS#12. */
export function sealFingerprint(p12Buffer, password) {
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(p12Buffer.toString('binary')), password);
  const bag = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag][0];
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(bag.cert)).getBytes();
  return crypto.createHash('sha256').update(Buffer.from(der, 'binary')).digest('hex');
}

/**
 * Verifica criptográficamente el último sello del PDF:
 * - el ByteRange cubre todo el archivo menos la firma (nada agregado después),
 * - el digest firmado coincide con el contenido,
 * - la firma RSA sobre los atributos firmados es válida para el certificado incluido.
 */
export function verifySeal(buf, expectedFingerprint) {
  const result = { signed: false, intact: false, issuedByDocSure: false, signedAt: null, reason: '' };
  const range = lastByteRange(buf);
  if (!range) return { ...result, reason: 'El PDF no tiene sello digital.' };
  const [a, b, c, d] = range;
  if (a !== 0 || b <= 0 || c <= b || c + d !== buf.length) {
    return { ...result, signed: true, reason: 'El archivo fue modificado después de sellarse.' };
  }
  result.signed = true;
  const hex = buf.subarray(b + 1, c - 1).toString('latin1');
  try {
    if (!/^[0-9a-fA-F]+$/.test(hex)) throw new Error('Contents inválido');
    const der = forge.util.hexToBytes(hex);
    const msg = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(der, { parseAllBytes: false }));
    const cap = msg.rawCapture;
    const attrs = cap.authenticatedAttributes || [];
    let digest = null;
    for (const attr of attrs) {
      const oid = forge.asn1.derToOid(attr.value[0].value);
      if (oid === forge.pki.oids.messageDigest) digest = attr.value[1].value[0].value;
      if (oid === forge.pki.oids.signingTime) {
        const t = attr.value[1].value[0];
        result.signedAt = t.type === forge.asn1.Type.UTCTIME ? forge.asn1.utcTimeToDate(t.value) : forge.asn1.generalizedTimeToDate(t.value);
      }
    }
    const content = Buffer.concat([buf.subarray(a, a + b), buf.subarray(c, c + d)]);
    const actual = crypto.createHash('sha256').update(content).digest('binary');
    const set = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, attrs);
    const md = forge.md.sha256.create();
    md.update(forge.asn1.toDer(set).getBytes());
    const cert = msg.certificates[0];
    const signatureOk = cert.publicKey.verify(md.digest().bytes(), cap.signature);
    result.intact = digest === actual && signatureOk;
    const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
    const fp = crypto.createHash('sha256').update(Buffer.from(certDer, 'binary')).digest('hex');
    result.issuedByDocSure = fp === expectedFingerprint;
    result.reason = result.intact ? 'Sello válido: el documento no fue alterado.' : 'El contenido no coincide con el sello: el documento fue alterado.';
  } catch {
    result.reason = 'No se pudo leer el sello del documento.';
  }
  return result;
}
