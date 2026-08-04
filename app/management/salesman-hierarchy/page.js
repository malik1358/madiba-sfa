"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { getSupabaseClient } from "../../lib/supabase";

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeCredentialToken(value) {
  return normalizeCode(value)
    .replace(/[^A-Z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\.{2,}/g, ".");
}

function defaultPasswordFor(code) {
  return `MADIBA-${normalizeCredentialToken(code)}@123`;
}

export default function SalesmanHierarchyPage() {
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [resettingId, setResettingId] = useState("");
  const [bulkResetting, setBulkResetting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [salesmen, setSalesmen] = useState([]);
  const [headOptions, setHeadOptions] = useState([]);
  const [headSelections, setHeadSelections] = useState({});
  const [newSalesman, setNewSalesman] = useState({
    salesmanName: "",
    salesmanCode: "",
    email: "",
    headSalesmanCode: "",
  });

  async function loadHierarchy(showLoader = false) {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setLoading(false);
      return;
    }

    if (showLoader) {
      setLoading(true);
    }

    setError("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Please login again.");
      }

      const response = await fetch("/api/admin/salesmen-hierarchy", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Unable to load salesman hierarchy.");
      }

      setSalesmen(data.salesmen || []);
      setHeadOptions(data.headOptions || []);
      setHeadSelections(
        Object.fromEntries((data.salesmen || []).map((salesman) => [salesman.id, salesman.head_salesman_code || ""]))
      );
    } catch (err) {
      setError(err.message || "Unable to load salesman hierarchy.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHierarchy(true);
  }, []);

  const summary = useMemo(() => {
    const assigned = salesmen.filter((salesman) => Boolean(salesman.head_salesman_code)).length;
    const heads = new Set(salesmen.map((salesman) => salesman.head_salesman_code).filter(Boolean));

    return {
      total: salesmen.length,
      assigned,
      heads: heads.size,
    };
  }, [salesmen]);

  async function postAction(payload) {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setError("Supabase is not configured.");
      return false;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setError("Please login again.");
      return false;
    }

    const response = await fetch("/api/admin/salesmen-hierarchy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || "Unable to complete request.");
    }

    return data;
  }

  async function saveHeadAssignment(salesman) {
    setSavingId(salesman.id);
    setError("");
    setMessage("");

    try {
      const result = await postAction({
        mode: "assign-head",
        salesmanId: salesman.id,
        headSalesmanCode: headSelections[salesman.id] || "",
      });

      setMessage(result.message || "Head salesman saved.");
      await loadHierarchy(false);
    } catch (err) {
      setError(err.message || "Unable to save assignment.");
    } finally {
      setSavingId("");
    }
  }

  async function resetPassword(salesman) {
    setResettingId(salesman.id);
    setError("");
    setMessage("");

    try {
      const password = defaultPasswordFor(salesman.salesman_code || salesman.id);
      const result = await postAction({
        mode: "reset-password",
        salesmanId: salesman.id,
        password,
      });

      setMessage(`${result.message || "Password reset."} Default password: ${password}`);
    } catch (err) {
      setError(err.message || "Unable to reset password.");
    } finally {
      setResettingId("");
    }
  }

  async function createSalesman(event) {
    event.preventDefault();
    setCreating(true);
    setError("");
    setMessage("");

    try {
      const result = await postAction({
        mode: "create-salesman",
        salesmanName: newSalesman.salesmanName,
        salesmanCode: normalizeCode(newSalesman.salesmanCode),
        email: String(newSalesman.email || "").trim().toLowerCase(),
        headSalesmanCode: normalizeCode(newSalesman.headSalesmanCode || ""),
      });

      const created = result.created || {};
      setMessage(
        `${result.message || "Salesman created."} Login: ${created.email || "-"} | Default password: ${created.password || "-"}`
      );
      setNewSalesman({ salesmanName: "", salesmanCode: "", email: "", headSalesmanCode: "" });
      await loadHierarchy(false);
    } catch (err) {
      setError(err.message || "Unable to create salesman.");
    } finally {
      setCreating(false);
    }
  }

  async function resetAllPasswords() {
    setBulkResetting(true);
    setError("");
    setMessage("");

    try {
      const result = await postAction({ mode: "reset-all-passwords" });
      setMessage(result.message || "Default passwords reset for all salesmen.");
    } catch (err) {
      setError(err.message || "Unable to reset all passwords.");
    } finally {
      setBulkResetting(false);
    }
  }

  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Salesman hierarchy unavailable"
        message="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to manage salesman hierarchy and default credentials."
      />
    );
  }

  if (loading) {
    return (
      <main className="modulePage">
        <div className="moduleShell">
          <div className="moduleLoading">Loading salesman hierarchy...</div>
        </div>
      </main>
    );
  }

  return (
    <main className="modulePage">
      <div className="moduleShell">
        <div className="moduleHeader">
          <div>
            <p className="moduleEyebrow">MADIBA SFA</p>
            <h1>Salesman Hierarchy</h1>
            <p className="moduleSubtitle">Assign salesmen under a head salesman and manage default testing passwords</p>
          </div>
          <Link href="/management" className="moduleBackLink">← Management</Link>
        </div>

        {error && <div className="moduleError">{error}</div>}
        {message && <div className="moduleSuccess">{message}</div>}

        <div className="moduleMetricGrid">
          <section className="moduleMetricCard"><span>Total salesmen</span><strong>{summary.total}</strong></section>
          <section className="moduleMetricCard"><span>Assigned under head</span><strong>{summary.assigned}</strong></section>
          <section className="moduleMetricCard"><span>Head salesmen in use</span><strong>{summary.heads}</strong></section>
        </div>

        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>Create Salesman</h2>
            <span>Creates login and profile in one step</span>
          </div>

          <form className="moduleFormGrid" onSubmit={createSalesman}>
            <label>
              Salesman Name
              <input
                className="moduleInput"
                required
                value={newSalesman.salesmanName}
                onChange={(event) => setNewSalesman((current) => ({ ...current, salesmanName: event.target.value }))}
                placeholder="Ali Khan"
              />
            </label>

            <label>
              Salesman Code
              <input
                className="moduleInput"
                required
                value={newSalesman.salesmanCode}
                onChange={(event) => setNewSalesman((current) => ({ ...current, salesmanCode: normalizeCode(event.target.value) }))}
                placeholder="S001"
              />
            </label>

            <label>
              Email/Login
              <input
                className="moduleInput"
                required
                type="email"
                value={newSalesman.email}
                onChange={(event) => setNewSalesman((current) => ({ ...current, email: event.target.value }))}
                placeholder="salesman@company.com"
              />
            </label>

            <label>
              Assign Head Salesman
              <select
                className="moduleInput"
                value={newSalesman.headSalesmanCode}
                onChange={(event) => setNewSalesman((current) => ({ ...current, headSalesmanCode: event.target.value }))}
              >
                <option value="">No head</option>
                {headOptions.map((option) => (
                  <option key={`new-${option.id}`} value={option.salesman_code || ""}>
                    {option.salesman_name || option.salesman_code} {option.salesman_code ? `(${option.salesman_code})` : ""}
                  </option>
                ))}
              </select>
            </label>

            <div className="moduleFieldFull">
              <button className="modulePrimaryButton" type="submit" disabled={creating}>
                {creating ? "Creating..." : "Create Salesman"}
              </button>
            </div>
          </form>
        </section>

        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>Hierarchy Assignment</h2>
            <button type="button" className="moduleInlineButton" onClick={resetAllPasswords} disabled={bulkResetting}>
              {bulkResetting ? "Resetting..." : "Reset All Passwords"}
            </button>
          </div>

          <div className="moduleTableWrap">
            <table className="moduleTable">
              <thead>
                <tr>
                  <th>Salesman</th>
                  <th>Login</th>
                  <th>Current Head</th>
                  <th>Assign Head</th>
                  <th>Default Password</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {salesmen.map((salesman) => {
                  const currentHead = headOptions.find((option) => option.salesman_code === salesman.head_salesman_code);

                  return (
                    <tr key={salesman.id}>
                      <td>
                        <strong>{salesman.salesman_name || salesman.salesman_code || salesman.id}</strong>
                        <div className="moduleCode">{salesman.salesman_code || salesman.id}</div>
                      </td>
                      <td>{salesman.email || "No email"}</td>
                      <td>{currentHead ? `${currentHead.salesman_name || currentHead.salesman_code} (${currentHead.salesman_code})` : "-"}</td>
                      <td>
                        <select
                          className="moduleInput"
                          value={headSelections[salesman.id] || ""}
                          onChange={(event) => setHeadSelections((current) => ({ ...current, [salesman.id]: event.target.value }))}
                        >
                          <option value="">No head</option>
                          {headOptions
                            .filter((option) => option.id !== salesman.id)
                            .map((option) => (
                              <option key={`${salesman.id}-${option.id}`} value={option.salesman_code || ""}>
                                {option.salesman_name || option.salesman_code} {option.salesman_code ? `(${option.salesman_code})` : ""}
                              </option>
                            ))}
                        </select>
                      </td>
                      <td>{defaultPasswordFor(salesman.salesman_code || salesman.id)}</td>
                      <td>
                        <div className="moduleActionRow">
                          <button
                            type="button"
                            className="moduleInlineButton"
                            onClick={() => saveHeadAssignment(salesman)}
                            disabled={savingId === salesman.id}
                          >
                            {savingId === salesman.id ? "Saving..." : "Save"}
                          </button>
                          <button
                            type="button"
                            className="moduleInlineButton"
                            onClick={() => resetPassword(salesman)}
                            disabled={resettingId === salesman.id}
                          >
                            {resettingId === salesman.id ? "Resetting..." : "Reset Password"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {salesmen.length === 0 && (
                  <tr>
                    <td colSpan={6}>No salesmen found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>Testing Notes</h2>
          </div>
          <div className="moduleHint">
            Login uses the email shown in the table. Default testing password is <strong> MADIBA-[SALESMAN CODE]@123 </strong>. Example: if the salesman code is A001, the password is MADIBA-A001@123.
          </div>
        </section>
      </div>
    </main>
  );
}