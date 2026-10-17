"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import NewOrderPage from "../new-order/page";
import { useModuleAccess } from "../../hooks/useModuleAccess";
import { cataloguePageGate, rememberCatalogueReturn } from "../../lib/productCatalogue";

export default function ProductCataloguePage() {
  const router = useRouter();
  const { access, loading, signedIn } = useModuleAccess();
  const gate = cataloguePageGate({
    loading,
    signedIn,
    canView: access.canAccess("productCatalogue"),
  });

  useEffect(() => {
    if (gate !== "sign-in") return;
    rememberCatalogueReturn(window.sessionStorage);
    router.replace("/");
  }, [gate, router]);

  if (gate === "loading" || gate === "sign-in") {
    return <main className="modulePage"><div className="moduleLoading">Loading catalogue...</div></main>;
  }
  if (gate === "denied") {
    return <main className="modulePage"><div className="moduleHint" role="alert">Product catalogue access denied. / لا يمكنك الوصول إلى كتالوج المنتجات.</div></main>;
  }
  return <NewOrderPage />;
}
