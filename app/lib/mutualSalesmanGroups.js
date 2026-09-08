export const MUTUAL_SALESMAN_GROUPS = [["JUNAID", "PARVEZ", "SOYEB"]];

// One-way: the viewer can see the source salesman's customers, not the reverse.
export const SHARED_CUSTOMER_BOOKS = [
  {
    source: ["AHMED NABIL", "AHMED.NABIL"],
    viewers: [
      "ABDALLA",
      "ABADALLA",
      "ABDALLA ANTHANATH",
      "ABADALLA ANTHANATH",
      "ABDALLA.ANTHANATH",
      "ABADALLA.ANTHANATH",
    ],
  },
  // One-way: Moinudin Khaja and Junaid see Mohammed Mubeen's customers on
  // My Day, Collection, Visit without order, and New order (via sales-scope).
  {
    source: [
      "MOHAMMED MUBEEN",
      "MOHAMMAD MUBEEN",
      "MOHAMMED.MUBEEN",
      "MOHAMMAD.MUBEEN",
      "MUBEEN",
    ],
    viewers: [
      "MOINUDIN",
      "MOINUDIN KHAJA",
      "MOINUDIN.KHAJA",
      "JUNAID",
    ],
  },
];

export function normalizeSalesmanName(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function normalizeSalesmanCode(value) {
  return String(value || "").trim().toUpperCase();
}

export function isSoyebProfile(profile) {
  const tokens = new Set([
    ...comparableSalesmanName(profile?.salesman_name).split(/\s+/).filter(Boolean),
    ...comparableSalesmanName(profile?.salesman_code).split(/\s+/).filter(Boolean),
  ]);
  return tokens.has("SOYEB");
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
  const keys = [
    ...profileGroupKeys(profile),
    ...nameTokens(profile?.salesman_name),
    ...nameTokens(profile?.salesman_code),
  ];
  return keys.some((key) => group.includes(key));
}

function normalizeShareIdentity(value) {
  return normalizeSalesmanName(value).replace(/[._-]+/g, " ").trim();
}

function profileShareIdentities(profile) {
  const emailLocal = String(profile?.email || "").trim().toLowerCase().split("@")[0] || "";
  return [...new Set([
    ...profileGroupKeys(profile),
    normalizeShareIdentity(profile?.salesman_code),
    normalizeShareIdentity(profile?.salesman_name),
    normalizeShareIdentity(emailLocal),
    normalizeSalesmanCode(emailLocal),
  ].map(normalizeShareIdentity).filter(Boolean))];
}

function matchesShareIdentities(profile, identities) {
  const wanted = new Set((identities || []).map(normalizeShareIdentity).filter(Boolean));
  if (wanted.size === 0) return false;
  return profileShareIdentities(profile).some((key) => wanted.has(key));
}

export function resolveSharedBookProfiles(allProfiles, currentProfile) {
  const shared = [];
  const seenIds = new Set();

  (SHARED_CUSTOMER_BOOKS || []).forEach((book) => {
    if (!matchesShareIdentities(currentProfile, book.viewers)) return;

    (allProfiles || []).forEach((profile) => {
      if (!matchesShareIdentities(profile, book.source)) return;
      if (profile?.id) {
        if (seenIds.has(profile.id)) return;
        seenIds.add(profile.id);
      }
      shared.push(profile);
    });
  });

  return shared;
}

export function salesmanScopeIdentities(profile) {
  return [...new Set(profileGroupKeys(profile))];
}

export function resolveMutualGroupProfiles(allProfiles, currentProfile) {
  const matchedGroup = MUTUAL_SALESMAN_GROUPS.find((group) => matchesMutualGroup(currentProfile, group));
  if (!matchedGroup) return [];

  return (allProfiles || []).filter((profile) => matchesMutualGroup(profile, matchedGroup));
}

export function mergeMutualGroupProfiles(members, allProfiles, currentProfile) {
  const merged = [...(members || [])];
  const seenIds = new Set(merged.map((row) => row?.id).filter(Boolean));

  [
    ...resolveMutualGroupProfiles(allProfiles, currentProfile),
    ...resolveSharedBookProfiles(allProfiles, currentProfile),
  ].forEach((profile) => {
    if (profile?.id && seenIds.has(profile.id)) return;
    if (profile?.id) seenIds.add(profile.id);
    merged.push(profile);
  });

  return merged;
}

export function resolveMutualGroupCodes(allProfiles, currentProfile) {
  return [...new Set(
    resolveMutualGroupProfiles(allProfiles, currentProfile)
      .map((profile) => normalizeSalesmanCode(profile.salesman_code))
      .filter(Boolean),
  )];
}

export function expandMutualGroupScopeIdentities(allProfiles, currentProfile) {
  return [...new Set(
    [
      ...resolveMutualGroupProfiles(allProfiles, currentProfile),
      ...resolveSharedBookProfiles(allProfiles, currentProfile),
    ].flatMap((profile) => salesmanScopeIdentities(profile)),
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
