// One stroke icon set, 24×24, 1.6 px lines, drawn for pixvault.

const PATHS: Record<string, string> = {
  upload: "M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15",
  folder: "M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z",
  image: "M4.5 5h15a.5.5 0 0 1 .5.5v13a.5.5 0 0 1-.5.5h-15a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5zM4 16l4.5-4.5 3.5 3.5 2.5-2.5L20 18M15.5 9.5h.01",
  optimize: "M8 4v16M16 4v16M4 8h4M4 16h4M16 12h4M12 6v12",
  transform: "M7 3v14h14M3 7h14v14",
  adjust: "M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4",
  brand: "M12 3.5 14.4 8.4l5.4.8-3.9 3.8.9 5.4L12 15.9l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z",
  metadata: "M4 6.5h16M4 12h10M4 17.5h7M17 15v5M14.5 17.5h5",
  compose: "M4 4h7v9H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 15h7v5H4z",
  analyze: "M4 20V10M9.5 20V4M15 20v-7M20.5 20v-11",
  ai: "M5 19 15.5 8.5M14 4.5v3M12.5 6h3M18.5 9.5v3M17 11h3M8 4v2M7 5h2M17.5 14.5l2 2",
  download: "M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14",
  zip: "M6 3.5h9l3 3v14H6zM11 3.5v2M11 7.5v2M11 11.5v2M10 15.5h2v3h-2z",
  share: "M12 15V4M8 7.5 12 4l4 3.5M7 11H5.5v9h13v-9H17",
  check: "M5 12.5 10 17.5 19 7",
  x: "M6 6l12 12M18 6 6 18",
  plus: "M12 5v14M5 12h14",
  trash: "M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13M10.5 10.5v6M13.5 10.5v6",
  undo: "M9 7 4.5 11.5 9 16M5 11.5h9.5a5 5 0 0 1 0 10H12",
  back: "M15 5 8 12l7 7",
  next: "M9 5l7 7-7 7",
  search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5 20 20",
  shield: "M12 3.5 19 6v5.5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z",
  offline: "M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 4-2.6M19 13a10 10 0 0 0-2.2-1.6M12 20h.01M2 9a15 15 0 0 1 4.7-3M22 9a15 15 0 0 0-11-4",
  code: "M8.5 7 3.5 12l5 5M15.5 7l5 5-5 5M13.5 5l-3 14",
  pin: "M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  stop: "M6.5 6.5h11v11h-11z",
  layers: "M12 3.5 21 8.5l-9 5-9-5zM3 12.5l9 5 9-5M3 16.5l9 5 9-5",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.5h.01",
  copy: "M8.5 8.5h11v11h-11zM15.5 8.5v-4h-11v11h4",
  lang: "M4 5.5h9M8.5 3.5v2M6 5.5c.8 3.5 3.3 6.4 6.5 7.5M11 5.5c-.8 3.6-3.6 7-7 8.5M13 20.5l3.5-8.5 3.5 8.5M14.2 17.5h4.6",
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <path d={PATHS[name] ?? PATHS.image} />
    </svg>
  );
}
