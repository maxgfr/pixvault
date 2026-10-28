// The single list of tools. The interface reads titles, fields and
// categories from here; the worker looks implementations up by id.

import { adjustTools } from "./adjust.ts";
import { aiTools } from "./ai.ts";
import { analyzeTools } from "./analyze.ts";
import { brandTools } from "./brand.ts";
import { composeTools } from "./compose.ts";
import { metadataTools } from "./metadata.ts";
import { optimizeTools } from "./optimize.ts";
import { transformTools } from "./transform.ts";
import type { ToolDef } from "./types.ts";

export * from "./types.ts";

export const tools: ToolDef[] = [...optimizeTools, ...transformTools, ...adjustTools, ...brandTools, ...metadataTools, ...composeTools, ...analyzeTools, ...aiTools];

export const toolById = new Map(tools.map((t) => [t.id, t]));
