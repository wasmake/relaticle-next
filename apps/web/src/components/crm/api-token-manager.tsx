"use client";

import { useActionState } from "react";

import type { TokenState } from "@/app/app/[teamSlug]/settings/api-tokens/actions";

import styles from "./crm.module.css";

type Action = (state: TokenState, data: FormData) => Promise<TokenState>;
type Token = Readonly<{ id: string; name: string; abilities: readonly string[]; lastUsedAt: string | null; expiresAt: string | null; createdAt: string | null }>;
const initial: TokenState = { status: "idle", message: "" };

const Revoke = ({ action, token }: { action: Action; token: Token }) => {
    const [, formAction] = useActionState(action, initial);
    return <form action={formAction}><input type="hidden" name="intent" value="delete" /><input type="hidden" name="id" value={token.id} /><button className={styles.deleteButton} type="submit">Revoke</button></form>;
};

export const ApiTokenManager = ({ action, tokens }: Readonly<{ action: Action; tokens: readonly Token[] }>) => {
    const [state, formAction] = useActionState(action, initial);
    return <><section className={styles.panel}><h2>Create API token</h2><form action={formAction} className={styles.settingsForm}><input type="hidden" name="intent" value="create" /><label>Name<input name="name" required maxLength={255} placeholder="Reporting integration" /></label><label>Expires on<input name="expires_at" type="date" /></label><fieldset className={styles.wideField}><legend>Abilities</legend>{["read", "create", "update", "delete"].map((ability) => <label className={styles.checkboxLabel} key={ability}><input type="checkbox" name="abilities" value={ability} defaultChecked={ability === "read"} /> {ability}</label>)}</fieldset><button type="submit">Create token</button></form>{state.message !== "" ? <p role="status" className={state.status === "error" ? styles.error : styles.success}>{state.message}</p> : null}{state.token !== undefined ? <output className={styles.tokenOutput}>{state.token}</output> : null}</section><section className={styles.panel}><h2>Active tokens</h2>{tokens.length === 0 ? <p>No API tokens for this workspace.</p> : <ul className={styles.settingsList}>{tokens.map((token) => <li key={token.id}><span><strong>{token.name}</strong><small>{token.abilities.join(", ")} · {token.lastUsedAt === null ? "Never used" : `Used ${new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(token.lastUsedAt))}`}{token.expiresAt === null ? "" : ` · Expires ${new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(token.expiresAt))}`}</small></span><Revoke action={action} token={token} /></li>)}</ul>}</section></>;
};
