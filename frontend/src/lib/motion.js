// One shared motion language so the whole app feels "watery" and consistent.
export const liquid = { type: "spring", stiffness: 170, damping: 26, mass: 0.9 };
export const snappy = { type: "spring", stiffness: 420, damping: 32 };
export const drift = { duration: 1.6, ease: [0.22, 1, 0.36, 1] };

export const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: liquid },
};

export const stagger = (gap = 0.06) => ({
  hidden: {},
  show: { transition: { staggerChildren: gap } },
});

// Self-drawing stroke for custom SVG icons and connectors.
export const draw = {
  hidden: { pathLength: 0, opacity: 0 },
  show: { pathLength: 1, opacity: 1, transition: drift },
};
