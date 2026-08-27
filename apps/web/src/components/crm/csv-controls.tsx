"use client";

import { useRef, useState } from "react";

import type { CrmResource } from "@/app/app/[teamSlug]/_crm-data";

import styles from "./crm.module.css";

type JobResponse = Readonly<{
    data?: Readonly<{
        id?: string;
        status?: "queued" | "processing" | "completed" | "failed";
        download_url?: string | null;
        created_rows?: number;
        updated_rows?: number;
        failed_rows?: number | readonly unknown[];
    }>;
    message?: string;
}>;

const responseBody = async (response: Response): Promise<JobResponse> => {
    const body = await response.json() as JobResponse;
    if (!response.ok) throw new Error(body.message ?? "The CSV request failed.");
    return body;
};

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitForJob = async (url: string, initial: JobResponse): Promise<JobResponse> => {
    let body = initial;
    while (body.data?.status === "queued" || body.data?.status === "processing") {
        await wait(750);
        body = await responseBody(await fetch(url, { cache: "no-store" }));
    }
    if (body.data?.status === "failed") throw new Error("The CSV job failed.");
    return body;
};

export const CsvControls = ({ resource }: Readonly<{ resource: CrmResource }>) => {
    const fileInput = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState<"export" | "import" | null>(null);
    const [message, setMessage] = useState("");

    const startExport = async () => {
        setBusy("export");
        setMessage("");
        try {
            const started = await responseBody(await fetch(`/api/v1/${resource}/exports`, { method: "POST" }));
            if (started.data?.id === undefined) throw new Error("The export job was not created.");
            const body = await waitForJob(`/api/v1/${resource}/exports/${started.data.id}`, started);
            if (body.data?.download_url === null || body.data?.download_url === undefined) {
                throw new Error("The export did not produce a downloadable file.");
            }
            window.location.assign(body.data.download_url);
            setMessage("Export ready. Your download has started.");
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "The export failed.");
        } finally {
            setBusy(null);
        }
    };

    const startImport = async () => {
        const file = fileInput.current?.files?.[0];
        if (file === undefined) {
            setMessage("Choose a CSV file first.");
            return;
        }
        setBusy("import");
        setMessage("");
        const data = new FormData();
        data.set("file", file);
        try {
            const started = await responseBody(await fetch(`/api/v1/${resource}/imports`, { method: "POST", body: data }));
            if (started.data?.id === undefined) throw new Error("The import job was not created.");
            const body = await waitForJob(`/api/v1/${resource}/imports/${started.data.id}`, started);
            const failed = typeof body.data?.failed_rows === "number" ? body.data.failed_rows : (body.data?.failed_rows?.length ?? 0);
            setMessage(`Imported ${body.data?.created_rows ?? 0} new and ${body.data?.updated_rows ?? 0} existing records${failed > 0 ? `; ${failed} rows failed` : ""}.`);
            if (fileInput.current !== null) fileInput.current.value = "";
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "The import failed.");
        } finally {
            setBusy(null);
        }
    };

    return (
        <details className={styles.csvControls}>
            <summary className={styles.secondaryAction}>↕ Import / Export</summary>
            <section aria-labelledby="csv-heading">
                <div><h2 id="csv-heading">Import / Export</h2><p>Transfer workspace records with a UTF-8 CSV.</p></div>
                <button type="button" onClick={startExport} disabled={busy !== null}>{busy === "export" ? "Preparing..." : "Export records"}</button>
                <label><span>Import CSV</span><input ref={fileInput} type="file" accept=".csv,text/csv" disabled={busy !== null} /></label>
                <button type="button" onClick={startImport} disabled={busy !== null}>{busy === "import" ? "Importing..." : "Start import"}</button>
                {message === "" ? null : <p role="status" className={styles.csvStatus}>{message}</p>}
            </section>
        </details>
    );
};
