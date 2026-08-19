import { ApiValidationError } from "@/server/api/errors";

import type { CsvRow } from "./types";

export const MAX_CSV_BYTES = 10 * 1024 * 1024;
export const MAX_CSV_ROWS = 50_000;
export const MAX_CSV_COLUMNS = 250;

const csvIssue = (message: string): ApiValidationError =>
    new ApiValidationError([{ path: "file", message }]);

export const parseCsv = (input: string): Readonly<{
    headers: readonly string[];
    rows: readonly CsvRow[];
}> => {
    if (Buffer.byteLength(input, "utf8") > MAX_CSV_BYTES) {
        throw csvIssue("The CSV file must not be larger than 10 MB.");
    }

    const records: string[][] = [];
    let record: string[] = [];
    let field = "";
    let quoted = false;
    let closedQuote = false;

    for (let index = 0; index < input.length; index += 1) {
        const character = input[index];

        if (quoted) {
            if (character === '"') {
                if (input[index + 1] === '"') {
                    field += '"';
                    index += 1;
                } else {
                    quoted = false;
                    closedQuote = true;
                }
            } else {
                field += character;
            }
            continue;
        }

        if (closedQuote && character !== "," && character !== "\n" && character !== "\r") {
            throw csvIssue("Only a delimiter may follow a closing quote.");
        }

        if (character === '"') {
            if (field !== "") {
                throw csvIssue("A quote may only appear at the start of a field.");
            }
            quoted = true;
        } else if (character === ",") {
            record.push(field);
            field = "";
            closedQuote = false;
        } else if (character === "\n" || character === "\r") {
            if (character === "\r" && input[index + 1] === "\n") {
                index += 1;
            }
            record.push(field);
            records.push(record);
            record = [];
            field = "";
            closedQuote = false;
        } else {
            field += character;
        }
    }

    if (quoted) {
        throw csvIssue("The CSV file contains an unterminated quoted field.");
    }
    if (field !== "" || record.length > 0) {
        record.push(field);
        records.push(record);
    }
    if (records.length === 0) {
        throw csvIssue("The CSV file is empty.");
    }

    const headerRecord = records[0] ?? [];
    const headers = headerRecord.map((header, index) =>
        (index === 0 ? header.replace(/^\uFEFF/u, "") : header).trim(),
    );

    if (headers.length > MAX_CSV_COLUMNS) {
        throw csvIssue(`The CSV file must not contain more than ${MAX_CSV_COLUMNS} columns.`);
    }
    if (headers.some((header) => header === "")) {
        throw csvIssue("CSV headers must not be empty.");
    }
    if (new Set(headers).size !== headers.length) {
        throw csvIssue("CSV headers must be unique.");
    }

    const dataRecords = records.slice(1).filter((values) =>
        values.some((value) => value !== ""),
    );
    if (dataRecords.length > MAX_CSV_ROWS) {
        throw csvIssue(`The CSV file must not contain more than ${MAX_CSV_ROWS} rows.`);
    }

    const rows = dataRecords.map((values, index): CsvRow => {
        if (values.length !== headers.length) {
            throw csvIssue(`CSV row ${index + 2} has ${values.length} columns; expected ${headers.length}.`);
        }

        return Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ""]));
    });

    return { headers, rows };
};

const safeSpreadsheetValue = (value: string): string =>
    /^[\t\r]*[=+\-@]/u.test(value) ? `'${value}` : value;

const serializeCell = (value: string): string => {
    const safe = safeSpreadsheetValue(value);

    return /[",\r\n]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

export const serializeCsv = (
    headers: readonly string[],
    rows: readonly Readonly<Record<string, string>>[],
): string =>
    `${[headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))]
        .map((values) => values.map(serializeCell).join(","))
        .join("\r\n")}\r\n`;
