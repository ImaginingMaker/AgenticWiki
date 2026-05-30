/**
 * Parse TypeScript/JavaScript source files to extract components, functions, imports, and exports.
 * Uses @babel/parser for robust AST parsing.
 */

import { parse, type ParserPlugin } from "@babel/parser";
import traverse from "@babel/traverse";
import type {
  File,
  FunctionDeclaration,
  ArrowFunctionExpression,
  VariableDeclaration,
  ExportNamedDeclaration,
  ExportDefaultDeclaration,
  ImportDeclaration,
  Identifier,
  ObjectPattern,
  TSParameterProperty,
  TSTypeAnnotation,
  TSTypeReference,
  TSUnionType,
  TSIntersectionType,
  TSArrayType,
} from "@babel/types";
import type {
  ASTParseResult,
  ComponentInfo,
  FunctionInfo,
  PropInfo,
} from "../types/index.js";

/**
 * Determine if a function is a React component based on:
 * 1. Name starts with uppercase
 * 2. Returns JSX
 * 3. Uses hooks
 */
function isReactComponent(
  name: string,
  node: FunctionDeclaration | ArrowFunctionExpression,
): boolean {
  // Name must start with uppercase
  if (!name || name[0] !== name[0].toUpperCase()) {
    return false;
  }

  // Check if returns JSX
  let hasJSXReturn = false;
  let hasHookUsage = false;

  // Simple heuristic: check body for JSX elements or hooks
  const bodyStr = node.body ? JSON.stringify(node.body) : "";

  // Check for JSX return patterns
  hasJSXReturn =
    bodyStr.includes('"type":"JSXElement"') ||
    bodyStr.includes('"type":"JSXFragment"') ||
    bodyStr.includes("return <") ||
    (bodyStr.includes("return(") && bodyStr.includes("<"));

  // Check for hook usage
  hasHookUsage = /use[A-Z]\w+/.test(bodyStr);

  return hasJSXReturn || hasHookUsage;
}

/**
 * Extract prop type from a parameter.
 */
function extractPropType(param: unknown): PropInfo[] {
  const props: PropInfo[] = [];

  if (!param) return props;

  const p = param as Identifier & { typeAnnotation?: TSTypeAnnotation };

  // Simple identifier with type annotation: (props: PropsType)
  if (p.type === "Identifier" && p.typeAnnotation) {
    const typeStr = extractTypeString(p.typeAnnotation);
    props.push({
      name: p.name,
      type: typeStr,
      required: true,
    });
  }

  // Destructured props: ({ a, b }: PropsType)
  if (p.type === "ObjectPattern") {
    const op = p as ObjectPattern & { typeAnnotation?: TSTypeAnnotation };

    // If there's a type annotation, it's for the whole object
    if (op.typeAnnotation) {
      props.push({
        name: "{...}",
        type: extractTypeString(op.typeAnnotation),
        required: true,
      });
    } else {
      // Extract individual destructured properties
      for (const prop of op.properties || []) {
        if (prop.type === "RestElement") continue;
        if (
          prop.type === "ObjectProperty" &&
          prop.key &&
          prop.key.type === "Identifier"
        ) {
          const hasDefault =
            prop.value && prop.value.type === "AssignmentPattern";
          props.push({
            name: prop.key.name,
            type: "unknown",
            required: !hasDefault,
            default: hasDefault
              ? (
                  prop.value as { right: { value: unknown } }
                ).right?.value?.toString()
              : undefined,
          });
        }
      }
    }
  }

  return props;
}

/**
 * Extract type string from a TSTypeAnnotation.
 */
function extractTypeString(
  annotation: TSTypeAnnotation | null | undefined,
): string {
  if (!annotation || !annotation.typeAnnotation) return "unknown";

  const typeNode = annotation.typeAnnotation;

  if (typeNode.type === "TSTypeReference") {
    const ref = typeNode as TSTypeReference;
    if (ref.typeName && ref.typeName.type === "Identifier") {
      return ref.typeName.name;
    }
  }

  if (typeNode.type === "TSUnionType") {
    const union = typeNode as TSUnionType;
    return union.types.map((t) => extractTypeFromNode(t)).join(" | ");
  }

  if (typeNode.type === "TSIntersectionType") {
    const inter = typeNode as TSIntersectionType;
    return inter.types.map((t) => extractTypeFromNode(t)).join(" & ");
  }

  if (typeNode.type === "TSArrayType") {
    const arr = typeNode as TSArrayType;
    return extractTypeFromNode(arr.elementType) + "[]";
  }

  if (typeNode.type === "TSStringKeyword") return "string";
  if (typeNode.type === "TSNumberKeyword") return "number";
  if (typeNode.type === "TSBooleanKeyword") return "boolean";
  if (typeNode.type === "TSVoidKeyword") return "void";
  if (typeNode.type === "TSAnyKeyword") return "any";
  if (typeNode.type === "TSUnknownKeyword") return "unknown";
  if (typeNode.type === "TSNullKeyword") return "null";
  if (typeNode.type === "TSUndefinedKeyword") return "undefined";

  return "unknown";
}

/**
 * Extract type string from a type node.
 */
function extractTypeFromNode(node: unknown): string {
  if (!node || typeof node !== "object") return "unknown";
  const n = node as {
    type?: string;
    typeName?: Identifier;
    elementType?: unknown;
  };

  if (n.type === "TSTypeReference" && n.typeName?.type === "Identifier") {
    return n.typeName.name;
  }
  if (n.type === "TSStringKeyword") return "string";
  if (n.type === "TSNumberKeyword") return "number";
  if (n.type === "TSBooleanKeyword") return "boolean";
  if (n.type === "TSVoidKeyword") return "void";
  if (n.type === "TSAnyKeyword") return "any";
  if (n.type === "TSUnknownKeyword") return "unknown";
  if (n.type === "TSNullKeyword") return "null";
  if (n.type === "TSUndefinedKeyword") return "undefined";
  if (n.type === "TSArrayType") {
    return extractTypeFromNode(n.elementType) + "[]";
  }

  return "unknown";
}

/**
 * Extract hooks used in a function body.
 */
function extractHooks(
  node: FunctionDeclaration | ArrowFunctionExpression,
): string[] {
  const hooks: Set<string> = new Set();
  const bodyStr = JSON.stringify(node.body || {});

  // Match useXxx patterns
  const hookMatches = bodyStr.matchAll(/"use([A-Z][a-zA-Z]*)"/g);
  for (const match of hookMatches) {
    hooks.add("use" + match[1]);
  }

  // Also check for string patterns like useState, useEffect
  const hookPatterns = [
    "useState",
    "useEffect",
    "useContext",
    "useReducer",
    "useCallback",
    "useMemo",
    "useRef",
    "useImperativeHandle",
    "useLayoutEffect",
    "useDebugValue",
    "useDeferredValue",
    "useTransition",
    "useId",
  ];

  for (const hook of hookPatterns) {
    if (bodyStr.includes(`"${hook}"`)) {
      hooks.add(hook);
    }
  }

  return [...hooks].sort();
}

/**
 * Format import statement for display.
 */
function formatImport(node: ImportDeclaration): string {
  const source = node.source.value;

  if (node.importKind === "side-effect") {
    return `from '${source}'`;
  }

  const defaults: string[] = [];
  const namespaces: string[] = [];
  const named: string[] = [];

  for (const spec of node.specifiers || []) {
    if (spec.type === "ImportDefaultSpecifier") {
      defaults.push(spec.local.name);
    } else if (spec.type === "ImportNamespaceSpecifier") {
      namespaces.push(`* as ${spec.local.name}`);
    } else if (spec.type === "ImportSpecifier") {
      const imported =
        spec.imported.type === "Identifier"
          ? spec.imported.name
          : spec.imported.value;
      if (imported === spec.local.name) {
        named.push(imported);
      } else {
        named.push(`${imported} as ${spec.local.name}`);
      }
    }
  }

  if (defaults.length === 0 && namespaces.length === 0 && named.length === 0) {
    return `from '${source}'`;
  }

  const parts: string[] = [];
  if (defaults.length > 0) parts.push(defaults.join(", "));
  if (named.length > 0) parts.push(`{ ${named.join(", ")} }`);
  if (namespaces.length > 0) parts.push(namespaces.join(", "));

  return `${parts.join(", ")} from '${source}'`;
}

/**
 * Parse a source file and extract AST information.
 */
export function parseAST(filename: string, code: string): ASTParseResult {
  const components: ComponentInfo[] = [];
  const functions: FunctionInfo[] = [];
  const imports: string[] = [];
  const exports: string[] = [];

  // Determine plugins based on file extension
  const isTypeScript = filename.endsWith(".ts") || filename.endsWith(".tsx");
  const isJSX = filename.endsWith(".tsx") || filename.endsWith(".jsx");
  const plugins: ParserPlugin[] = [];

  if (isTypeScript) plugins.push("typescript");
  if (isJSX) plugins.push("jsx");

  let ast: File;
  try {
    ast = parse(code, {
      sourceType: "module",
      plugins,
      errorRecovery: true,
    });
  } catch {
    // Return empty result for unparseable code
    return {
      file: filename,
      parsedAt: new Date().toISOString(),
      components: [],
      functions: [],
      imports: [],
      exports: [],
    };
  }

  // Track which names are exported
  const exportedNames = new Set<string>();
  let hasDefaultExport = false;

  traverse(ast, {
    ImportDeclaration(path) {
      imports.push(formatImport(path.node));
    },

    ExportNamedDeclaration(path) {
      const node = path.node;

      if (node.declaration) {
        if (
          node.declaration.type === "FunctionDeclaration" &&
          node.declaration.id
        ) {
          exportedNames.add(node.declaration.id.name);
          exports.push(node.declaration.id.name);
        } else if (node.declaration.type === "VariableDeclaration") {
          for (const decl of node.declaration.declarations) {
            if (decl.id.type === "Identifier") {
              exportedNames.add(decl.id.name);
              exports.push(decl.id.name);
            }
          }
        } else if (
          node.declaration.type === "ClassDeclaration" &&
          node.declaration.id
        ) {
          exportedNames.add(node.declaration.id.name);
          exports.push(node.declaration.id.name);
        }
      }

      // Handle export { a, b }
      if (node.specifiers) {
        for (const spec of node.specifiers) {
          if (
            spec.type === "ExportSpecifier" &&
            spec.exported.type === "Identifier"
          ) {
            exportedNames.add(spec.exported.name);
            exports.push(spec.exported.name);
          }
        }
      }
    },

    ExportDefaultDeclaration(path) {
      hasDefaultExport = true;
      const node = path.node;

      if (node.declaration.type === "Identifier") {
        exports.push(`default: ${node.declaration.name}`);
      } else if (
        (node.declaration.type === "FunctionDeclaration" ||
          node.declaration.type === "ClassDeclaration") &&
        node.declaration.id
      ) {
        exports.push(`default: ${node.declaration.id.name}`);
      } else {
        exports.push("default");
      }
    },

    FunctionDeclaration(path) {
      const node = path.node;
      if (!node.id) return;

      const name = node.id.name;
      const isComponent = isReactComponent(name, node);

      if (isComponent) {
        const props: PropInfo[] = [];
        for (const param of node.params || []) {
          props.push(...extractPropType(param));
        }

        components.push({
          name,
          file: filename,
          type: "functional",
          props,
          exports: exportedNames.has(name) ? [name] : [],
          hooks: extractHooks(node),
          dependencies: [],
          description: "",
        });
      } else {
        const params = (node.params || []).map((p) => {
          if (p.type === "Identifier") {
            return {
              name: p.name,
              type: extractPropType(p)[0]?.type || "unknown",
            };
          }
          if (
            p.type === "RestElement" &&
            p.argument &&
            p.argument.type === "Identifier"
          ) {
            return {
              name: `...${p.argument.name}`,
              type:
                (p.typeAnnotation
                  ? extractTypeString(p.typeAnnotation as TSTypeAnnotation)
                  : undefined) || "unknown",
            };
          }
          if (p.type === "ObjectPattern") {
            const op = p as ObjectPattern & {
              typeAnnotation?: TSTypeAnnotation;
            };
            return {
              name: "{...}",
              type: op.typeAnnotation
                ? extractTypeString(op.typeAnnotation)
                : "unknown",
            };
          }
          return { name: "unknown", type: "unknown" };
        });

        functions.push({
          name,
          file: filename,
          params,
          returnType: node.returnType
            ? extractTypeString(node.returnType as TSTypeAnnotation)
            : "unknown",
          isExported: exportedNames.has(name),
          isAsync: node.async || false,
        });
      }
    },

    VariableDeclaration(path) {
      for (const decl of path.node.declarations) {
        if (!decl.id || decl.id.type !== "Identifier") continue;
        if (!decl.init) continue;

        const name = decl.id.name;
        const init = decl.init;

        // Arrow function
        if (init.type === "ArrowFunctionExpression") {
          const isComponent = isReactComponent(name, init);

          if (isComponent) {
            const props: PropInfo[] = [];
            for (const param of init.params || []) {
              props.push(...extractPropType(param));
            }

            components.push({
              name,
              file: filename,
              type: "functional",
              props,
              exports: exportedNames.has(name) ? [name] : [],
              hooks: extractHooks(init),
              dependencies: [],
              description: "",
            });
          } else {
            const params = (init.params || []).map((p) => {
              if (p.type === "Identifier") {
                return {
                  name: p.name,
                  type: extractPropType(p)[0]?.type || "unknown",
                };
              }
              if (
                p.type === "RestElement" &&
                p.argument &&
                p.argument.type === "Identifier"
              ) {
                return {
                  name: `...${p.argument.name}`,
                  type:
                    (p.typeAnnotation
                      ? extractTypeString(p.typeAnnotation as TSTypeAnnotation)
                      : undefined) || "unknown",
                };
              }
              if (p.type === "ObjectPattern") {
                const op = p as ObjectPattern & {
                  typeAnnotation?: TSTypeAnnotation;
                };
                return {
                  name: "{...}",
                  type: op.typeAnnotation
                    ? extractTypeString(op.typeAnnotation)
                    : "unknown",
                };
              }
              return { name: "unknown", type: "unknown" };
            });

            functions.push({
              name,
              file: filename,
              params,
              returnType: init.returnType
                ? extractTypeString(init.returnType as TSTypeAnnotation)
                : "unknown",
              isExported: exportedNames.has(name),
              isAsync: init.async || false,
            });
          }
        }

        // Function expression
        if (init.type === "FunctionExpression") {
          const params = (init.params || []).map((p) => {
            if (p.type === "Identifier") {
              return {
                name: p.name,
                type: extractPropType(p)[0]?.type || "unknown",
              };
            }
            return { name: "unknown", type: "unknown" };
          });

          functions.push({
            name,
            file: filename,
            params,
            returnType: init.returnType
              ? extractTypeString(init.returnType as TSTypeAnnotation)
              : "unknown",
            isExported: exportedNames.has(name),
            isAsync: init.async || false,
          });
        }
      }
    },
  });

  return {
    file: filename,
    parsedAt: new Date().toISOString(),
    components,
    functions,
    imports,
    exports,
  };
}
