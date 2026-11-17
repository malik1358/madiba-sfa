/**
 * Power BI REST helpers: Entra client-credentials token, executeQueries, export fallback.
 */

const POWER_BI_SCOPE = "https://analysis.windows.net/powerbi/api/.default";
const TOKEN_URL_BASE = "https://login.microsoftonline.com";
const API_BASE = "https://api.powerbi.com/v1.0/myorg";

const DEFAULT_ITEM_MASTER_DAX = `EVALUATE
SUMMARIZECOLUMNS(
  'Item Master (Google Sheet)'[Import or Local],
  'Item Master (Google Sheet)'[Main Group],
  'Item Master (Google Sheet)'[Sub Group],
  'Item Master (Google Sheet)'[Category],
  'mst_stock_item'[Item Code],
  'mst_stock_item'[item_name],
  'Item Master (Google Sheet)'[Article No],
  'Item Master (Google Sheet)'[Article Common Name],
  'Item Master (Google Sheet)'[Brand Name],
  'mst_stock_item'[uom],
  'mst_stock_item'[alternate_uom],
  "ALT_UOM_CONV", CALCULATE(SUM('mst_stock_item'[ALT_UOM_CONV]))
)`;

function trimEnv(value) {
  return String(value || "").trim();
}

export function getPowerBiConfig(env = process.env) {
  return {
    tenantId: trimEnv(env.POWERBI_TENANT_ID),
    clientId: trimEnv(env.POWERBI_CLIENT_ID),
    clientSecret: trimEnv(env.POWERBI_CLIENT_SECRET),
    workspaceId: trimEnv(env.POWERBI_WORKSPACE_ID),
    datasetId: trimEnv(env.POWERBI_DATASET_ID),
    reportId: trimEnv(env.POWERBI_REPORT_ID) || "c7c58c6d-d5db-495c-8698-4b08eae90c51",
    daxQuery: trimEnv(env.POWERBI_ITEM_MASTER_DAX) || DEFAULT_ITEM_MASTER_DAX,
  };
}

export function assertPowerBiConfig(config = getPowerBiConfig()) {
  const missing = [];
  if (!config.tenantId) missing.push("POWERBI_TENANT_ID");
  if (!config.clientId) missing.push("POWERBI_CLIENT_ID");
  if (!config.clientSecret) missing.push("POWERBI_CLIENT_SECRET");
  if (!config.workspaceId) missing.push("POWERBI_WORKSPACE_ID");
  if (!config.datasetId) missing.push("POWERBI_DATASET_ID");
  if (missing.length) {
    throw new Error(`Power BI is not configured. Missing: ${missing.join(", ")}`);
  }
  return config;
}

export async function fetchPowerBiAccessToken(config = getPowerBiConfig(), fetchImpl = fetch) {
  const cfg = assertPowerBiConfig(config);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: POWER_BI_SCOPE,
  });
  const response = await fetchImpl(
    `${TOKEN_URL_BASE}/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const detail = payload.error_description || payload.error || response.statusText;
    throw new Error(`Power BI token failed: ${detail}`);
  }
  return String(payload.access_token);
}

function flattenExecuteQueriesRows(payload) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const rows = [];
  for (const result of results) {
    const tables = Array.isArray(result?.tables) ? result.tables : [];
    for (const table of tables) {
      const tableRows = Array.isArray(table?.rows) ? table.rows : [];
      for (const row of tableRows) {
        if (row && typeof row === "object") rows.push(row);
      }
    }
  }
  return rows;
}

export async function executePowerBiDaxQuery({
  config = getPowerBiConfig(),
  accessToken,
  daxQuery,
  fetchImpl = fetch,
} = {}) {
  const cfg = assertPowerBiConfig(config);
  const query = String(daxQuery || cfg.daxQuery || "").trim();
  if (!query) throw new Error("Power BI DAX query is empty.");
  if (!accessToken) throw new Error("Power BI access token is required.");

  const url = `${API_BASE}/groups/${encodeURIComponent(cfg.workspaceId)}/datasets/${encodeURIComponent(cfg.datasetId)}/executeQueries`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      queries: [{ query }],
      serializerSettings: { includeNulls: true },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload.error?.message || payload.message || response.statusText;
    throw new Error(`Power BI executeQueries failed (${response.status}): ${detail}`);
  }
  return {
    source: "executeQueries",
    rows: flattenExecuteQueriesRows(payload),
    raw: payload,
  };
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function exportPowerBiReportFile({
  config = getPowerBiConfig(),
  accessToken,
  format = "XLSX",
  fetchImpl = fetch,
  pollMs = 2000,
  maxPolls = 60,
} = {}) {
  const cfg = assertPowerBiConfig(config);
  if (!accessToken) throw new Error("Power BI access token is required.");
  if (!cfg.reportId) throw new Error("POWERBI_REPORT_ID is required for export fallback.");

  const startUrl = `${API_BASE}/groups/${encodeURIComponent(cfg.workspaceId)}/reports/${encodeURIComponent(cfg.reportId)}/ExportTo`;
  const startResponse = await fetchImpl(startUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ format }),
  });
  const startPayload = await startResponse.json().catch(() => ({}));
  if (!startResponse.ok || !startPayload.id) {
    const detail = startPayload.error?.message || startPayload.message || startResponse.statusText;
    throw new Error(`Power BI ExportTo failed (${startResponse.status}): ${detail}`);
  }

  const exportId = String(startPayload.id);
  let statusPayload = startPayload;
  for (let i = 0; i < maxPolls; i += 1) {
    const status = String(statusPayload.status || "").toLowerCase();
    if (status === "succeeded") break;
    if (status === "failed") {
      throw new Error(`Power BI export failed: ${statusPayload.error?.message || "unknown error"}`);
    }
    await sleep(pollMs);
    const statusUrl = `${API_BASE}/groups/${encodeURIComponent(cfg.workspaceId)}/reports/${encodeURIComponent(cfg.reportId)}/exports/${encodeURIComponent(exportId)}`;
    const statusResponse = await fetchImpl(statusUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    statusPayload = await statusResponse.json().catch(() => ({}));
    if (!statusResponse.ok) {
      const detail = statusPayload.error?.message || statusPayload.message || statusResponse.statusText;
      throw new Error(`Power BI export status failed (${statusResponse.status}): ${detail}`);
    }
  }

  if (String(statusPayload.status || "").toLowerCase() !== "succeeded") {
    throw new Error("Power BI export timed out before Succeeded.");
  }

  const fileUrl = `${API_BASE}/groups/${encodeURIComponent(cfg.workspaceId)}/reports/${encodeURIComponent(cfg.reportId)}/exports/${encodeURIComponent(exportId)}/file`;
  const fileResponse = await fetchImpl(fileUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!fileResponse.ok) {
    throw new Error(`Power BI export file download failed (${fileResponse.status}).`);
  }
  const buffer = Buffer.from(await fileResponse.arrayBuffer());
  return { source: "export", format, buffer, exportId };
}

/**
 * Prefer executeQueries; on capacity/XMLA-style failures fall back to report XLSX export.
 */
export async function fetchItemMasterAnalysisFromPowerBi({
  config = getPowerBiConfig(),
  fetchImpl = fetch,
  parseExportWorkbook,
} = {}) {
  const cfg = assertPowerBiConfig(config);
  const accessToken = await fetchPowerBiAccessToken(cfg, fetchImpl);

  try {
    const queried = await executePowerBiDaxQuery({
      config: cfg,
      accessToken,
      daxQuery: cfg.daxQuery,
      fetchImpl,
    });
    return queried;
  } catch (error) {
    const message = String(error?.message || error || "");
    const canFallback = /executeQueries|Premium|XMLA|capacity|403|404|400/i.test(message);
    if (!canFallback || typeof parseExportWorkbook !== "function") {
      throw error;
    }
    const exported = await exportPowerBiReportFile({
      config: cfg,
      accessToken,
      fetchImpl,
    });
    const rows = parseExportWorkbook(exported.buffer);
    return {
      source: "export",
      rows: Array.isArray(rows) ? rows : [],
      exportId: exported.exportId,
    };
  }
}

export { DEFAULT_ITEM_MASTER_DAX, flattenExecuteQueriesRows };
