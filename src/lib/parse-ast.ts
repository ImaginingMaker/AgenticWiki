import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import type {
  ASTParseResult,
  ComponentInfo,
  FunctionInfo,
  PropInfo,
} from "../types/index.js";
import type {
  File,
  FunctionDeclaration,
  VariableDeclarator,
  ArrowFunctionExpression,
  FunctionExpression,
  CallExpression,
  Identifier,
  ImportDeclaration,
  ExportNamedDeclaration,
  ExportDefaultDeclaration,
  TSTypeAnnotation,
  TSTypeReference,
  TSArrayType,
  TSTypeLiteral,
} from "@babel/types";

const traverse =
  typeof _traverse === "function"
    ? _traverse
    : (_traverse as any).default || _traverse;

// Use the correct traverse function (handling both ESM and CJS)

function isPascalCase(name: string): boolean {
  return /^[A-Z]/.test(name);
}

function extractPropsFromParams(params: any[]): PropInfo[] {
  if (!params || params.length === 0) return [];

  const firstParam = params[0];
  if (!firstParam) return [];

  // Check for destructuring pattern with type annotation
  if (firstParam.type === "ObjectPattern" && firstParam.typeAnnotation) {
    // When destructured props have a type annotation, treat as a single typed prop
    const typeStr = resolveTSType(firstParam.typeAnnotation.typeAnnotation);
    return [{ name: "{...}", type: typeStr, required: true }];
  }

  // Check for simple identifier with type annotation
  if (firstParam.type === "Identifier" && firstParam.typeAnnotation) {
    const typeStr = resolveTSType(firstParam.typeAnnotation.typeAnnotation);
    // If the type is a named reference (e.g., MyComponentProps), return it as a single prop
    if (typeStr && typeStr !== "object") {
      return [
        {
          name: firstParam.name,
          type: typeStr,
          required: !firstParam.optional,
        },
      ];
    }
  }

  // Check for destructuring without type annotation — extract property names
  if (firstParam.type === "ObjectPattern") {
    return firstParam.properties
      .filter(
        (p: any) => p.type === "ObjectProperty" && p.key.type === "Identifier",
      )
      .map((p: any) => ({
        name: p.key.name,
        type: "unknown",
        required: true,
      }));
  }

  return [];
}

function extractPropsFromObjectPattern(param: any): PropInfo[] {
  const props: PropInfo[] = [];
  for (const prop of param.properties) {
    if (prop.type === "ObjectProperty" && prop.key.type === "Identifier") {
      const name = prop.key.name;
      let type = "unknown";
      let required = true;

      // Check if the value (which is the actual parameter binding) has a type annotation
      if (
        prop.value &&
        prop.value.type === "Identifier" &&
        prop.value.typeAnnotation
      ) {
        type = resolveTSType(prop.value.typeAnnotation.typeAnnotation);
        required = !prop.value.optional;
      } else if (prop.value && prop.value.type === "AssignmentPattern") {
        // Has default value → not required
        required = false;
        if (prop.value.left && prop.value.left.typeAnnotation) {
          type = resolveTSType(prop.value.left.typeAnnotation.typeAnnotation);
        }
      }

      props.push({ name, type, required });
    } else if (
      prop.type === "RestElement" &&
      prop.argument?.type === "Identifier"
    ) {
      props.push({
        name: prop.argument.name,
        type: "any",
        required: false,
      });
    }
  }
  return props;
}

function resolveTSType(typeNode: any): string {
  if (!typeNode) return "unknown";

  switch (typeNode.type) {
    case "TSStringKeyword":
      return "string";
    case "TSNumberKeyword":
      return "number";
    case "TSBooleanKeyword":
      return "boolean";
    case "TSAnyKeyword":
      return "any";
    case "TSVoidKeyword":
      return "void";
    case "TSNullKeyword":
      return "null";
    case "TSUndefinedKeyword":
      return "undefined";
    case "TSObjectKeyword":
      return "object";
    case "TSArrayType":
      return `${resolveTSType(typeNode.elementType)}[]`;
    case "TSTypeReference": {
      if (typeNode.typeName.type === "Identifier") {
        return typeNode.typeName.name;
      }
      return "unknown";
    }
    case "TSUnionType":
      return typeNode.types.map((t: any) => resolveTSType(t)).join(" | ");
    case "TSIntersectionType":
      return typeNode.types.map((t: any) => resolveTSType(t)).join(" & ");
    case "TSTypeLiteral":
      return "object";
    case "TSFunctionType":
      return "function";
    case "TSParenthesizedType":
      return resolveTSType(typeNode.typeAnnotation);
    default:
      return "unknown";
  }
}

function extractFunctionParams(
  params: any[],
): { name: string; type: string }[] {
  return params.map((param) => {
    let name = "unknown";
    let type = "unknown";

    if (param.type === "Identifier") {
      name = param.name;
      if (param.typeAnnotation) {
        type = resolveTSType(param.typeAnnotation.typeAnnotation);
      }
    } else if (param.type === "ObjectPattern") {
      name = "{...}";
      if (param.typeAnnotation) {
        type = resolveTSType(param.typeAnnotation.typeAnnotation);
      }
    } else if (param.type === "ArrayPattern") {
      name = "[...]";
    } else if (param.type === "RestElement") {
      name = `...${param.argument?.name || "args"}`;
      if (param.typeAnnotation) {
        type = resolveTSType(param.typeAnnotation.typeAnnotation);
      }
    } else if (param.type === "AssignmentPattern") {
      if (param.left?.type === "Identifier") {
        name = param.left.name;
        if (param.left.typeAnnotation) {
          type = resolveTSType(param.left.typeAnnotation.typeAnnotation);
        }
      }
    }

    return { name, type };
  });
}

function extractReturnType(returnTypeNode: any): string {
  if (!returnTypeNode || !returnTypeNode.typeAnnotation) return "unknown";
  return resolveTSType(returnTypeNode.typeAnnotation);
}

export function parseAST(filePath: string, content: string): ASTParseResult {
  const components: ComponentInfo[] = [];
  const functions: FunctionInfo[] = [];
  const imports: string[] = [];
  const exports: string[] = [];
  const componentHooks: Map<string, string[]> = new Map();
  const componentExports: Map<string, string[]> = new Map();
  const componentDeps: Map<string, string[]> = new Map();

  let ast: File;
  try {
    ast = parse(content, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
      errorRecovery: true,
    });
  } catch {
    return {
      file: filePath,
      parsedAt: new Date().toISOString(),
      components: [],
      functions: [],
      imports: [],
      exports: [],
    };
  }

  // Track which names are exported
  const exportedNames = new Set<string>();
  const defaultExportName: string | null = null;

  // Collect all exports by walking top-level AST statements directly
  // (More reliable than traverse visitors which have version-specific quirks)
  for (const stmt of (ast as any).program?.body || []) {
    if (stmt.type === "ExportNamedDeclaration") {
      if (stmt.declaration) {
        if (
          stmt.declaration.type === "FunctionDeclaration" &&
          stmt.declaration.id
        ) {
          exportedNames.add(stmt.declaration.id.name);
          exports.push(stmt.declaration.id.name);
        } else if (stmt.declaration.type === "VariableDeclaration") {
          for (const decl of stmt.declaration.declarations || []) {
            if (decl.id?.type === "Identifier") {
              exportedNames.add(decl.id.name);
              exports.push(decl.id.name);
            }
          }
        } else if (
          stmt.declaration.type === "ClassDeclaration" &&
          stmt.declaration.id
        ) {
          exportedNames.add(stmt.declaration.id.name);
          exports.push(stmt.declaration.id.name);
        }
      }
      // Handle export { foo, bar } re-exports
      for (const spec of stmt.specifiers || []) {
        const exported =
          spec.exported?.type === "Identifier"
            ? spec.exported.name
            : spec.exported?.value || "unknown";
        exportedNames.add(exported);
        exports.push(exported);
      }
    } else if (stmt.type === "ExportDefaultDeclaration") {
      if (stmt.declaration?.type === "Identifier") {
        exportedNames.add(stmt.declaration.name);
        exports.push(`default: ${stmt.declaration.name}`);
      } else if (
        stmt.declaration?.type === "FunctionDeclaration" &&
        stmt.declaration.id
      ) {
        exportedNames.add(stmt.declaration.id.name);
        exports.push(`default: ${stmt.declaration.id.name}`);
      } else {
        exports.push("default");
      }
    }
  }

  const tr =
    typeof traverse === "function"
      ? traverse
      : (traverse as any).default || traverse;

  tr(ast, {
    ImportDeclaration(path: any) {
      const source = path.node.source.value as string;
      const specifiers = path.node.specifiers
        .map((spec: any) => {
          if (spec.type === "ImportDefaultSpecifier") {
            return `${spec.local.name} from '${source}'`;
          }
          if (spec.type === "ImportNamespaceSpecifier") {
            return `* as ${spec.local.name} from '${source}'`;
          }
          if (spec.type === "ImportSpecifier") {
            const imported =
              spec.imported.type === "Identifier"
                ? spec.imported.name
                : spec.imported.value;
            if (imported === spec.local.name) {
              return `{ ${imported} } from '${source}'`;
            }
            return `{ ${imported} as ${spec.local.name} } from '${source}'`;
          }
          return "";
        })
        .filter(Boolean);
      imports.push(
        specifiers.length > 0 ? specifiers.join(", ") : `from '${source}'`,
      );
    },

    FunctionDeclaration(path: any) {
      const name = path.node.id?.name;
      if (!name) return;

      if (isPascalCase(name)) {
        // Potential component
        const props = extractPropsFromParams(path.node.params);
        const hooks: string[] = [];
        const deps: string[] = [];

        // Scan for hooks and dependencies inside the function body
        path.traverse({
          CallExpression(innerPath: any) {
            const callee = innerPath.node.callee;
            if (callee.type === "Identifier" && /^use[A-Z]/.test(callee.name)) {
              hooks.push(callee.name);
            }
          },
        });

        componentHooks.set(name, hooks);
        componentDeps.set(name, deps);

        components.push({
          name,
          file: filePath,
          type: "functional",
          props,
          exports: [],
          hooks,
          dependencies: deps,
          description: "",
        });
      } else {
        // Regular function
        const params = extractFunctionParams(path.node.params);
        const returnType = extractReturnType(path.node.returnType);
        const isExported = exportedNames.has(name);
        const isAsync = path.node.async ?? false;

        functions.push({
          name,
          file: filePath,
          params,
          returnType,
          isExported,
          isAsync,
        });
      }
    },

    VariableDeclarator(path: any) {
      const name = path.node.id.name;

      const init = path.node.init;
      if (!init) return;

      // Arrow function or function expression
      if (
        init.type === "ArrowFunctionExpression" ||
        init.type === "FunctionExpression"
      ) {
        if (isPascalCase(name)) {
          // Potential component
          const props = extractPropsFromParams(init.params);
          const hooks: string[] = [];
          const deps: string[] = [];

          path.traverse({
            CallExpression(innerPath: any) {
              const callee = innerPath.node.callee;
              if (
                callee.type === "Identifier" &&
                /^use[A-Z]/.test(callee.name)
              ) {
                hooks.push(callee.name);
              }
            },
          });

          componentHooks.set(name, hooks);
          componentDeps.set(name, deps);

          components.push({
            name,
            file: filePath,
            type: "functional",
            props,
            exports: [],
            hooks,
            dependencies: deps,
            description: "",
          });
        } else {
          // Regular function (arrow / expression)
          const params = extractFunctionParams(init.params);
          const returnType = extractReturnType(init.returnType);
          const isExported = exportedNames.has(name);
          const isAsync = init.async ?? false;

          functions.push({
            name,
            file: filePath,
            params,
            returnType,
            isExported,
            isAsync,
          });
        }
      }
    },
  });

  // Second pass: update component exports
  for (const comp of components) {
    comp.exports = exportedNames.has(comp.name) ? [comp.name] : [];
  }

  return {
    file: filePath,
    parsedAt: new Date().toISOString(),
    components,
    functions,
    imports,
    exports,
  };
}
