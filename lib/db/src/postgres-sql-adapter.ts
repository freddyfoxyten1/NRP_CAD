/**
 * Routes were written for SQLite (0/1 flags) but often use `false`/`true` in SQL.
 * Postgres INTEGER columns reject COALESCE(col, false) and `col = true`.
 * Adapt those patterns to 0/1 while leaving native BOOLEAN columns untouched.
 */

const NATIVE_BOOLEAN_COLUMNS = new Set([
  "wanted",
  "bolo",
  "insured",
  "registered",
  "stolen",
  "valid_licence",
]);

function isProtectedColumn(column: string): boolean {
  return NATIVE_BOOLEAN_COLUMNS.has(column.toLowerCase());
}

function boolLiteralToInt(value: string): "0" | "1" {
  return /^t/i.test(value) ? "1" : "0";
}

export function adaptSqlForPostgres(sql: string): string {
  let out = sql;

  // COALESCE(flag, false|true) → COALESCE(flag, 0|1)
  out = out.replace(/,\s*false\s*\)/gi, ", 0)");
  out = out.replace(/,\s*true\s*\)/gi, ", 1)");

  // CASE WHEN … THEN TRUE ELSE … END
  out = out.replace(/\bTHEN\s+TRUE\b/gi, "THEN 1");
  out = out.replace(/\bTHEN\s+FALSE\b/gi, "THEN 0");

  // column = true|false (skip cad civilian/vehicle BOOLEAN columns)
  out = out.replace(
    /(\w+)\s*=\s*(true|false|TRUE|FALSE)\b/g,
    (match, column: string, value: string) => {
      if (isProtectedColumn(column)) return match;
      return `${column} = ${boolLiteralToInt(value)}`;
    },
  );

  // INSERT … VALUES (… FALSE, TRUE …)
  out = out.replace(/\bVALUES\s*\(([^)]*)\)/gi, (_match, inner: string) => {
    const fixed = inner
      .replace(/\bFALSE\b/g, "0")
      .replace(/\bTRUE\b/g, "1")
      .replace(/\bfalse\b/g, "0")
      .replace(/\btrue\b/g, "1");
    return `VALUES (${fixed})`;
  });

  // SET flag = false|true in UPDATE statements
  out = out.replace(
    /\bSET\s+([^;]+)/gi,
    (match, clause: string) => {
      const fixed = clause.replace(
        /(\w+)\s*=\s*(true|false|TRUE|FALSE)\b/g,
        (m: string, column: string, value: string) => {
          if (isProtectedColumn(column)) return m;
          return `${column} = ${boolLiteralToInt(value)}`;
        },
      );
      return `SET ${fixed}`;
    },
  );

  return out;
}
