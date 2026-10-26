import { test } from "node:test";
import assert from "node:assert/strict";
import { toCsv } from "../orders-csv.js";

test("a header row, then one row per order", () => {
  const csv = toCsv([{ id: 1, customer: "Rosa", total: 9.5, placed: "2026-10-12" }]);
  assert.equal(csv, "id,customer,total,placed\n1,Rosa,9.5,2026-10-12\n");
});

test("quotes cells with commas and quotes", () => {
  assert.match(toCsv([{ id: 2, customer: 'Sam "O" Neil, Jr', total: 1, placed: "x" }]), /"Sam ""O"" Neil, Jr"/);
});
