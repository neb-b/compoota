declare module "bun:sqlite" {
  export type SQLQueryBindings = string | number | bigint | boolean | null | Uint8Array;

  export type Changes = {
    changes: number;
    lastInsertRowid: number | bigint;
  };

  export class Statement<T = unknown> {
    get(...bindings: SQLQueryBindings[]): T | undefined;
    all(...bindings: SQLQueryBindings[]): T[];
    run(...bindings: SQLQueryBindings[]): Changes;
  }

  export class Database {
    constructor(filename?: string);
    exec(sql: string): void;
    prepare<T = unknown>(sql: string): Statement<T>;
    query<T = unknown>(sql: string): Statement<T>;
    transaction<T extends (...args: never[]) => unknown>(callback: T): T;
    close(): void;
  }
}
