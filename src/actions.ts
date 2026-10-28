// What can be done with the selected photos: a few quick actions first,
// then every catalog tool that fits the selection.

import { CATEGORIES, type Category, toolById, tools, type ToolDef } from "./tools/index.ts";
import type { Photo } from "./workspace.ts";

export const fits = (t: ToolDef, sel: Photo[]) => sel.length > 0 && (t.input === "image" || sel.length >= (t.min ?? 1));

const QUICK = ["compress", "convert", "resize", "crop", "strip", "remove-bg"];

export function quickActions(sel: Photo[]): ToolDef[] {
  const ids = [...QUICK];
  if (sel.length >= 2) ids.push("collage", "pdf");
  return ids.map((id) => toolById.get(id)!).filter((t) => fits(t, sel));
}

export function moreActions(sel: Photo[], quick: ToolDef[]): { id: Category; tools: ToolDef[] }[] {
  const shown = new Set(quick.map((t) => t.id));
  return CATEGORIES.map((c) => ({ id: c.id, tools: tools.filter((t) => t.category === c.id && !shown.has(t.id) && fits(t, sel)) })).filter((g) => g.tools.length);
}
