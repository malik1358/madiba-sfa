/* Quick Order related helpers (constants and small utilities)
   Detailed recommendation algorithm will be extracted in a follow-up commit.
*/

export const DO_NOT_USE_REGEX = /do\s*not\s*use+/i;

export function isDoNotUseItem(name) {
  const text = String(name || "").trim().toLowerCase();
  return DO_NOT_USE_REGEX.test(text);
}
