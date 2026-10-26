import { useState } from "react";

/// Click ripple from the pointer position (CSS-only animation; removed when it ends).
export function useRipples(color) {
  const [list, setList] = useState([]);
  return {
    add(e) {
      const r = e.currentTarget.getBoundingClientRect();
      const size = Math.max(r.width, r.height) * 2.2;
      setList((xs) => [...xs.slice(-3), { id: performance.now(), x: e.clientX - r.left, y: e.clientY - r.top, size }]);
    },
    nodes: list.map((p) => (
      <span
        key={p.id}
        aria-hidden="true"
        className="ripple opacity-0"
        style={{ left: p.x, top: p.y, width: p.size, height: p.size, color }}
        onAnimationEnd={() => setList((xs) => xs.filter((x) => x.id !== p.id))}
      />
    )),
  };
}
