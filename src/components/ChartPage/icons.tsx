/** Line icons for the chart toolbars (24×24, currentColor, decorative). */
const P: Record<string, string> = {
  cursor: "M5 3l13 8-6 1.5L9 19z",
  "trend-line": "M4 19L20 5M4 19a1.5 1.5 0 1 0 0 .01M20 5a1.5 1.5 0 1 0 0 .01",
  ray: "M4 19L21 4M4 19a1.5 1.5 0 1 0 0 .01",
  "horizontal-line": "M3 12h18M12 12a1.5 1.5 0 1 0 0 .01",
  "vertical-line": "M12 3v18M12 12a1.5 1.5 0 1 0 0 .01",
  "parallel-channel": "M3 15L17 5M7 19L21 9",
  rectangle: "M4 6h16v12H4z",
  "fib-retracement": "M3 5h18M3 10h18M3 14h18M3 19h18M5 19L19 5",
  "price-range": "M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4M5 3h14M5 21h14",
  "long-position": "M4 12h16M4 4h16v8M4 12v8h16v-8",
  text: "M5 5h14M12 5v14M9 19h6",
  brush: "M4 18c3 0 3-4 6-4s4 3 6 0 2-6 4-8",
  magnet: "M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4z",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  "eye-off":
    "M3 3l18 18M10.6 5.1A10 10 0 0 1 22 12s-1.3 2.3-3.6 4.2M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7c1.6 0 3-.4 4.3-1",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  camera: "M4 8h4l2-3h4l2 3h4v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  fullscreen: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  candles: "M7 4v16M17 4v16M5 8h4v7H5zM15 6h4v9h-4z",
  hollow: "M7 4v16M17 4v16M5 8h4v7H5zM15 6h4v9h-4z",
  heikinAshi: "M7 3v18M17 3v18M5 7h4v9H5zM15 5h4v11h-4zM5 11h4M15 10h4",
  bars: "M7 4v16M4 8h3M7 15h3M17 4v16M14 7h3M17 13h3",
  line: "M3 17l5-6 4 3 5-8 4 5",
  area: "M3 17l5-6 4 3 5-8 4 5v8H3z",
  fx: "M10 4c-3 0-3 3-3 6v10M4 10h7M13 10l7 9M20 10l-7 9",
  star: "M12 3l2.7 5.6 6.2.9-4.5 4.4 1 6.1L12 17.1 6.6 20l1-6.1L3.1 9.5l6.2-.9z",
  chevron: "M6 9l6 6 6-6",
  close: "M6 6l12 12M18 6L6 18",
};

export function Icon({
  name,
  size = 18,
  filled = false,
}: {
  name: string;
  size?: number;
  filled?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={P[name] ?? ""} />
    </svg>
  );
}
