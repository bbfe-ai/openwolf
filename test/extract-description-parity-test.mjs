// G-extract-description-parity: golden baseline for extractDescription (OPT-33 G3).
//
// OPT-33 will split the 451-line extractDescription (shared.ts L162–613) into
// per-language-family modules. Before any refactor, this gate captures the CURRENT
// output for representative files across every branch (known-basename map + all ext
// branches + key sub-branches + fallback). The refactor must preserve these EXACT
// outputs (byte parity) — any drift fails this gate.
//
// Outputs below were captured from the pre-refactor implementation (commit ffa95f9)
// via opt33-capture.mjs. Do NOT edit expected values to make the test pass — if a
// value changes, that is a behavior change requiring explicit review + re-baseline.

import * as fs from "node:fs";
import * as path from "node:path";
import { extractDescription } from "../dist/hooks/shared.js";

const OPENWOLF_ROOT = path.resolve(import.meta.dirname, "..");
const TESTDIR = path.join(OPENWOLF_ROOT, ".opt33-parity");

// [filename, content, expectedDescription]
const CASES = [
  // ── known-basename map ──
  ["package.json", `{"name":"x"}`, "Node.js package manifest"],
  ["tsconfig.json", `{"compilerOptions":{}}`, "TypeScript configuration"],
  [".gitignore", `node_modules\n`, "Git ignore rules"],
  ["README.md", `# Project\n\nDesc`, "Project documentation"],
  ["composer.json", `{"name":"x"}`, "PHP package manifest"],
  ["requirements.txt", `flask\n`, "Python dependencies"],
  ["schema.sql", `CREATE TABLE x;`, "Database schema"],
  ["Dockerfile", `FROM node:20\n`, "Docker container definition"],
  ["docker-compose.yml", `services:\n  web:\n`, "Docker Compose services"],
  ["Cargo.toml", `[package]\nname="x"\n`, "Rust package manifest"],
  ["go.mod", `module x\n`, "Go module definition"],
  ["Gemfile", `gem "rails"\n`, "Ruby dependencies"],
  ["pubspec.yaml", `name: x\n`, "Dart/Flutter package manifest"],
  // ── .md / .html ──
  ["guide.md", `# My Guide Title\n\nSome content here.\n`, "My Guide Title"],
  ["page.html", `<html><head><title>My Page</title></head><body></body></html>`, "My Page"],
  // ── .py (phase 1 first-line + phase 2 structured) ──
  ["app.py", `class User:\n    def __init__(self):\n        pass\n    def save(self):\n        pass\n`, "User: save"],
  ["models.py", `class Account:\n    name = models.CharField()\n    email = models.EmailField()\n`, "Declares Account"],
  ["tasks.py", `from celery import task\n@task\ndef send_email():\n    pass\n@task\ndef cleanup():\n    pass\n`, "send_email, cleanup"],
  // ── .rs (struct+impl / trait / enum) ──
  ["lib.rs", `pub struct User {\n    name: String,\n}\nimpl User {\n    fn new() -> Self { Self { name: String::new() } }\n    fn save(&self) {}\n}\n`, "Struct: User"],
  ["traits.rs", `pub trait Drawable {\n    fn draw(&self);\n}\n`, "Trait: Drawable"],
  ["enums.rs", `pub enum Color {\n    Red,\n    Green,\n}\n`, "Enum: Color"],
  // ── .go (struct / interface) ──
  ["main.go", `type User struct {\n    Name string\n}\nfunc (u *User) Save() {}\nfunc CreateUser() {}\n`, "Struct: User"],
  ["iface.go", `type Reader interface {\n    Read() error\n}\n`, "Interface: Reader"],
  // ── .cs (ApiController) ──
  ["Controller.cs", `using Microsoft.AspNetCore.Mvc;\n[ApiController]\npublic class UsersController : ControllerBase {\n    public IActionResult Get() { return Ok(); }\n    public IActionResult Post() { return Ok(); }\n}\n`, "Controller: UsersController"],
  // ── .ex (defmodule) ──
  ["user.ex", `defmodule MyApp.User do\n  def name(), do: "x"\n  def email(), do: "y"\nend\n`, "MyApp.User: name, email"],
  // ── .php (controller / blade / model / migration) ──
  ["UsersController.php", `<?php\nclass UsersController {\n    public function index() {}\n    public function show() {}\n    public function create() {}\n}\n`, "index, show, create"],
  ["create_users.blade.php", `<div>Hello {{ $name }}</div>\n`, "Blade template"],
  ["UserModel.php", `<?php\nclass User extends Model {\n    protected $table = "users";\n}\n`, "Model — table: users"],
  ["2024_01_01_000000_create_users_table.php", `<?php\nuse Illuminate\\Database\\Migrations\\Migration;\nclass CreateUsersTable extends Migration {\n    public function up() { Schema::create("users", function($t){}); }\n}\n`, "Migration: create users table"],
  // ── .ts/.tsx (Next.js page / layout / route / exports / zod) ──
  ["page.tsx", `export default function Page() { return <div/> }\n`, "Page"],
  ["layout.tsx", `export default function Layout({children}) { return <div>{children}</div> }\n`, "Layout"],
  ["route.ts", `export async function GET() {}\nexport async function POST() {}\n`, "Next.js API route: GET, POST"],
  ["utils.ts", `export function add(a, b) { return a + b; }\nexport function sub(a, b) { return a - b; }\n`, "Exports add, sub"],
  ["schema.ts", `import { z } from "zod";\nexport const UserSchema = z.object({ name: z.string() });\nexport const PostSchema = z.object({ title: z.string() });\n`, "Zod schemas: UserSchema, PostSchema"],
  // ── .java (entity / rest controller) ──
  ["User.java", `package com.example;\nimport jakarta.persistence.Entity;\n@Entity\npublic class User {\n    private String name;\n    public String getName() { return name; }\n}\n`, "Entity: User"],
  ["UserController.java", `package com.example;\nimport org.springframework.web.bind.annotation.*;\n@RestController\n@RequestMapping("/users")\npublic class UserController {\n    @GetMapping public List list() { return null; }\n    @PostMapping public User create() { return null; }\n}\n`, "RestController: UserController (3 endpoints)"],
  // ── .kt (data class / class+fns) ──
  ["User.kt", `data class User(val name: String, val email: String)\n`, "Data class: User"],
  ["Service.kt", `class UserService {\n    fun find() {}\n    fun save() {}\n}\n`, "UserService: find, save"],
  // ── .rb (model / migration / controller) ──
  ["user.rb", `class User < ApplicationRecord\n    def full_name\n    end\n    def initials\n    end\nend\n`, "Model: User"],
  ["20240101000000_create_users.rb", `class CreateUsers < ActiveRecord::Migration[7.0]\n  def change\n    create_table :users do |t|\n    end\n  end\nend\n`, "Migration: create users"],
  ["users_controller.rb", `class UsersController < ApplicationController\n    def index\n    end\n    def show\n    end\nend\n`, "Controller: index, show"],
  // ── .swift (struct / protocol) ──
  ["User.swift", `struct User {\n    let name: String\n    func greet() {}\n}\n`, "Struct: User"],
  ["Drawable.swift", `protocol Drawable {\n    func draw()\n}\n`, "Protocol: Drawable"],
  // ── .dart / .vue / .svelte / .astro ──
  ["main.dart", `class App {\n    void run() {}\n    void stop() {}\n}\n`, "Class: App"],
  ["App.vue", `<template><div/></template>\n<script>export default { name: "App" }</script>\n`, "Vue: App"],
  ["Button.svelte", `<button>Click</button>\n`, "Svelte: Button"],
  ["Page.astro", `---\nconst x = 1;\n---\n<div>Hello</div>\n`, "Astro: Page"],
  // ── .css / .sql / .proto / .graphql / .yaml / .toml / .lua / .zig ──
  ["style.css", `body { margin: 0; }\n.container { width: 100%; }\n`, "Styles: 1 rules"],
  ["query.sql", `SELECT * FROM users;\nINSERT INTO logs VALUES(1);\n`, ""],
  ["user.proto", `syntax = "proto3";\nmessage User {\n    string name = 1;\n}\nservice UserService {\n    rpc GetUser(User) returns (User);\n}\n`, "Proto: messages: User, services: UserService"],
  ["schema.graphql", `type User {\n    name: String\n}\ntype Query {\n    user: User\n}\n`, "GraphQL: types: User, Query"],
  ["config.yaml", `name: myapp\nserver:\n  port: 3000\n`, ""],
  ["pyproject.toml", `[project]\nname = "x"\nversion = "1.0"\n`, ""],
  ["init.lua", `local M = {}\nfunction M.foo() end\nfunction M.bar() end\nreturn M\n`, "foo, bar"],
  ["main.zig", `const std = @import("std");\npub fn main() void {}\n`, "main"],
  // ── fallback (unknown ext) ──
  ["data.xyz", `some random content\n`, ""],
];

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${msg}`); }
}

if (!fs.existsSync(path.join(OPENWOLF_ROOT, "dist", "hooks", "shared.js"))) {
  console.error("✗ Build missing. Run build:hooks first.");
  process.exit(2);
}

fs.rmSync(TESTDIR, { recursive: true, force: true });
fs.mkdirSync(TESTDIR, { recursive: true });

for (const [name, content, expected] of CASES) {
  fs.writeFileSync(path.join(TESTDIR, name), content);
  const got = extractDescription(path.join(TESTDIR, name));
  assert(got === expected, `${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
}

// Sanity: every known branch is represented (coverage guard — catches a missed ext).
const extsCovered = new Set(CASES.map(([n]) => path.extname(n).toLowerCase() || n));
const requiredExts = [".md", ".html", ".py", ".rs", ".go", ".cs", ".ex", ".php", ".ts", ".tsx", ".java", ".kt", ".rb", ".swift", ".dart", ".vue", ".svelte", ".astro", ".css", ".sql", ".proto", ".graphql", ".yaml", ".toml", ".lua", ".zig"];
for (const ext of requiredExts) {
  assert(extsCovered.has(ext), `coverage: ext ${ext || "(none)"} has a sample`);
}

fs.rmSync(TESTDIR, { recursive: true, force: true });
console.log(`\nG-extract-description-parity: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
