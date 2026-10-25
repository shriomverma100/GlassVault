import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import Header from "./components/Header";
import FreezeFrame from "./components/FreezeFrame";
import { Toasts } from "./components/ui/kit";
import { AppProvider, useApp } from "./lib/store";
import { useLenis } from "./lib/useLenis";
import { liquid } from "./lib/motion";
import Explore from "./pages/Explore";
import Donate from "./pages/Donate";
import Passport from "./pages/Passport";
import Ngo from "./pages/Ngo";
import Vendor from "./pages/Vendor";
import Field from "./pages/Field";
import Watchtower from "./pages/Watchtower";

function Pages() {
  const location = useLocation();
  const { state, config } = useApp();
  if (!state || !config) {
    return <div className="grid h-[60vh] place-items-center text-[14px] text-graphite">Connecting to the chain…</div>;
  }
  return (
    <AnimatePresence mode="wait">
      <motion.main
        key={location.pathname.split("/")[1]}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={liquid}
        className="mx-auto max-w-[1440px] px-8 pb-24"
      >
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
      </motion.main>
    </AnimatePresence>
  );
}

export default function App() {
  useLenis();
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
