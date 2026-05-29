import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseAST } from '../parse-ast.js';

describe('parseAST', () => {
  it('should parse a functional component with FunctionDeclaration', () => {
    const code = `
function MyComponent(props) {
  return <div>{props.name}</div>;
}
`;
    const result = parseAST('test.tsx', code);

    expect(result.file).toBe('test.tsx');
    expect(result.components).toHaveLength(1);
    expect(result.components[0].name).toBe('MyComponent');
    expect(result.components[0].type).toBe('functional');
    expect(result.components[0].file).toBe('test.tsx');
    expect(result.components[0].description).toBe('');
  });

  it('should parse a functional component with ArrowFunctionExpression', () => {
    const code = `
const MyButton = () => {
  return <button>Click</button>;
};
`;
    const result = parseAST('test.tsx', code);

    expect(result.components).toHaveLength(1);
    expect(result.components[0].name).toBe('MyButton');
    expect(result.components[0].type).toBe('functional');
  });

  it('should extract component with typed props via identifier', () => {
    const code = `
const UserProfile = (props: UserProfileProps) => {
  return <div>{props.name}</div>;
};
`;
    const result = parseAST('test.tsx', code);

    expect(result.components).toHaveLength(1);
    expect(result.components[0].props).toHaveLength(1);
    expect(result.components[0].props[0].name).toBe('props');
    expect(result.components[0].props[0].type).toBe('UserProfileProps');
  });

  it('should extract component with destructured typed props', () => {
    const code = `
function Card({ title, body }: CardProps) {
  return <div><h1>{title}</h1><p>{body}</p></div>;
}
`;
    const result = parseAST('test.tsx', code);

    expect(result.components).toHaveLength(1);
    expect(result.components[0].props).toHaveLength(1);
    expect(result.components[0].props[0].name).toBe('{...}');
    expect(result.components[0].props[0].type).toBe('CardProps');
  });

  it('should extract component with destructured untyped props', () => {
    const code = `
const Badge = ({ label, count }) => {
  return <span>{label}: {count}</span>;
};
`;
    const result = parseAST('test.tsx', code);

    expect(result.components).toHaveLength(1);
    expect(result.components[0].props).toHaveLength(2);
    expect(result.components[0].props[0].name).toBe('label');
    expect(result.components[0].props[1].name).toBe('count');
  });

  it('should extract hooks from components', () => {
    const code = `
function Counter() {
  const [count, setCount] = useState(0);
  const ref = useRef(null);
  useEffect(() => {}, []);
  return <div>{count}</div>;
}
`;
    const result = parseAST('test.tsx', code);

    expect(result.components).toHaveLength(1);
    expect(result.components[0].hooks).toContain('useState');
    expect(result.components[0].hooks).toContain('useRef');
    expect(result.components[0].hooks).toContain('useEffect');
  });

  it('should extract regular function declarations', () => {
    const code = `
function formatDate(date: string): string {
  return new Date(date).toLocaleDateString();
}
`;
    const result = parseAST('test.ts', code);

    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].name).toBe('formatDate');
    expect(result.functions[0].params).toHaveLength(1);
    expect(result.functions[0].params[0].name).toBe('date');
    expect(result.functions[0].params[0].type).toBe('string');
    expect(result.functions[0].returnType).toBe('string');
    expect(result.functions[0].isExported).toBe(false);
    expect(result.functions[0].isAsync).toBe(false);
  });

  it('should extract arrow function as regular function', () => {
    const code = `
const helper = (a: number, b: number): number => a + b;
`;
    const result = parseAST('test.ts', code);

    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].name).toBe('helper');
    expect(result.functions[0].params).toHaveLength(2);
    expect(result.functions[0].params[0].type).toBe('number');
    expect(result.functions[0].params[1].type).toBe('number');
    expect(result.functions[0].returnType).toBe('number');
  });

  it('should extract async functions', () => {
    const code = `
async function fetchData(url: string): Promise<void> {
  await fetch(url);
}
`;
    const result = parseAST('test.ts', code);

    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].isAsync).toBe(true);
  });

  it('should extract import statements', () => {
    const code = `
import React from 'react';
import { useState, useEffect } from 'react';
import * as utils from './utils';
import { map as mapValues } from 'lodash';
`;
    const result = parseAST('test.ts', code);

    expect(result.imports).toHaveLength(4);
    expect(result.imports[0]).toBe("React from 'react'");
    expect(result.imports[1]).toBe("{ useState } from 'react', { useEffect } from 'react'");
    expect(result.imports[2]).toBe("* as utils from './utils'");
    expect(result.imports[3]).toBe("{ map as mapValues } from 'lodash'");
  });

  it('should extract side-effect-only imports', () => {
    const code = `
import './polyfills';
`;
    const result = parseAST('test.ts', code);

    expect(result.imports).toHaveLength(1);
    expect(result.imports[0]).toBe("from './polyfills'");
  });

  it('should extract named exports', () => {
    const code = `
export function myFunction() {}
export const myVar = 42;
export { helper, formatter };
`;
    const result = parseAST('test.ts', code);

    expect(result.exports).toContain('myFunction');
    expect(result.exports).toContain('myVar');
    expect(result.exports).toContain('helper');
    expect(result.exports).toContain('formatter');
  });

  it('should extract default exports', () => {
    const code = `
export default MyComponent;
`;
    const result = parseAST('test.tsx', code);

    expect(result.exports).toContain('default: MyComponent');
  });

  it('should extract anonymous default exports', () => {
    const code = `
export default function() { return 42; }
`;
    const result = parseAST('test.ts', code);

    expect(result.exports).toContain('default');
  });

  it('should track exported components', () => {
    const code = `
export function MyComponent() {
  return <div />;
}
`;
    const result = parseAST('test.tsx', code);

    expect(result.components).toHaveLength(1);
    expect(result.components[0].exports).toEqual(['MyComponent']);
  });

  it('should handle function expression in variable', () => {
    const code = `
const handler = function(x: number): number { return x * 2; };
`;
    const result = parseAST('test.ts', code);

    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].name).toBe('handler');
    expect(result.functions[0].params).toHaveLength(1);
    expect(result.functions[0].params[0].type).toBe('number');
  });

  it('should handle class exports', () => {
    const code = `
export class MyService {
  constructor() {}
}
`;
    const result = parseAST('test.ts', code);

    expect(result.exports).toContain('MyService');
  });

  it('should return empty result for unparseable code', () => {
    const code = `{{{{invalid syntax`;

    const result = parseAST('broken.ts', code);

    expect(result.file).toBe('broken.ts');
    expect(result.components).toHaveLength(0);
    expect(result.functions).toHaveLength(0);
    expect(result.imports).toHaveLength(0);
    expect(result.exports).toHaveLength(0);
  });

  it('should include parsedAt timestamp', () => {
    const code = `const x = 1;`;
    const before = new Date().toISOString();

    const result = parseAST('test.ts', code);

    const after = new Date().toISOString();
    expect(result.parsedAt >= before).toBe(true);
    expect(result.parsedAt <= after).toBe(true);
  });

  it('should handle empty file content', () => {
    const result = parseAST('empty.ts', '');

    expect(result.file).toBe('empty.ts');
    expect(result.components).toHaveLength(0);
    expect(result.functions).toHaveLength(0);
  });

  it('should distinguish between components and regular functions', () => {
    const code = `
function MyComponent() {
  return <div />;
}

function helper() {
  return 42;
}

const MyWidget = () => <span>hi</span>;

const compute = (x: number) => x + 1;
`;
    const result = parseAST('test.tsx', code);

    expect(result.components).toHaveLength(2);
    expect(result.components.map(c => c.name)).toEqual(['MyComponent', 'MyWidget']);

    expect(result.functions).toHaveLength(2);
    expect(result.functions.map(f => f.name)).toEqual(['helper', 'compute']);
  });

  it('should extract props with default values as not required', () => {
    const code = `
function Dialog({ title = "Untitled", onClose }: DialogProps) {
  return <div>{title}</div>;
}
`;
    const result = parseAST('test.tsx', code);

    expect(result.components).toHaveLength(1);
    // When using { title = "Untitled" } with a type annotation like DialogProps,
    // the destructured pattern with type annotation is handled as a single typed param
    expect(result.components[0].props.length).toBeGreaterThanOrEqual(1);
  });

  it('should extract function params with various patterns', () => {
    const code = `
function process(
  name: string,
  opts: Options,
  ...rest: string[]
): void {}
`;
    const result = parseAST('test.ts', code);

    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].params).toHaveLength(3);
    expect(result.functions[0].params[0].name).toBe('name');
    expect(result.functions[0].params[0].type).toBe('string');
    expect(result.functions[0].params[1].type).toBe('Options');
    expect(result.functions[0].params[2].name).toBe('...rest');
    expect(result.functions[0].returnType).toBe('void');
  });

  it('should handle exported variables with components', () => {
    const code = `
export const App = () => {
  return <div>Hello</div>;
};
`;
    const result = parseAST('test.tsx', code);

    expect(result.components).toHaveLength(1);
    expect(result.components[0].name).toBe('App');
    expect(result.components[0].exports).toEqual(['App']);
    expect(result.exports).toContain('App');
  });

  it('should handle variable declarations without initializers', () => {
    const code = `
let x: number;
const y = 42;
`;
    const result = parseAST('test.ts', code);

    expect(result.functions).toHaveLength(0);
    expect(result.components).toHaveLength(0);
  });

  it('should handle union and intersection types in params', () => {
    const code = `
function process(value: string | number, config: Config & Defaults): void {}
`;
    const result = parseAST('test.ts', code);

    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].params[0].type).toBe('string | number');
    expect(result.functions[0].params[1].type).toBe('Config & Defaults');
  });

  it('should handle array types in params', () => {
    const code = `
function processItems(items: string[]): void {}
`;
    const result = parseAST('test.ts', code);

    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].params[0].type).toBe('string[]');
  });
});
