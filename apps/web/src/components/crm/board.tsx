"use client";

import Link from "next/link";
import { useDeferredValue, useState, useTransition, type CSSProperties } from "react";

import type { BoardData } from "@/app/app/[teamSlug]/_board-data";
import type { CrmPageData } from "@/app/app/[teamSlug]/_crm-data";

import { CreateRecordDrawer } from "./create-record-drawer";
import { CrmIcon } from "./icon";
import type { CrmMutationAction } from "./mutation-form";
import styles from "./crm.module.css";

type MoveAction = (input: { id: string; fieldCode: string; optionId: string; orderedIds: readonly string[] }) => Promise<{ ok: boolean; message?: string }>;
type BoardCreateData = Pick<CrmPageData, "companies" | "customFields" | "fieldLabel" | "people" | "resource">;

export const CrmBoard = ({ action, createAction, createData, initial, teamSlug }: Readonly<{ action: MoveAction; createAction: CrmMutationAction; createData: BoardCreateData; initial: BoardData; teamSlug: string }>) => {
    const [data, setData] = useState(initial);
    const [message, setMessage] = useState("");
    const [search, setSearch] = useState("");
    const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase());
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
    const title = initial.resource === "tasks" ? "Tasks" : "Opportunities";
    const columns = data.columns.map((column) => ({ ...column, cards: column.cards.filter((card) => deferredSearch === "" || card.title.toLocaleLowerCase().includes(deferredSearch)) }));
    return <>
        <header className={styles.header}><div><h1>{title}</h1><span className={styles.viewSwitcher}><Link href={`/app/${teamSlug}/${initial.resource}`}>List</Link><strong>Board</strong></span></div><div className={styles.headerActions}><button className={styles.iconAction} type="button" aria-label="Filter board"><CrmIcon name="filter" /></button><label className={styles.tableSearch}><CrmIcon name="search" /><input aria-label={`Search ${title.toLowerCase()} board`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" /></label></div></header>
        <p className={styles.boardStatus} role="status">{pending ? "Saving…" : message}</p>
        <div className={styles.board} aria-label={`${initial.resource} board`}>{columns.map((column) => <section key={column.id} className={styles.boardColumn} style={column.color === undefined ? undefined : { "--column-color": column.color } as CSSProperties} onDragOver={(event) => event.preventDefault()} onDrop={(event) => move(event.dataTransfer.getData("text/plain"), column.id)}><header><h2>{column.label} <span>{column.cards.length}</span></h2><CreateRecordDrawer action={createAction} compact customFieldValues={data.fieldCode === "" ? {} : { [data.fieldCode]: { id: column.id } }} data={{ companies: createData.companies, customFields: createData.customFields, fieldLabel: createData.fieldLabel, people: createData.people, resource: createData.resource }} triggerLabel={`Add ${initial.resource === "tasks" ? "task" : "opportunity"} to ${column.label}`} /></header><div>{column.cards.map((card) => <article key={card.id} draggable onDragStart={(event) => event.dataTransfer.setData("text/plain", card.id)}><Link href={`/app/${teamSlug}/${initial.resource}/${card.id}`}><strong>{card.title}</strong>{card.description === "" ? null : <p>{card.description}</p>}{card.detail === "" ? null : <span className={styles.boardDetail}><CrmIcon name="building" />{card.detail}</span>}<footer>{card.badges.map((badge) => <span key={badge.label} data-tone={badge.tone}>{badge.label}</span>)}{card.assignees.length === 0 ? null : <span className={styles.boardAssignees}>{card.assignees.map((name) => <i key={name} title={name}>{name.split(/\s+/u).map((word) => word[0]).join("").slice(0, 2)}</i>)}</span>}</footer></Link></article>)}</div></section>)}</div>
    </>;
};
