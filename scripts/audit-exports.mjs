/**
 * Read-only export-reference inventory for package-private lib modules.
 * Zones: developer tooling
 * Usage: node scripts/audit-exports.mjs [project-root]
 * Candidates are not deletion proof: review docs, generated code, dynamic
 * namespace access and public declaration reachability before changing them.
 */
import { resolve, relative } from "node:path";
import ts from "typescript";

const root = resolve(process.argv[2] ?? ".");
const configPath = resolve(root, "tsconfig.json");
if (!ts.sys.fileExists(configPath)) throw new Error("Export audit requires tsconfig.json.");
const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
if (parsed.errors.length) throw new Error(parsed.errors.map(error =>
  ts.flattenDiagnosticMessageText(error.messageText, "\n")).join("\n"));
const files = ts.sys.readDirectory(root, [".ts", ".mjs", ".js"], ["node_modules", "dist", ".git"]);
const program = ts.createProgram(files, { ...parsed.options, allowJs: true, noEmit: true });
const checker = program.getTypeChecker();
const sources = program.getSourceFiles().filter(source => files.includes(source.fileName));
const candidates = new Map();
const modules = new Map();

function original(symbol) {
  return symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

for (const source of sources) {
  if (!relative(root, source.fileName).replaceAll("\\", "/").startsWith("lib/")) continue;
  const module = checker.getSymbolAtLocation(source);
  if (!module) continue;
  const scope = { file: relative(root, source.fileName).replaceAll("\\", "/"), rows: [], escapes: new Set() };
  modules.set(module, scope);
  for (const exported of checker.getExportsOfModule(module)) {
    const symbol = original(exported);
    const declarations = symbol?.getDeclarations() ?? [];
    const declaration = declarations.find(node => node.getSourceFile() === source);
    if (!declaration || exported.name === "default") continue;
    const row = {
      file: scope.file,
      name: exported.name,
      line: source.getLineAndCharacterOfPosition(declaration.getStart()).line + 1,
      typeOnly: declarations.every(node => ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)),
      localReferences: 0,
      externalReferences: new Set(),
      namespaceEscapes: scope.escapes,
    };
    candidates.set(symbol, row);
    scope.rows.push(row);
  }
}

for (const source of sources) {
  const file = relative(root, source.fileName).replaceAll("\\", "/");
  // Star reexports need no identifier token naming the individual symbol.
  if (file.startsWith("api/")) {
    const module = checker.getSymbolAtLocation(source);
    for (const exported of module ? checker.getExportsOfModule(module) : []) {
      const symbol = original(exported);
      candidates.get(symbol)?.externalReferences.add(file);
      // A public namespace exposes every member without naming each one.
      for (const row of modules.get(symbol)?.rows ?? []) row.externalReferences.add(file);
    }
  }
  const visit = node => {
    if (ts.isIdentifier(node) || ts.isStringLiteral(node)) {
      const symbol = original(checker.getSymbolAtLocation(node));
      const scope = modules.get(symbol);
      const parent = node.parent;
      if (scope && scope.file !== file && ts.isIdentifier(node) &&
          !ts.isNamespaceImport(parent) &&
          !(ts.isPropertyAccessExpression(parent) && parent.expression === node) &&
          !(ts.isQualifiedName(parent) && parent.left === node) &&
          !(ts.isElementAccessExpression(parent) && parent.expression === node &&
            parent.argumentExpression && ts.isStringLiteral(parent.argumentExpression))) {
        scope.escapes.add(file);
      }
      const row = candidates.get(symbol);
      if (row && !symbol.getDeclarations()?.some(declaration => declaration.name === node)) {
        if (file === row.file) row.localReferences++;
        else row.externalReferences.add(file);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

const rows = [...candidates.values()].map(row => ({
  ...row, externalReferences: [...row.externalReferences].sort(),
  namespaceEscapes: [...row.namespaceEscapes].sort(),
})).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
const unused = rows.filter(row => row.externalReferences.length === 0);
console.log(JSON.stringify({
  scannedSources: sources.length,
  libExports: rows.length,
  candidates: unused,
}, null, 2));
