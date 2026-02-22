import type { SpecIR } from "../../spec/schema.js";

const quoteIdentifier = (name: string): string => `"${name.replace(/"/g, '""')}"`;

const mapColumnType = (columnType: string): string => {
  const normalized = columnType.toLowerCase();

  if (normalized.includes("int")) {
    return "INTEGER";
  }
  if (normalized.includes("bool")) {
    return "INTEGER";
  }
  if (normalized.includes("real") || normalized.includes("float") || normalized.includes("double")) {
    return "REAL";
  }
  if (normalized.includes("timestamp") || normalized.includes("date")) {
    return "TEXT";
  }
  return "TEXT";
};

const renderTableSql = (table: SpecIR["data_model"]["tables"][number]): string => {
  const sortedColumns = [...table.columns].sort((left, right) => left.name.localeCompare(right.name));
  const columnLines = sortedColumns.map(
    (column) => `  ${quoteIdentifier(column.name)} ${mapColumnType(column.type)}`
  );

  const lines = columnLines.length > 0 ? columnLines : ['  "id" INTEGER'];

  return `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(table.name)} (\n${lines.join(",\n")}\n);`;
};

export const generateTablesMigrationSql = (ir: SpecIR): string => {
  const sortedTables = [...ir.data_model.tables].sort((left, right) => left.name.localeCompare(right.name));

  const statements = sortedTables.map((table) => renderTableSql(table));

  if (statements.length === 0) {
    return "-- no tables defined in spec\n";
  }

  return `${statements.join("\n\n")}\n`;
};
