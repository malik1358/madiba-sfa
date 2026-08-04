export function isMissingRelationError(error) {
  if (!error) return false;

  const code = String(error.code || "").toUpperCase();
  const message = String(error.message || "");

  return (
    code === "42P01" ||
    code === "PGRST204" ||
    /relation\s+.+\s+does\s+not\s+exist/i.test(message) ||
    /could\s+not\s+find\s+the\s+table\s+.+\s+in\s+the\s+schema\s+cache/i.test(message)
  );
}

export async function detectTable(supabase, tableName) {
  const { error } = await supabase.from(tableName).select("*").limit(1);

  if (!error) {
    return {
      available: true,
      reason: "",
    };
  }

  if (isMissingRelationError(error)) {
    return {
      available: false,
      reason: `Missing table: ${tableName}`,
    };
  }

  return {
    available: false,
    reason: error.message || `Unable to access table: ${tableName}`,
  };
}
