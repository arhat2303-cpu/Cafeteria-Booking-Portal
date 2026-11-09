declare module 'sql.js/dist/sql-wasm-inline.js' {
  export interface Statement {
    bind(values?: Array<number | string | Uint8Array | null>): boolean;
    step(): boolean;
    getAsObject(params?: Array<number | string | Uint8Array | null>): Record<string, any>;
    free(): boolean;
  }

  export interface SqlJsDatabase {
    exec(sql: string): Array<{ columns: string[]; values: any[][] }>;
    run(sql: string, params?: Array<number | string | Uint8Array | null>): SqlJsDatabase;
    prepare(sql: string): Statement;
    getRowsModified(): number;
    export(): Uint8Array;
    close(): void;
  }

  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => SqlJsDatabase;
  }

  export default function initSqlJs(config?: Record<string, unknown>): Promise<SqlJsStatic>;
}
