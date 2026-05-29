declare module "@babel/traverse" {
  interface Traverse {
    (
      ast: import("@babel/types").Node,
      visitors: Record<string, (path: any) => void>,
    ): void;
    default: Traverse;
  }

  const traverse: Traverse;
  export default traverse;
}
