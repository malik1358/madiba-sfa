export const UNSAVED_ENTRY_EVENT = "madiba-unsaved-entry";

const claims = new Set();
let claimSeq = 0;

function emitUnsavedEntryChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(UNSAVED_ENTRY_EVENT, { detail: { count: claims.size } }));
}

export function claimUnsavedEntry() {
  const key = `unsaved-${++claimSeq}`;
  claims.add(key);
  emitUnsavedEntryChange();
  return () => {
    if (!claims.delete(key)) return;
    emitUnsavedEntryChange();
  };
}

export function claimedUnsavedEntryCount() {
  return claims.size;
}

export function resetUnsavedEntryClaimsForTests() {
  claims.clear();
  claimSeq = 0;
}

export function isEditableControl(element) {
  if (!element) return false;
  const tag = String(element.tagName || "").toUpperCase();
  if (tag === "INPUT") {
    const type = String(element.type || "text").toLowerCase();
    if (["button", "submit", "reset", "hidden", "image"].includes(type)) return false;
    return true;
  }
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (element.isContentEditable) return true;
  return false;
}

export function fieldIsDirty(field) {
  if (!field) return false;
  const type = String(field.type || "").toLowerCase();
  if (["hidden", "submit", "button", "reset", "image"].includes(type)) return false;
  if (type === "checkbox" || type === "radio") {
    return Boolean(field.checked) !== Boolean(field.defaultChecked);
  }
  if (type === "file") {
    return Boolean(field.files && field.files.length > 0);
  }
  return String(field.value || "") !== String(field.defaultValue || "");
}

export function isHtmlFormDirty(form) {
  if (!form) return false;
  if (String(form.getAttribute?.("data-allow-build-reload") || "") === "true") return false;
  const fields = form.querySelectorAll?.("input, textarea, select") || [];
  for (const field of fields) {
    if (fieldIsDirty(field)) return true;
  }
  return false;
}

export function hasOpenUnsavedEntry(root) {
  if (claims.size > 0) return true;
  if (!root) return false;
  if (root.querySelector?.('[data-entry-form="open"]')) return true;
  if (isEditableControl(root.activeElement)) return true;
  const forms = root.querySelectorAll?.("form") || [];
  for (const form of forms) {
    if (isHtmlFormDirty(form)) return true;
  }
  return false;
}
