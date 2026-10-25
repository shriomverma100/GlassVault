import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import Header from "./components/Header";
import FreezeFrame from "./components/FreezeFrame";
import { Toasts } from "./components/ui/kit";
import { AppProvider, useApp } from "./lib/store";

// Each page is its own chunk: D3, the QR scanner and the watchtower tools load only when opened.
const Explore = lazy(() => import("./pages/Explore"));
const Donate = lazy(() => import("./pages/Donate"));
const Passport = lazy(() => import("./pages/Passport"));
const Ngo = lazy(() => import("./pages/Ngo"));
const Vendor = lazy(() => import("./pages/Vendor"));
const Field = lazy(() => import("./pages/Field"));
const Watchtower = lazy(() => import("./pages/Watchtower"));

function Pages() {
  const location = useLocation();
  const { state, config } = useApp();
  if (!state || !config) {
    return <div className="grid h-[60vh] place-items-center text-[15px] text-ash">Connecting to the chain…</div>;
  }
  // No exit animation and no "wait" mode: the new page is on screen in the same frame as the click,
  // with a 120ms opacity fade (CSS, compositor-only) so the swap doesn't flash.
  return (
    <main key={location.pathname.split("/")[1]} className="page-enter mx-auto max-w-[1440px] px-8 pb-24">
      <Suspense fallback={<div className="h-[60vh]" />}>
        <Routes location={location}>
          <Route path="/" element={<Explore />} />
          <Route path="/donate" element={<Donate />} />
          <Route path="/passport" element={<Passport />} />
          <Route path="/passport/:lotId" element={<Passport />} />
          <Route path="/ngo" element={<Ngo />} />
          <Route path="/vendor" element={<Vendor />} />
          <Route path="/field" element={<Field />} />
          <Route path="/watchtower" element={<Watchtower />} />
        </Routes>
      </Suspense>
    </main>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <div className="min-h-screen">
          <Header />
          <Pages />
          <Toasts />
          <FreezeFrame />
        </div>
      </AppProvider>
    </BrowserRouter>
  );
}
