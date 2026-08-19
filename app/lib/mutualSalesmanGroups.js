export const MUTUAL_SALESMAN_GROUPS = [["JUNAID", "PARVEZ", "SOYEB"]];

export function normalizeSalesmanName(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function normalizeSalesmanCode(value) {
  return String(value || "").trim().toUpperCase();
}

function profileGroupKeys(profile) {
  const name = normalizeSalesmanName(profile?.salesman_name);
  const code = normalizeSalesmanCode(profile?.salesman_code);
  const firstName = name.split(/[\s(]/)[0] || "";

  return [...new Set([name, code, firstName].filter(Boolean))];
}

function matchesMutualGroup(profile, group) {
  const keys = profileGroupKeys(profile);
  return keys.some((key) => group.includes(key));
}

export function resolveMutualGroupCodes(allProfiles, currentProfile) {
  const matchedGroup = MUTUAL_SALESMAN_GROUPS.find((group) => matchesMutualGroup(currentProfile, group));
  if (!matchedGroup) return [];

  return [...new Set(
    (allProfiles || [])
      .filter((profile) => matchesMutualGroup(profile, matchedGroup))
      .map((profile) => normalizeSalesmanCode(profile.salesman_code))
      .filter(Boolean),
  )];
}
