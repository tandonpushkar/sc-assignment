const schemas = {
  "Change order": [
    "Change order number",
    "Prior contract (USD)",
    "Change (USD)",
    "Revised contract (USD)",
  ],
  Invoice: [
    "Supplier",
    "Invoice number",
    "Date",
    "Purchase order",
    "Total (USD)",
  ],
  "Purchase order": [
    "Supplier",
    "Purchase order",
    "Date",
    "Item",
    "Quantity",
    "Total (USD)",
  ],
  Receipt: ["Merchant", "Date", "Tax (USD)", "Total (USD)"],
};
const aliases = {
  "Change order number": [
    "change order #",
    "change order no",
    "change order number",
    "change order",
    "co #",
    "co no",
    "co number",
  ],
  "Prior contract (USD)": [
    "prior contract",
    "prior contract sum",
    "prior contract amount",
    "previous contract",
    "previous contract sum",
    "original contract",
    "original contract sum",
    "original contract amount",
  ],
  "Change (USD)": [
    "change amount",
    "change order amount",
    "net change",
    "net change amount",
    "amount of change",
    "change",
    "adjustment",
    "deduction",
    "deduction amount",
    "decrease",
    "credit",
    "credit amount",
    "addition",
    "additive",
    "increase",
  ],
  "Revised contract (USD)": [
    "revised contract",
    "revised contract sum",
    "revised contract amount",
    "new contract sum",
    "new contract amount",
    "adjusted contract sum",
    "contract sum to date",
  ],
  Supplier: ["vendor", "vendor name", "supplier", "supplier name", "sold by", "bill from", "remit to"],
  Merchant: ["merchant", "merchant name", "vendor", "store", "store name", "retailer"],
  "Invoice number": [
    "invoice #",
    "invoice no",
    "invoice number",
    "invoice id",
    "invoice",
    "inv #",
    "inv no",
    "inv number",
  ],
  "Purchase order": [
    "po #",
    "po",
    "po no",
    "po number",
    "purchase order",
    "purchase order #",
    "purchase order no",
    "purchase order number",
    "customer po",
  ],
  Date: [
    "date",
    "invoice date",
    "order date",
    "po date",
    "receipt date",
    "issue date",
    "date issued",
    "transaction date",
    "purchase date",
  ],
  Item: ["item", "item description", "description", "material"],
  Quantity: ["quantity", "quantity ordered", "qty", "qty ordered"],
  "Tax (USD)": ["tax", "sales tax", "total tax", "tax amount", "vat", "gst", "hst"],
  "Total (USD)": [
    "invoice total",
    "amount due",
    "total due",
    "balance due",
    "order total",
    "receipt total",
    "grand total",
    "total amount",
    "total price",
    "total usd",
    "total",
  ],
};
// Aliases whose value is a deduction even when printed without a sign.
const deductions = new Set(["deduction", "deduction amount", "decrease", "credit", "credit amount"]);
// Unpaid balances can legitimately differ from an invoice's face total.
const balances = new Set(["amount due", "total due", "balance due"]);
const ID_FIELDS = new Set(["Change order number", "Invoice number", "Purchase order"]);
const TEXT_FIELDS = new Set(["Supplier", "Merchant", "Item"]);
const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10,
  november: 11, december: 12,
};
const missingToken = (value) =>
  /^(?:n\/?a|unknown|not provided|tbd|[-–\u2014]*)$/i.test(value.trim());

// Canonical label text: "P.O. Number", "PO#" and "Sales Tax (8.25%)" become "po number", "po #", "sales tax".
function labelKey(text) {
  return text
    .toLowerCase()
    .replace(/\(?\s*\d+(?:\.\d+)?\s*%\s*\)?/g, " ")
    .replace(/\./g, "")
    .replace(/#/g, " # ")
    .replace(/[^\p{L}\p{N}# ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
// True when two strings differ by at most one substitution, insertion, deletion or adjacent swap.
function withinOneEdit(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length)
    return (
      a.slice(i + 1) === b.slice(i + 1) ||
      (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2))
    );
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return short.slice(i) === long.slice(i + 1);
}
const lookups = new Map();
function lookupFor(kind) {
  if (!lookups.has(kind)) {
    const byKey = new Map(
      schemas[kind].flatMap((label) => aliases[label].map((alias) => [alias, label])),
    );
    lookups.set(kind, {
      exact: (key) => byKey.get(key),
      // OCR often garbles one letter of a label ("Prion contract"). Accept it only when one field fits.
      fuzzy(key) {
        if (byKey.has(key)) return byKey.get(key);
        if (key.length < 9) return undefined;
        const hits = new Set(
          [...byKey].filter(([alias]) => alias.length >= 9 && withinOneEdit(key, alias)).map(([, label]) => label),
        );
        return hits.size === 1 ? [...hits][0] : undefined;
      },
    });
  }
  return lookups.get(kind);
}
const CURRENCY_WORD = /\b(?:usd|us\$)\b|us\$/gi;
function normalize(field, raw) {
  const value = raw.trim().replace(/\s+/g, " ");
  if (missingToken(value)) return null;
  if (field.endsWith("(USD)")) return normalizeMoney(value);
  if (field === "Date") return normalizeDate(value);
  if (ID_FIELDS.has(field)) return value.toLowerCase().replace(/[\s#\-_./]+/g, "");
  if (TEXT_FIELDS.has(field))
    return value.toLowerCase().replace(/&/g, " and ").replace(/[^\p{L}\p{N} ]+/gu, "").replace(/\s+/g, " ").trim();
  return value.toLowerCase();
}
function normalizeMoney(input) {
  let value = input
    .replace(/[\u2212\u2012\u2013\u2014]/g, "-")
    .replace(CURRENCY_WORD, "")
    .replace(/\(\s*\)/g, "")
    // A trailing remark such as "(net 30)" is not part of the amount; "(5.00)" still is.
    .replace(/(?<=\S)\s*\([^()]*[a-z][^()]*\)\s*$/i, "")
    .replace(/(\d),\s+(\d{3})/g, "$1,$2")
    // "$-5.00" is "-$5.00".
    .replace(/^\$\s*([+-])\s*/, "$1$")
    .trim();
  let negative = false;
  const suffix = /\s*(cr|dr|-)$/i.exec(value);
  if (suffix) {
    negative = suffix[1].toLowerCase() !== "dr";
    value = value.slice(0, suffix.index).trim();
  }
  const wrapped = /^[$\s]*\(\s*(.+?)\s*\)$/.exec(value);
  if (wrapped) {
    negative = !negative;
    value = wrapped[1];
  }
  const sign = /^([+-])\s*/.exec(value);
  if (sign) {
    negative = negative !== (sign[1] === "-");
    value = value.slice(sign[0].length);
  }
  const match = /^\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const magnitude =
    match[1].replace(/,/g, "").replace(/^0+(?=\d)/, "") + "." + (match[2] || "").padEnd(2, "0");
  return negative && magnitude !== "0.00" ? "-" + magnitude : magnitude;
}
function isoDate(year, month, day) {
  const iso = [String(year).padStart(4, "0"), String(month).padStart(2, "0"), String(day).padStart(2, "0")].join("-");
  const date = new Date(iso + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().startsWith(iso) ? iso : null;
}
function normalizeDate(value) {
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(value);
  if (m) return isoDate(+m[1], +m[2], +m[3]);
  // Numeric day-first and month-first dates are accepted only when the order is unambiguous.
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(value);
  if (m) {
    const [a, b] = [+m[1], +m[2]];
    if (a > 12 && b <= 12) return isoDate(+m[3], b, a);
    if (b > 12 && a <= 12) return isoDate(+m[3], a, b);
    return a === b ? isoDate(+m[3], a, b) : null;
  }
  const clean = value.replace(/,/g, " ").replace(/\./g, " ").replace(/\s+/g, " ").trim();
  m = /^([a-z]+) (\d{1,2})(?:st|nd|rd|th)? (\d{4})$/i.exec(clean);
  if (m && MONTHS[m[1].toLowerCase()]) return isoDate(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  m = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+) (\d{4})$/i.exec(clean);
  if (m && MONTHS[m[2].toLowerCase()]) return isoDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  return null;
}
// Find a labeled value on one line. Returns the field, matched label key and raw value text.
const isTyped = (label) => label.endsWith("(USD)") || label === "Date";
const COLON = /^(.+?)\s*[:：=]\s*(.*?)\s*$/;
const COLUMNS = /^(.+?)(?:\t+| {2,}| +[–-] +)(.*?)\s*$/;
function matchLine(row, kind, next) {
  const look = lookupFor(kind);
  for (const pattern of [COLON, COLUMNS]) {
    const parts = pattern.exec(row);
    if (!parts) continue;
    const key = labelKey(parts[1]);
    const label = look.fuzzy(key);
    if (!label) continue;
    const raw = parts[2].trim();
    if (!raw && isTyped(label) && next !== undefined && normalize(label, next) !== null)
      return { label, key, raw: next, onNext: true };
    return { label, key, raw };
  }
  // No separator at all: "Total $1,250.00", "INVOICE #55" or a bare "Total" above its amount.
  const tokens = row.replace(/#(?=\S)/g, "# ").split(/\s+/);
  for (let n = Math.min(5, tokens.length); n >= 1; n--) {
    const key = labelKey(tokens.slice(0, n).join(" "));
    const label = look.exact(key);
    if (!label) continue;
    const raw = tokens.slice(n).join(" ");
    // Without a separator, only a single identifier-shaped token with a digit may follow the label.
    const idLike = ID_FIELDS.has(label) && /(#|no|number|id)$/.test(key) && /^(?=.*\d)[\w#./-]{1,24}$/.test(raw);
    if (!raw)
      return isTyped(label) && next !== undefined && normalize(label, next) !== null
        ? { label, key, raw: next, onNext: true }
        : null;
    if ((isTyped(label) && normalize(label, raw) !== null) || (idLike && !missingToken(raw)))
      return { label, key, raw };
  }
  return null;
}
function review(record) {
  const fields = schemas[record.kind];
  if (!fields) throw Error("Unknown record kind: " + record.kind);
  const candidates = Object.fromEntries(fields.map((label) => [label, []]));
  for (const [sourceIndex, doc] of record.docs.entries()) {
    doc.pages.forEach((page, pageIndex) => {
      const lines = String(page.text ?? "")
        .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
        .split(/\r\n|[\r\n]/)
        .map((line) => line.replace(/^[\s|*•·>]+/, "").replace(/[\s|]+$/, ""));
      lines.forEach((row, lineIndex) => {
        // Look past one blank line for an amount printed under its label.
        let nextIndex = lineIndex + 1;
        if (lines[nextIndex] === "") nextIndex++;
        const next = lines[nextIndex]?.trim() || undefined;
        const hit = matchLine(row, record.kind, next);
        if (!hit) return;
        const { label, key, raw, onNext } = hit;
        let value = normalize(label, raw);
        if (deductions.has(key) && value && value !== "0.00" && !value.startsWith("-"))
          value = "-" + value;
        const at = onNext ? nextIndex : lineIndex;
        candidates[label].push({
          sourceIndex,
          file: doc.name,
          page: pageIndex + 1,
          line: at + 1,
          raw,
          method: page.lineMethods?.[at] ?? page.method,
          value,
          alias: key,
        });
      });
    });
  }
  const results = fields.map((label) => {
    let evidence = candidates[label];
    // Partial-payment balances and invoice face totals can legitimately differ.
    const balance = (e) => balances.has(e.alias);
    if (
      record.kind === "Invoice" &&
      label === "Total (USD)" &&
      evidence.some((e) => !balance(e) && !missingToken(e.raw))
    ) {
      evidence = evidence.filter((e) => !balance(e));
    }
    const present = evidence.filter((e) => !missingToken(e.raw));
    const values = new Set(
      present.map((e) => e.value).filter((v) => v !== null),
    );
    let issue = null;
    if (!present.length) issue = "Missing";
    else if (values.size > 1) issue = "Conflict";
    else if (present.some((e) => e.value === null)) issue = "Check format";
    const decision = record.decisions[label];
    return {
      label,
      evidence,
      issue,
      status: decision ? "Reviewed" : issue || "Extracted",
      value:
        decision?.value ??
        (issue
          ? ""
          : label === "Change (USD)"
            ? present[0].value
            : present[0].raw),
    };
  });
  if (record.kind === "Change order") {
    const revised = results.find((f) => f.label === "Revised contract (USD)");
    const checks = contractChecks(candidates, record.docs.length);
    if (checks.length) {
      revised.checks = checks;
      if (!revised.issue) {
        revised.issue = "Amount mismatch";
        if (revised.status !== "Reviewed") {
          revised.status = revised.issue;
          revised.value = "";
        }
      }
    }
  }
  return results;
}
// Reconcile each printed document independently. Never fill a missing operand from a different copy.
function contractChecks(candidates, sourceCount) {
  const checks = [];
  const labels = [
    "Prior contract (USD)",
    "Change (USD)",
    "Revised contract (USD)",
  ];
  for (let index = 0; index < sourceCount; index++) {
    const operands = labels.map((label) => {
      const entries = candidates[label].filter(
        (e) => e.sourceIndex === index && !missingToken(e.raw),
      );
      return entries.length &&
        entries[0].value !== null &&
        entries.every((e) => e.value === entries[0].value)
        ? entries[0]
        : null;
    });
    if (operands.some((e) => !e)) continue;
    const [prior, change, printed] = operands.map((e) =>
      BigInt(e.value.replace(".", "")),
    );
    const sum = prior + change;
    if (sum === printed) continue;
    const digits = (sum < 0n ? -sum : sum).toString().padStart(3, "0");
    const expected =
      (sum < 0n ? "-" : "") + digits.slice(0, -2) + "." + digits.slice(-2);
    checks.push({
      expected,
      inputs: operands.map((e, i) => ({ ...e, label: labels[i] })),
    });
  }
  return checks;
}
function reviewQueue(records) {
  return records.flatMap((record) =>
    review(record)
      .filter((field) => field.issue)
      .map((field) => ({ recordId: record.id, title: record.title, field })),
  );
}
function resolve(record, label, value) {
  if (!schemas[record.kind].includes(label) || normalize(label, value) === null)
    throw Error("Enter a valid value for this field.");
  return {
    ...record,
    decisions: {
      ...record.decisions,
      [label]: { value: value.trim(), at: new Date().toISOString() },
    },
  };
}
function attach(record, doc) {
  if (
    record.docs.some(
      (d) =>
        d.name === doc.name &&
        JSON.stringify(d.pages) === JSON.stringify(doc.pages),
    )
  )
    return record;
  return { ...record, docs: [...record.docs, doc], decisions: {} };
}
const flagged = (f) =>
  ["Missing", "Conflict", "Check format", "Amount mismatch"].includes(f.status);
module.exports = {
  schemas,
  review,
  reviewQueue,
  normalize,
  resolve,
  attach,
  flagged,
};
