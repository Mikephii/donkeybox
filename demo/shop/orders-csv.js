// Orders as CSV, for the admin download and the weekly email (DK-43).
const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

export function toCsv(rows) {
  const head = ["id", "customer", "total", "placed"];
  return [head.join(","), ...rows.map((r) => head.map((k) => cell(r[k])).join(","))].join("\n") + "\n";
}
