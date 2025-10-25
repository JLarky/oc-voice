// Minimal Bun & bun:test shims for project type checking
interface BunShim {
  argv: string[];
  file(path: string): { text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> };
  write(path: string, data: any): Promise<any>;
  serve(opts: any): { port: number };
}
declare const Bun: BunShim;

declare module 'bun:test' {
  export const describe: (name: string, fn: () => any) => void;
  export const it: (name: string, fn: () => any) => void;
  export const test: (name: string, fn: () => any) => void;
  export const expect: any;
}
export {};