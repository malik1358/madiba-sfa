/**
 * Salesman-wise order numbers allotted offline and never changed after sync.
 *
 * Short prefix rules (from the salesman code/name letters):
 * - 1 letter when no other salesman shares that first letter → P01 (Parvez)
 * - 2+ letters when first letter collides → PA01 vs PE01
 *
 * Legacy hyphen form PARVEZ-0042 is still parsed for older queued rows.
 */

const SEQ_PAD = 2;

/** Letters-only key from a salesman code/name (AHMED NABIL → AHMEDNABIL). */
export function normalizeSalesmanLetters(salesmanCode = "") {
  return String(salesmanCode || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

/** @deprecated use normalizeSalesmanLetters — kept for older imports/tests */
export function normalizeSalesmanOrderPrefix(salesmanCode = "") {
  return normalizeSalesmanLetters(salesmanCode);
}

/**
 * Pick the shortest unique letter prefix among peer salesmen.
 * 1 letter when unique; otherwise grow (usually to 2) until unique.
 */
export function resolveSalesmanOrderPrefix(salesmanCode = "", peerCodes = []) {
  const self = normalizeSalesmanLetters(salesmanCode);
  if (!self) return "";

  const peers = [...new Set(
    [self, ...(Array.isArray(peerCodes) ? peerCodes : [])]
      .map((code) => normalizeSalesmanLetters(code))
      .filter(Boolean),
  )];

  const first = self.slice(0, 1);
  const sameFirst = peers.filter((peer) => peer.slice(0, 1) === first);
  if (sameFirst.length <= 1) return first;

  for (let length = 2; length <= self.length; length += 1) {
    const candidate = self.slice(0, length);
    const collisions = peers.filter(
      (peer) => peer !== self && peer.slice(0, length) === candidate,
    );
    if (collisions.length === 0) return candidate;
  }

  return self;
}

export function formatSalesmanOrderNumber(salesmanCode, sequence, {
  peerCodes = [],
  prefix = "",
} = {}) {
  const resolvedPrefix = String(prefix || "").trim().toUpperCase()
    || resolveSalesmanOrderPrefix(salesmanCode, peerCodes);
  const seq = Number(sequence);
  if (!resolvedPrefix || !Number.isFinite(seq) || seq < 1) return "";
  return `${resolvedPrefix}${String(Math.floor(seq)).padStart(SEQ_PAD, "0")}`;
}

export function parseSalesmanOrderNumber(orderNumber = "") {
  const text = String(orderNumber || "").trim().toUpperCase();

  // New short form: P01, PA01, AHM12
  const compact = text.match(/^([A-Z]{1,16})(\d{1,8})$/);
  if (compact) {
    return {
      prefix: compact[1],
      sequence: Number(compact[2]),
      orderNumber: `${compact[1]}${compact[2].padStart(SEQ_PAD, "0")}`,
    };
  }

  // Legacy form: PARVEZ-0042
  const legacy = text.match(/^([A-Z0-9]{1,16})-(\d{1,8})$/);
  if (legacy) {
    return {
      prefix: legacy[1],
      sequence: Number(legacy[2]),
      orderNumber: `${legacy[1]}-${legacy[2].padStart(4, "0")}`,
    };
  }

  return null;
}

export function isSalesmanOrderNumber(orderNumber = "") {
  return Boolean(parseSalesmanOrderNumber(orderNumber));
}

export function isSalesmanOrderNumberForCode(orderNumber, salesmanCode) {
  const parsed = parseSalesmanOrderNumber(orderNumber);
  if (!parsed) return false;
  const letters = normalizeSalesmanLetters(salesmanCode);
  if (!letters) return false;
  // Short prefix P/PA must belong to this salesman; legacy used full letters.
  return letters.startsWith(parsed.prefix) || parsed.prefix === letters;
}

export function maxSequenceFromOrderNumbers(orderNumbers = [], salesmanCode = "", peerCodes = []) {
  const expectedPrefix = resolveSalesmanOrderPrefix(salesmanCode, peerCodes);
  if (!expectedPrefix) return 0;
  return maxSequenceForPrefix(orderNumbers, expectedPrefix);
}

/** Max sequence among numbers that use this exact letter prefix (e.g. MOI → 417). */
export function maxSequenceForPrefix(orderNumbers = [], prefix = "") {
  const expectedPrefix = String(prefix || "").trim().toUpperCase();
  if (!expectedPrefix) return 0;
  let max = 0;
  (Array.isArray(orderNumbers) ? orderNumbers : []).forEach((value) => {
    const parsed = parseSalesmanOrderNumber(value);
    if (!parsed || parsed.prefix !== expectedPrefix) return;
    if (parsed.sequence > max) max = parsed.sequence;
  });
  return max;
}

export function nextSalesmanOrderSequence(currentMax = 0) {
  const max = Number(currentMax);
  if (!Number.isFinite(max) || max < 0) return 1;
  return Math.floor(max) + 1;
}

/**
 * Accept a client-preferred series number only when it is ahead of the known
 * server max and not already used. Rejects stale low numbers like MOI01 when
 * the series is already at MOI417.
 */
export function shouldAcceptPreferredSalesmanOrderNumber({
  preferredOrderNumber = "",
  salesmanCode = "",
  serverMaxSequence = 0,
  usedOrderNumbers = [],
} = {}) {
  const preferred = String(preferredOrderNumber || "").trim().toUpperCase();
  if (!preferred || !isSalesmanOrderNumberForCode(preferred, salesmanCode)) {
    return false;
  }
  const parsed = parseSalesmanOrderNumber(preferred);
  if (!parsed) return false;

  const used = new Set(
    (Array.isArray(usedOrderNumbers) ? usedOrderNumbers : [])
      .map((value) => String(value || "").trim().toUpperCase())
      .filter(Boolean),
  );
  if (used.has(parsed.orderNumber) || used.has(preferred)) return false;

  const serverMax = Number(serverMaxSequence);
  const knownMax = Number.isFinite(serverMax) && serverMax > 0 ? Math.floor(serverMax) : 0;
  return parsed.sequence > knownMax;
}
