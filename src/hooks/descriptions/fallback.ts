// Last-resort description — generic declaration extraction.
// Always returns a string (possibly empty). Extracted from extractDescription (OPT-33 step 4).
import { capDescription as cap } from "./cap.js";

export function extractFallback(content: string): string {
  const declM = content.match(/(?:function|class|const|interface|type|enum)\s+(\w+)/);
  if (declM) {
    const name = declM[1];
    const methods = (content.match(/(?:public\s+)?(?:async\s+)?(?:function\s+|(?:get|set)\s+)(\w+)\s*\(/g) || [])
      .map(m => m.match(/(\w+)\s*\(/)?.[1]).filter(n => n && n !== name && n !== "__construct" && n !== "constructor") as string[];
    if (methods.length > 0 && methods.length <= 5) return cap(`${name}: ${methods.join(", ")}`);
    if (methods.length > 5) return cap(`${name}: ${methods.slice(0, 3).join(", ")} + ${methods.length - 3} more`);
    return `Declares ${name}`;
  }
  return "";
}
