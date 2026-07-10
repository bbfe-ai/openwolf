// Phase-2 structured descriptions for TS / JS / React / Next.js.
// Returns the description string, or null to fall through.
// Extracted from extractDescription (OPT-33 step 3c).
import { capDescription as cap } from "./cap.js";

// .ts/.tsx/.js/.jsx/.mjs/.cjs — React / Next.js / Express / tRPC / Zod / exports
export function extractTsJs(content: string, basename: string, ext: string): string | null {
  // React component
  if (ext === ".tsx" || ext === ".jsx") {
    const comp = content.match(/(?:export\s+(?:default\s+)?)?(?:function|const)\s+(\w+)/);
    const parts: string[] = [];
    if (comp) parts.push(comp[1]);
    const renders: string[] = [];
    if (/<(?:form|Form)/i.test(content)) renders.push("form");
    if (/<(?:table|Table|DataTable)/i.test(content)) renders.push("table");
    if (/<(?:dialog|Dialog|Modal|Drawer)/i.test(content)) renders.push("modal");
    if (renders.length) parts.push(`renders ${renders.join(", ")}`);
    if (parts.length) return cap(parts.join(" — "));
  }

  // Next.js conventions
  if (basename === "page.tsx" || basename === "page.js") return "Next.js page component";
  if (basename === "layout.tsx" || basename === "layout.js") return "Next.js layout";
  if (basename === "route.ts" || basename === "route.js") {
    const methods = [...new Set((content.match(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)/g) || [])
      .map(m => m.match(/(GET|POST|PUT|PATCH|DELETE)/)?.[1]))].filter(Boolean);
    return methods.length ? `Next.js API route: ${methods.join(", ")}` : "Next.js API route";
  }

  // Express/Fastify routes
  const routeHits = content.match(/\.(get|post|put|patch|delete)\s*\(\s*['"`]/g);
  if (routeHits && routeHits.length > 0) {
    const methods = [...new Set(routeHits.map(r => r.match(/\.(get|post|put|patch|delete)/)?.[1]?.toUpperCase()))];
    return cap(`API routes: ${methods.join(", ")} (${routeHits.length} endpoints)`);
  }

  // tRPC router
  if (content.includes("createTRPCRouter") || content.includes("publicProcedure")) {
    const procs = (content.match(/\.(query|mutation|subscription)\s*\(/g) || []).length;
    return procs ? `tRPC router: ${procs} procedures` : "tRPC router";
  }

  // Zod schemas
  if (content.includes("z.object") || content.includes("z.string")) {
    const schemas = (content.match(/(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*z\./g) || [])
      .map(s => s.match(/(?:const|let)\s+(\w+)/)?.[1]).filter(Boolean);
    if (schemas.length) return cap(`Zod schemas: ${schemas.slice(0, 4).join(", ")}${schemas.length > 4 ? ` + ${schemas.length - 4} more` : ""}`);
  }

  // Exports summary
  const exports = (content.match(/export\s+(?:async\s+)?(?:function|class|const|interface|type|enum)\s+(\w+)/g) || [])
    .map(e => e.match(/(\w+)$/)?.[1]).filter(Boolean) as string[];
  if (exports.length > 0 && exports.length <= 5) return `Exports ${exports.join(", ")}`;
  if (exports.length > 5) return cap(`Exports ${exports.slice(0, 4).join(", ")} + ${exports.length - 4} more`);
  return null;
}
