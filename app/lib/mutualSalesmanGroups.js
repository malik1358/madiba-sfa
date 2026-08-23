export const MUTUAL_SALESMAN_GROUPS = [["JUNAID", "PARVEZ", "SOYEB"]];

export function normalizeSalesmanName(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function normalizeSalesmanCode(value) {
  return String(value || "").trim().toUpperCase();
}

function comparableSalesmanName(value) {
  return normalizeSalesmanName(value).replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function looseSalesmanName(value) {
  return comparableSalesmanName(value)
    .replace(/[^A-Z]/g, "")
    .replace(/[AEIOU]/g, "")
    .replace(/(.)\1+/g, "$1");
}

function profileGroupKeys(profile) {
  const name = normalizeSalesmanName(profile?.salesman_name);
  const code = normalizeSalesmanCode(profile?.salesman_code);
  const firstName = name.split(/[\s(]/)[0] || "";
  const parenthetical = String(profile?.salesman_name || "").match(/\(([^)]+)\)/);
  const alias = parenthetical ? normalizeSalesmanCode(parenthetical[1]) : "";

  return [...new Set([name, code, firstName, alias].filter(Boolean))];
}

function nameTokens(value) {
  const comparable = comparableSalesmanName(value);
  if (!comparable) return [];

  return [...new Set(
    comparable
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3),
  )];
}

function matchesMutualGroup(profile, group) {
  const keys = profileGroupKeys(profile);
  return keys.some((key) => group.includes(key));
}

export function resolveMutualGroupProfiles(allProfiles, currentProfile) {
  const matchedGroup = MUTUAL_SALESMAN_GROUPS.find((group) => matchesMutualGroup(currentProfile, group));
  if (!matchedGroup) return [];

  return (allProfiles || []).filter((profile) => matchesMutualGroup(profile, matchedGroup));
}

export function resolveMutualGroupCodes(allProfiles, currentProfile) {
  return [...new Set(
    resolveMutualGroupProfiles(allProfiles, currentProfile)
      .map((profile) => normalizeSalesmanCode(profile.salesman_code))
      .filter(Boolean),
  )];
}

export function buildSalesmanScopeMatchers(scopeProfiles) {
  const codes = new Set();
  const comparableNames = new Set();
  const looseNames = new Set();
  const tokens = new Set();

  (scopeProfiles || []).forEach((profile) => {
    const code = normalizeSalesmanCode(profile?.salesman_code);
    if (code) {
      codes.add(code);
      tokens.add(code);
    }

    const name = normalizeSalesmanName(profile?.salesman_name);
    if (name) {
      comparableNames.add(name);
      comparableNames.add(comparableSalesmanName(profile?.salesman_name));
      const loose = looseSalesmanName(profile?.salesman_name);
      if (loose) looseNames.add(loose);
      nameTokens(profile?.salesman_name).forEach((token) => tokens.add(token));
    }

    profileGroupKeys(profile).forEach((key) => {
      if (/^[A-Z0-9]+$/.test(key)) tokens.add(key);
      else comparableNames.add(key);
    });
  });

  return { codes, comparableNames, looseNames, tokens };
}

export function salesmanValueMatchesScope(value, matchers) {
  const raw = String(value || "").trim();
  if (!raw || !matchers) return false;

  const code = normalizeSalesmanCode(raw);
  if (code && matchers.codes.has(code)) return true;

  const comparable = comparableSalesmanName(raw);
  if (comparable && matchers.comparableNames.has(comparable)) return true;

  const loose = looseSalesmanName(raw);
  if (loose && matchers.looseNames.has(loose)) return true;

  if (code && matchers.tokens.has(code)) return true;

  return nameTokens(raw).some((token) => matchers.tokens.has(token));
}
