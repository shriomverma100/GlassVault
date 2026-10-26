import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import Header from "./components/Header";
import FreezeFrame from "./components/FreezeFrame";
import NextActions from "./components/NextActions";
import UnlockPrompt from "./components/UnlockPrompt";
import Tour from "./components/Tour";
import Drill from "./components/Drill";
import { Toasts } from "./components/ui/kit";
import { AppProvider, useApp } from "./lib/store";
import { HOME } from "./lib/wallet";

// Each page is its own chunk: D3, the QR scanner and the watchtower tools load only when opened.
const Explore = lazy(() => import("./pages/Explore"));
const Donate = lazy(() => import("./pages/Donate"));
const Passport = lazy(() => import("./pages/Passport"));
const Ngo = lazy(() => import("./pages/Ngo"));
const Vendor = lazy(() => import("./pages/Vendor"));
const Field = lazy(() => import("./pages/Field"));
const Watchtower = lazy(() => import("./pages/Watchtower"));
const Login = lazy(() => import("./pages/Login"));
const Signup = lazy(() => import("./pages/Signup"));
const Verify = lazy(() => import("./pages/Verify"));

function Pages() {
  const location = useLocation();
  const { state, config, user, authReady } = useApp("state", "config", "user", "authReady");
  if (!state || !config || !authReady) {
    return <div className="grid h-[60vh] place-items-center text-[15px] text-ash">Connecting to the chain…</div>;
  }
  const section = location.pathname.split("/")[1];
  const inOwnWorkspace = user && location.pathname.startsWith(HOME[user.kind]);
  // No exit animation and no "wait" mode: the new page is on screen in the same frame as the click,
  // with a short opacity fade (CSS, compositor-only) so the swap doesn't flash.
  return (
    <main key={section} className="page-enter mx-auto max-w-[1440px] px-8 pb-24">
      {inOwnWorkspace && <NextActions />}
      <Suspense fallback={<div className="h-[60vh]" />}>
        <Routes location={location}>
          <Route path="/" element={<Explore />} />
          <Route path="/login" element={user ? <Navigate to={HOME[user.kind]} replace /> : <Login />} />
          <Route path="/signup" element={user ? <Navigate to={HOME[user.kind]} replace /> : <Signup />} />
          <Route path="/home" element={<Navigate to={user ? HOME[user.kind] : "/login"} replace />} />
          <Route path="/donate" element={<Donate />} />
          <Route path="/passport" element={<Passport />} />
          <Route path="/passport/:lotId" element={<Passport />} />
          <Route path="/ngo" element={<Ngo />} />
          <Route path="/vendor" element={<Vendor />} />
          <Route path="/field" element={<Field />} />
          <Route path="/watchtower" element={<Watchtower />} />
          <Route path="/verify" element={<Verify />} />
          <Route path="*" element={<div className="grid h-[50vh] place-items-center text-[15px] text-ash">Page not found.</div>} />
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
          <UnlockPrompt />
          <Tour />
          <Drill />
        </div>
      </AppProvider>
    </BrowserRouter>
  );
}
