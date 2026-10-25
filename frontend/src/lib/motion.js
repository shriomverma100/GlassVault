// One shared motion language. Tuned for instant feedback: every preset settles in ≤ 200ms so motion
// never sits between the user and the result. Animate opacity/transform only (compositor-friendly).
export const liquid = { type: "spring", stiffness: 560, damping: 44, mass: 0.6 }; // sliding pills, layout — ~180ms
export const snappy = { type: "spring", stiffness: 900, damping: 50, mass: 0.5 }; // taps, toggles — ~120ms
export const drift = { duration: 0.45, ease: [0.22, 1, 0.36, 1] }; // self-drawing strokes only

export const fadeUp = {
  hidden: { opacity: 0, y: 4 },
  show: { opacity: 1, y: 0, transition: { duration: 0.16, ease: [0.2, 0, 0, 1] } },
};

export const stagger = (gap = 0.02) => ({
  hidden: {},
  show: { transition: { staggerChildren: gap } },
});

// Self-drawing stroke for custom SVG icons and connectors.
export const draw = {
  hidden: { pathLength: 0, opacity: 0 },
  show: { pathLength: 1, opacity: 1, transition: drift },
};
