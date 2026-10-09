"use client";

import NewOrderPage from "../new-order/page";
import { useModuleAccess } from "../../hooks/useModuleAccess";

export default function ProductCataloguePage() {
  const { access, loading } = useModuleAccess();
  if (loading) return <main className="modulePage"><div className="moduleLoading">Loading catalogue...</div></main>;
  if (!access.canAccess("productCatalogue")) {
    return <main className="modulePage"><div className="moduleHint" role="alert">Product catalogue access denied. / لا يمكنك الوصول إلى كتالوج المنتجات.</div></main>;
  }
  return <NewOrderPage />;
}
