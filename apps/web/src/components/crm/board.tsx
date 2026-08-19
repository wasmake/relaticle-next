"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import type { BoardData } from "@/app/app/[teamSlug]/_board-data";

import styles from "./crm.module.css";

type MoveAction = (input: { id: string; fieldCode: string; optionId: string; orderedIds: readonly string[] }) => Promise<{ ok: boolean; message?: string }>;

export const CrmBoard = ({ action, initial, teamSlug }: Readonly<{ action: MoveAction; initial: BoardData; teamSlug: string }>) => {
    const [data, setData] = useState(initial);
    const [message, setMessage] = useState("");
    const [pending, startTransition] = useTransition();
    const move = (id: string, optionId: string) => {
        if (data.fieldCode === "") return;
        const columns = data.columns.map((column) => ({ ...column, cards: column.cards.filter((card) => card.id !== id) }));
        const card = data.columns.flatMap((column) => column.cards).find((candidate) => candidate.id === id);
        if (card === undefined) return;
        const target = columns.find((column) => column.id === optionId);
        if (target === undefined) return;
        target.cards = [...target.cards, { ...card, optionId }];
        const next = { ...data, columns };
        setData(next);
        setMessage("");
        startTransition(async () => {
            const result = await action({ id, fieldCode: data.fieldCode, optionId, orderedIds: columns.flatMap((column) => column.cards.map((item) => item.id)) });
            if (!result.ok) { setData(data); setMessage(result.message ?? "The card could not be moved."); }
            else setMessage("Board saved.");
        });
    };
    return <>
        <header className={styles.header}><div><p className={styles.eyebrow}>Drag and drop board</p><h1>{initial.resource === "tasks" ? "Task board" : "Opportunity pipeline"}</h1><p><Link href={`/app/${teamSlug}/${initial.resource}`}>List</Link> · Board</p></div></header>
        <p className={styles.boardStatus} role="status">{pending ? "Saving…" : message}</p>
        <div className={styles.board} aria-label={`${initial.resource} board`}>{data.columns.map((column) => <section key={column.id} className={styles.boardColumn} onDragOver={(event) => event.preventDefault()} onDrop={(event) => move(event.dataTransfer.getData("text/plain"), column.id)}><header><h2>{column.label}</h2><span>{column.cards.length}</span></header><div>{column.cards.map((card) => <article key={card.id} draggable onDragStart={(event) => event.dataTransfer.setData("text/plain", card.id)}><Link href={`/app/${teamSlug}/${initial.resource}/${card.id}`}><strong>{card.title}</strong><span>{card.detail}</span></Link></article>)}</div></section>)}</div>
    </>;
};
