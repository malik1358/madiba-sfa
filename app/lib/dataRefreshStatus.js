export const DATA_REFRESH_STATUS_EVENT = "madiba-data-refresh-status";

export const DATA_REFRESH_STEPS = [
  "download",
  "collections",
  "customers",
  "items",
  "orders",
  "prices",
];

const SNAPSHOT_STEPS = ["download", "collections", "customers", "items", "orders"];

let state = {
  active: false,
  job: "",
  steps: [],
  doneCount: 0,
  totalCount: 0,
  lastBuiltAt: "",
  lastSavedAt: 0,
  error: "",
};

function cloneState() {
  return {
    ...state,
    steps: state.steps.map((step) => ({ ...step })),
  };
}

function emit() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DATA_REFRESH_STATUS_EVENT, { detail: cloneState() }));
}

export function getDataRefreshStatus() {
  return cloneState();
}

export function subscribeDataRefreshStatus(listener) {
  if (typeof listener !== "function") return () => {};
  if (typeof window === "undefined") return () => {};

  const handler = (event) => {
    listener(event?.detail || getDataRefreshStatus());
  };
  window.addEventListener(DATA_REFRESH_STATUS_EVENT, handler);
  listener(getDataRefreshStatus());
  return () => window.removeEventListener(DATA_REFRESH_STATUS_EVENT, handler);
}

export function seedDataRefreshMeta({ lastBuiltAt, lastSavedAt } = {}) {
  if (lastBuiltAt) state.lastBuiltAt = String(lastBuiltAt);
  if (Number(lastSavedAt) > 0) state.lastSavedAt = Number(lastSavedAt);
  emit();
}

export function snapshotRefreshSteps(includePrices = false) {
  return includePrices ? [...SNAPSHOT_STEPS, "prices"] : [...SNAPSHOT_STEPS];
}

export function startDataRefreshJob(job, stepIds = SNAPSHOT_STEPS) {
  const ids = (Array.isArray(stepIds) ? stepIds : SNAPSHOT_STEPS)
    .map((id) => String(id || "").trim())
    .filter(Boolean);

  state = {
    ...state,
    active: true,
    job: String(job || "device-data"),
    steps: ids.map((id, index) => ({
      id,
      status: index === 0 ? "running" : "pending",
    })),
    doneCount: 0,
    totalCount: ids.length,
    error: "",
  };
  emit();
}

export function markDataRefreshStep(id, status = "done") {
  if (!state.active) return;
  const stepId = String(id || "").trim();
  const nextStatus = String(status || "done").trim() || "done";
  if (!state.steps.some((step) => step.id === stepId)) return;

  state.steps = state.steps.map((step) => {
    if (step.id === stepId) return { ...step, status: nextStatus };
    if (nextStatus === "running" && step.status === "running") {
      return { ...step, status: "pending" };
    }
    return step;
  });
  state.doneCount = state.steps.filter((step) => step.status === "done").length;
  emit();
}

export function finishDataRefreshJob(options = {}) {
  const error = String(options.error || "").trim();
  if (options.lastBuiltAt) state.lastBuiltAt = String(options.lastBuiltAt);
  if (Number(options.lastSavedAt) > 0) state.lastSavedAt = Number(options.lastSavedAt);

  state.active = false;
  state.error = error;
  if (!error) {
    state.steps = [];
    state.doneCount = 0;
    state.totalCount = 0;
  }
  emit();
}

export function dataRefreshProgressPercent(status = state) {
  const total = Number(status.totalCount || 0);
  if (total <= 0) return 0;
  const done = Number(status.doneCount || 0);
  const running = (status.steps || []).some((step) => step.status === "running") ? 0.4 : 0;
  return Math.max(0, Math.min(100, Math.round(((done + running) / total) * 100)));
}

export function formatDataAge(timestamp, now = Date.now(), language = "en") {
  const isAr = language === "ar";
  const value = typeof timestamp === "string" ? Date.parse(timestamp) : Number(timestamp || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return isAr ? "غير معروف" : "unknown";
  }

  const elapsedMs = Math.max(0, now - value);
  const minutes = Math.floor(elapsedMs / 60000);
  if (minutes < 1) return isAr ? "الآن" : "just now";
  if (minutes < 60) {
    return isAr ? `قبل ${minutes} د` : `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return isAr ? `قبل ${hours} س` : `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return isAr ? `قبل ${days} ي` : `${days}d ago`;
}

export function isDataRefreshStale(status = state, maxAgeMs = 6 * 60 * 60 * 1000, now = Date.now()) {
  const savedAt = Number(status.lastSavedAt || 0);
  const builtAt = Date.parse(status.lastBuiltAt || "") || 0;
  const latest = Math.max(savedAt, builtAt);
  if (!latest) return true;
  return now - latest > maxAgeMs;
}
