// Phase-2 structured descriptions for systems-language families.
// Each extractor returns the description string, or null to fall through.
// Extracted from extractDescription (OPT-33 step 3b).
import { capDescription as cap } from "./cap.js";

// .py — Django / FastAPI / Pydantic / Celery / generic
export function extractPython(content: string): string | null {
  if (content.includes("models.Model")) {
    const cls = content.match(/class\s+(\w+)\(.*models\.Model\)/);
    const fields = (content.match(/^\s+\w+\s*=\s*models\.\w+/gm) || []).length;
    return cap(`Model: ${cls?.[1] || "unknown"}, ${fields} fields`);
  }
  if (content.includes("@router.") || content.includes("@app.")) {
    const routes = (content.match(/@(?:router|app)\.(get|post|put|patch|delete)\s*\(/g) || []);
    return cap(routes.length ? `API: ${routes.length} endpoints` : "API router");
  }
  if (content.includes("BaseModel") && content.includes("Field(")) {
    const cls = content.match(/class\s+(\w+)\(.*BaseModel\)/);
    return cls ? `Pydantic: ${cls[1]}` : "Pydantic model";
  }
  if (content.includes("@shared_task") || content.includes("@app.task")) {
    const tasks = (content.match(/def\s+(\w+)/g) || []).map(m => m.match(/def\s+(\w+)/)?.[1]).filter(n => n && !n.startsWith("_")) as string[];
    return cap(tasks.length ? `Celery tasks: ${tasks.join(", ")}` : "Celery task");
  }
  const pyClass = content.match(/class\s+(\w+)/);
  const funcs = (content.match(/def\s+(\w+)/g) || []).map(f => f.match(/def\s+(\w+)/)?.[1]).filter(n => n && !n.startsWith("_")) as string[];
  if (pyClass && funcs.length > 0) return cap(funcs.length > 4 ? `${pyClass[1]}: ${funcs.slice(0, 4).join(", ")} + ${funcs.length - 4} more` : `${pyClass[1]}: ${funcs.join(", ")}`);
  if (funcs.length > 0) return cap(funcs.slice(0, 4).join(", "));
  return null;
}

// .go — HTTP handlers / interface / struct / funcs
export function extractGo(content: string): string | null {
  const handlers = (content.match(/func\s+(\w+)\s*\(\s*\w+\s+http\.ResponseWriter/g) || [])
    .map(m => m.match(/func\s+(\w+)/)?.[1]).filter(Boolean);
  if (handlers.length) return cap(`HTTP handlers: ${handlers.slice(0, 5).join(", ")}`);
  const iface = content.match(/type\s+(\w+)\s+interface\s*\{/);
  if (iface) return `Interface: ${iface[1]}`;
  const structM = content.match(/type\s+(\w+)\s+struct\s*\{/);
  if (structM) return `Struct: ${structM[1]}`;
  const funcs = (content.match(/^func\s+(\w+)/gm) || []).map(m => m.match(/func\s+(\w+)/)?.[1]).filter(n => n && n[0] === n[0].toUpperCase()) as string[];
  if (funcs.length) return cap(funcs.slice(0, 5).join(", "));
  return null;
}

// .rs — struct+impl / trait / enum / fns
export function extractRust(content: string): string | null {
  const structM = content.match(/pub\s+struct\s+(\w+)/);
  if (structM) {
    const methods = (content.match(/pub\s+(?:async\s+)?fn\s+(\w+)/g) || []).map(m => m.match(/fn\s+(\w+)/)?.[1]).filter(Boolean);
    return cap(methods.length ? `${structM[1]}: ${methods.slice(0, 4).join(", ")}` : `Struct: ${structM[1]}`);
  }
  const traitM = content.match(/pub\s+trait\s+(\w+)/);
  if (traitM) return `Trait: ${traitM[1]}`;
  const enumM = content.match(/pub\s+enum\s+(\w+)/);
  if (enumM) return `Enum: ${enumM[1]}`;
  const fns = (content.match(/pub\s+(?:async\s+)?fn\s+(\w+)/g) || []).map(m => m.match(/fn\s+(\w+)/)?.[1]).filter(Boolean);
  if (fns.length) return cap(fns.slice(0, 5).join(", "));
  return null;
}

// .java — Spring annotations / entity / methods
export function extractJava(content: string, basename: string): string | null {
  const cls = content.match(/(?:public\s+)?class\s+(\w+)/);
  const className = cls?.[1] || basename.replace(".java", "");
  const annotations = (content.match(/@(RestController|Controller|Service|Repository|Component|Entity|Configuration)/g) || []).map(a => a.slice(1));
  const mappings = (content.match(/@(?:Get|Post|Put|Patch|Delete|Request)Mapping/g) || []).length;
  if (mappings) return cap(`${annotations[0] || "Spring"}: ${className} (${mappings} endpoints)`);
  if (annotations.length) return `${annotations[0]}: ${className}`;
  if (content.includes("@Entity")) return `Entity: ${className}`;
  const methods = (content.match(/public\s+(?:static\s+)?(?:\w+(?:<[\w,\s]+>)?)\s+(\w+)\s*\(/g) || [])
    .map(m => m.match(/(\w+)\s*\(/)?.[1]).filter(n => n && n !== className) as string[];
  if (methods.length) return cap(`${className}: ${methods.slice(0, 4).join(", ")}`);
  return className ? `Class: ${className}` : "";
}

// .kt / .kts — data class / Ktor / fns
export function extractKotlin(content: string, basename: string): string | null {
  const cls = content.match(/(?:data\s+)?class\s+(\w+)/);
  if (content.match(/data\s+class/)) return `Data class: ${cls?.[1] || basename.replace(/\.kts?$/, "")}`;
  if (content.includes("routing {")) return "Ktor routing";
  const fns = (content.match(/fun\s+(\w+)/g) || []).map(m => m.match(/fun\s+(\w+)/)?.[1]).filter(Boolean);
  if (cls && fns.length) return cap(`${cls[1]}: ${fns.slice(0, 4).join(", ")}`);
  if (fns.length) return cap(fns.slice(0, 5).join(", "));
  return null;
}

// .cs — Controller / DbContext / Class
export function extractCSharp(content: string, basename: string): string | null {
  const cls = content.match(/(?:public\s+)?(?:partial\s+)?class\s+(\w+)(?:\s*:\s*(\w+))?/);
  const className = cls?.[1] || basename.replace(".cs", "");
  const parent = cls?.[2] || "";
  if (parent === "Controller" || parent === "ControllerBase" || content.includes("[ApiController]")) {
    const actions = (content.match(/\[Http(Get|Post|Put|Patch|Delete)\]/g) || []).map(a => a.match(/Http(\w+)/)?.[1]).filter(Boolean);
    return cap(actions.length ? `API Controller: ${className} (${[...new Set(actions)].join(", ")})` : `Controller: ${className}`);
  }
  if (parent === "DbContext" || content.includes("DbSet<")) {
    const sets = (content.match(/DbSet<(\w+)>/g) || []).map(s => s.match(/<(\w+)>/)?.[1]).filter(Boolean);
    return cap(sets.length ? `DbContext: ${sets.join(", ")}` : `DbContext: ${className}`);
  }
  return className ? `Class: ${className}` : "";
}

// .rb — Controller / Model / migration / methods
export function extractRuby(content: string, basename: string): string | null {
  const cls = content.match(/class\s+(\w+)(?:\s*<\s*(\w+(?:::\w+)?))?/);
  const className = cls?.[1] || "";
  const parent = cls?.[2] || "";
  if (parent?.includes("Controller")) {
    const actions = (content.match(/def\s+(index|show|new|create|edit|update|destroy|\w+)/g) || [])
      .map(m => m.match(/def\s+(\w+)/)?.[1]).filter(n => n && !n.startsWith("_")) as string[];
    return cap(actions.length ? `Controller: ${actions.join(", ")}` : `Controller: ${className}`);
  }
  if (parent === "ApplicationRecord" || parent === "ActiveRecord::Base") return `Model: ${className}`;
  if (basename.match(/^\d{14}_/)) {
    const create = content.match(/create_table\s+:(\w+)/);
    return create ? `Migration: create ${create[1]}` : "Database migration";
  }
  const methods = (content.match(/def\s+(\w+)/g) || []).map(m => m.match(/def\s+(\w+)/)?.[1]).filter(n => n && !n.startsWith("_")) as string[];
  if (cls && methods.length) return cap(`${className}: ${methods.slice(0, 4).join(", ")}`);
  return null;
}

// .swift — SwiftUI / protocol / struct / class
export function extractSwift(content: string): string | null {
  if (content.includes(": View") || content.includes("some View")) {
    const name = content.match(/struct\s+(\w+)\s*:\s*View/);
    return name ? `SwiftUI view: ${name[1]}` : "SwiftUI view";
  }
  const proto = content.match(/protocol\s+(\w+)/);
  if (proto) return `Protocol: ${proto[1]}`;
  const struct = content.match(/(?:public\s+)?struct\s+(\w+)/);
  const cls = content.match(/(?:public\s+)?class\s+(\w+)/);
  const name = struct?.[1] || cls?.[1] || "";
  if (name) return `${struct ? "Struct" : "Class"}: ${name}`;
  return null;
}

// .dart — Flutter widget / class
export function extractDart(content: string): string | null {
  if (content.includes("StatefulWidget") || content.includes("StatelessWidget")) {
    const name = content.match(/class\s+(\w+)\s+extends\s+(?:Stateful|Stateless)Widget/);
    return name ? `${content.includes("StatefulWidget") ? "Stateful" : "Stateless"} widget: ${name[1]}` : "Flutter widget";
  }
  const cls = content.match(/class\s+(\w+)/);
  if (cls) return `Class: ${cls[1]}`;
  return null;
}
