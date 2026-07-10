// Special basenames with fixed descriptions — checked before reading file content.
// Extracted from extractDescription (OPT-33 seam-first step 1).
export const KNOWN_DESCRIPTIONS: Record<string, string> = {
  "package.json": "Node.js package manifest",
  "tsconfig.json": "TypeScript configuration",
  ".gitignore": "Git ignore rules",
  "README.md": "Project documentation",
  "composer.json": "PHP package manifest",
  "requirements.txt": "Python dependencies",
  "schema.sql": "Database schema",
  "Dockerfile": "Docker container definition",
  "docker-compose.yml": "Docker Compose services",
  "Cargo.toml": "Rust package manifest",
  "go.mod": "Go module definition",
  "Gemfile": "Ruby dependencies",
  "pubspec.yaml": "Dart/Flutter package manifest",
};
