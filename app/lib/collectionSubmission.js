// Offline replay key for collection visits; same pattern as sales_orders.request_id.
const SUBMISSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REPLAY_SELECT = "id,customer_code,created_by,latitude,longitude,summary_text,visit_number_for_day";
const REPLAY_SELECT_MINIMAL = "id,customer_code,created_by";

export function createClientSubmissionId(cryptoImpl = globalThis.crypto) {
  if (typeof cryptoImpl?.randomUUID === "function") return cryptoImpl.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof cryptoImpl?.getRandomValues === "function") {
    cryptoImpl.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function parseClientSubmissionId(value) {
  const id = String(value ?? "").trim().toLowerCase();
  if (!id) return { id: "", valid: true };
  if (!SUBMISSION_ID_PATTERN.test(id)) return { id: "", valid: false };
  return { id, valid: true };
}

function errorText(error) {
  return String(error?.message || error?.details || error?.hint || "").toLowerCase();
}

export function isMissingColumnError(error) {
  const message = errorText(error);
  return error?.code === "42703"
    || error?.code === "PGRST204"
    || (message.includes("column") && (message.includes("does not exist") || message.includes("could not find")));
}

export function isMissingClientSubmissionColumnError(error) {
  return isMissingColumnError(error) && errorText(error).includes("client_submission_id");
}

export function isUniqueViolationError(error) {
  return error?.code === "23505" || /duplicate key|unique constraint/i.test(errorText(error));
}

// supported=false means the migration is not applied yet; callers fall back to the old insert path.
export async function findCollectionVisitBySubmissionId(admin, clientSubmissionId, userId) {
  if (!clientSubmissionId || !userId) return { row: null, supported: true };

  for (const columns of [REPLAY_SELECT, REPLAY_SELECT_MINIMAL]) {
    const { data, error } = await admin
      .from("collection_visits")
      .select(columns)
      .eq("client_submission_id", clientSubmissionId)
      .eq("created_by", userId)
      .maybeSingle();

    if (!error) return { row: data || null, supported: true };
    if (isMissingClientSubmissionColumnError(error)) return { row: null, supported: false };
    if (!isMissingColumnError(error)) throw error;
  }

  return { row: null, supported: false };
}

export function buildCollectionVisitReplayResponse(row) {
  const visitNumber = Number(row?.visit_number_for_day);
  return {
    success: true,
    duplicate: true,
    message: "Collection visit already saved",
    visitId: row?.id ?? null,
    gpsCaptured: row?.latitude != null && row?.longitude != null,
    summaryText: row?.summary_text || null,
    visitNumberForDay: Number.isFinite(visitNumber) && visitNumber > 0 ? visitNumber : null,
  };
}
