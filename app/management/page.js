"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "../lib/supabase";
import SupabaseUnavailable from "../components/SupabaseUnavailable";

export default function ManagementPage() {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [stats, setStats] = useState({
    totalCustomers: 0,
    totalSalesmen: 0,
    pendingOrders: 0,
    submittedOrders: 0,
  });
  const router = useRouter();

  const supabaseClient = getSupabaseClient();

  useEffect(() => {
    async function loadData() {
      try {
        const supabase = getSupabaseClient();
        if (!supabase) {
          setLoading(false);
          return;
        }

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setLoading(false);
          return;
        }

        // Load profile
        const { data: profileData } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", session.user.id)
          .single();

        if (profileData) {
          setProfile(profileData);
        }

        // Load statistics
        const { count: customerCount } = await supabase
          .from("customers")
          .select("*", { count: "exact", head: true });

        const { count: salesmenCount } = await supabase
          .from("salesmen")
          .select("*", { count: "exact", head: true });

        const { count: draftCount } = await supabase
          .from("sales_orders")
          .select("*", { count: "exact", head: true })
          .eq("status", "DRAFT");

        const { count: submittedCount } = await supabase
          .from("sales_orders")
          .select("*", { count: "exact", head: true })
          .eq("status", "SUBMITTED");

        setStats({
          totalCustomers: customerCount || 0,
          totalSalesmen: salesmenCount || 0,
          pendingOrders: draftCount || 0,
          submittedOrders: submittedCount || 0,
        });

        setLoading(false);
      } catch (err) {
        console.error(err);
        setLoading(false);
      }
    }

    loadData();
  }, []);

  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Management unavailable"
        message="The management panel requires Supabase credentials to access system data."
      />
    );
  }

  if (loading) {
    return (
      <main className="auditPage">
        <div className="auditShell">
          <div className="auditBrand">MADIBA SFA</div>
          <h1>Management</h1>
          <p className="auditSubtitle">Loading...</p>
        </div>
      </main>
    );
  }

  const managementSections = [
    {
      icon: "👥",
      title: "Customers",
      description: "Manage customer database",
      href: "/management/customers",
      stats: `${stats.totalCustomers} total`,
    },
    {
      icon: "📊",
      title: "Orders",
      description: "View all submitted orders",
      href: "/management/orders",
      stats: `${stats.submittedOrders} submitted`,
    },
    {
      icon: "📝",
      title: "Draft Orders",
      description: "Manage pending draft orders",
      href: "/management/drafts",
      stats: `${stats.pendingOrders} drafts`,
    },
    {
      icon: "👔",
      title: "Salesmen",
      description: "Manage sales team members",
      href: "/management/salesmen",
      stats: `${stats.totalSalesmen} active`,
    },
    {
      icon: "📥",
      title: "Imports",
      description: "Upload sales data files",
      href: "/management/upload",
      stats: "Data management",
    },
    {
      icon: "📈",
      title: "Reports",
      description: "System reports and analytics",
      href: "/management/reports",
      stats: "In development",
    },
    {
      icon: "⚙️",
      title: "Settings",
      description: "System configuration",
      href: "/management/settings",
      stats: "Admin only",
    },
    {
      icon: "🔍",
      title: "System Health",
      description: "System status and diagnostics",
      href: "/management/health",
      stats: "Monitoring",
    },
  ];

  return (
    <main className="auditPage">
      <div className="auditShell">
        <div className="auditTop">
          <div>
            <div className="auditBrand">MADIBA SFA</div>
            <h1>Management Panel</h1>
            <p className="auditSubtitle">Admin dashboard and system management</p>
          </div>
          <a href="/" className="auditHomeButton">
            ← Dashboard
          </a>
        </div>

        <section className="auditSection">
          <h3 className="auditSectionTitle">Quick Stats</h3>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: "12px",
            }}
          >
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #d1dde0",
                borderRadius: "10px",
                padding: "14px",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: "28px", fontWeight: 800, color: "#0b5364" }}>
                {stats.totalCustomers}
              </div>
              <div style={{ fontSize: "11px", color: "#6c838a", marginTop: "4px" }}>
                Customers
              </div>
            </div>

            <div
              style={{
                background: "#ffffff",
                border: "1px solid #d1dde0",
                borderRadius: "10px",
                padding: "14px",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: "28px", fontWeight: 800, color: "#0b5364" }}>
                {stats.submittedOrders}
              </div>
              <div style={{ fontSize: "11px", color: "#6c838a", marginTop: "4px" }}>
                Orders
              </div>
            </div>

            <div
              style={{
                background: "#ffffff",
                border: "1px solid #d1dde0",
                borderRadius: "10px",
                padding: "14px",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: "28px", fontWeight: 800, color: "#0b5364" }}>
                {stats.pendingOrders}
              </div>
              <div style={{ fontSize: "11px", color: "#6c838a", marginTop: "4px" }}>
                Draft Orders
              </div>
            </div>

            <div
              style={{
                background: "#ffffff",
                border: "1px solid #d1dde0",
                borderRadius: "10px",
                padding: "14px",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: "28px", fontWeight: 800, color: "#0b5364" }}>
                {stats.totalSalesmen}
              </div>
              <div style={{ fontSize: "11px", color: "#6c838a", marginTop: "4px" }}>
                Salesmen
              </div>
            </div>
          </div>
        </section>

        <section className="auditSection">
          <h3 className="auditSectionTitle">Management Modules</h3>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: "14px",
            }}
          >
            {managementSections.map((section) => (
              <button
                key={section.title}
                type="button"
                onClick={() => router.push(section.href)}
                style={{
                  background: "#ffffff",
                  border: "1px solid #d1dde0",
                  borderRadius: "12px",
                  padding: "16px",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  textAlign: "left",
                  fontSize: "inherit",
                  textTransform: "none",
                  minHeight: "120px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "#0b5364";
                  e.currentTarget.style.boxShadow =
                    "0 4px 12px rgba(11, 83, 100, 0.1)";
                  e.currentTarget.style.transform = "translateY(-2px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "#d1dde0";
                  e.currentTarget.style.boxShadow = "none";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                <div style={{ fontSize: "28px" }}>{section.icon}</div>
                <div style={{ fontWeight: 800, color: "#073f4c", fontSize: "14px" }}>
                  {section.title}
                </div>
                <div style={{ color: "#6c838a", fontSize: "11px" }}>
                  {section.description}
                </div>
                <div
                  style={{
                    marginTop: "auto",
                    fontSize: "11px",
                    color: "#0b5364",
                    fontWeight: 700,
                  }}
                >
                  {section.stats}
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
