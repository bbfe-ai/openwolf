// Phase-2 structured descriptions for data/config/scripting file formats.
// Each extractor returns the description string, or null to fall through to the
// next family / fallback. Extracted from extractDescription (OPT-33 step 3).
import { capDescription as cap } from "./cap.js";

// .sql — CREATE TABLE list
export function extractSql(content: string): string | null {
  const creates = (content.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)/gi) || [])
    .map(m => m.match(/(?:TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?)([`"']?\w+)/i)?.[1]?.replace(/[`"']/g, "")).filter(Boolean);
  if (creates.length) return cap(`SQL: tables: ${creates.slice(0, 4).join(", ")}`);
  return null;
}

// .proto — messages + services
export function extractProto(content: string): string | null {
  const msgs = (content.match(/message\s+(\w+)/g) || []).map(m => m.match(/message\s+(\w+)/)?.[1]).filter(Boolean);
  const services = (content.match(/service\s+(\w+)/g) || []).map(m => m.match(/service\s+(\w+)/)?.[1]).filter(Boolean);
  const parts: string[] = [];
  if (msgs.length) parts.push(`messages: ${msgs.slice(0, 3).join(", ")}`);
  if (services.length) parts.push(`services: ${services.join(", ")}`);
  return cap(parts.length ? `Proto: ${parts.join(", ")}` : "");
}

// .graphql / .gql — types
export function extractGraphQL(content: string): string | null {
  const types = (content.match(/type\s+(\w+)/g) || []).map(m => m.match(/type\s+(\w+)/)?.[1]).filter(Boolean);
  return cap(types.length ? `GraphQL: types: ${types.slice(0, 4).join(", ")}` : "GraphQL schema");
}

// .yaml / .yml — GitHub Actions / K8s / Docker Compose
export function extractYaml(content: string, basename: string): string | null {
  if (content.includes("runs-on:")) {
    const name = content.match(/^name:\s*(.+)$/m);
    return cap(name ? `CI: ${name[1].trim()}` : "GitHub Actions workflow");
  }
  if (content.includes("apiVersion:") && content.includes("kind:")) {
    const kind = content.match(/kind:\s*(\w+)/);
    return cap(kind ? `K8s ${kind[1]}` : "Kubernetes manifest");
  }
  if (content.includes("services:") && (basename.includes("docker") || basename.includes("compose"))) {
    const services = (content.match(/^\s{2}\w+:/gm) || []).length;
    return `Docker Compose: ${services} services`;
  }
  return null;
}

// .toml — description field
export function extractToml(content: string): string | null {
  const desc = content.match(/^description\s*=\s*"([^"]+)"/m);
  if (desc) return cap(desc[1]);
  return null;
}

// .ex / .exs (phase 2) — Phoenix LiveView / Controller / generic module
export function extractElixir(content: string): string | null {
  const mod = content.match(/defmodule\s+([\w.]+)/);
  if (content.includes("Phoenix.LiveView")) return cap(mod ? `LiveView: ${mod[1]}` : "Phoenix LiveView");
  if (content.includes("Controller")) return cap(mod ? `Phoenix controller: ${mod[1]}` : "Phoenix controller");
  const fns = (content.match(/def\s+(\w+)/g) || []).map(m => m.match(/def\s+(\w+)/)?.[1]).filter(Boolean);
  if (mod && fns.length) return cap(`${mod[1]}: ${fns.slice(0, 4).join(", ")}`);
  if (mod) return mod[1];
  return null;
}

// .lua — top-level functions
export function extractLua(content: string): string | null {
  const fns = (content.match(/function\s+(?:\w+[.:])?(\w+)/g) || []).map(m => m.match(/(\w+)\s*$/)?.[1]).filter(Boolean);
  if (fns.length) return cap(fns.slice(0, 5).join(", "));
  return null;
}

// .zig — public functions
export function extractZig(content: string): string | null {
  const fns = (content.match(/pub\s+fn\s+(\w+)/g) || []).map(m => m.match(/fn\s+(\w+)/)?.[1]).filter(Boolean);
  if (fns.length) return cap(fns.slice(0, 5).join(", "));
  return null;
}
