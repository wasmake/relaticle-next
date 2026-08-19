import Link from "next/link";
import { notFound } from "next/navigation";

import styles from "@/components/sysadmin/admin.module.css";
import { ResourceEditor } from "@/components/sysadmin/resource-editor";
import { getAdminResource, listAdminRecords } from "@/server/sysadmin/resources";

type Properties = Readonly<{ params: Promise<{ resource: string }>; searchParams: Promise<{ page?: string; q?: string; create?: string }> }>;
const ResourcePage = async ({ params, searchParams }: Properties) => {
    const [{ resource: slug }, query] = await Promise.all([params, searchParams]);
    const resource = getAdminResource(slug); if (resource === undefined) notFound();
    if (query.create === "1") return <><header className={styles.header}><div><p>{resource.label}</p><h1>New record</h1></div><Link className={styles.button} href={`/sysadmin/${slug}`}>Back to list</Link></header><ResourceEditor resource={resource} /></>;
    const data = await listAdminRecords(resource, Number(query.page ?? "1"), query.q ?? "");
    const columns = [resource.id, resource.title, ...resource.fields.map((field) => field.column)].filter((column, index, all) => all.indexOf(column) === index).slice(0, 6);
    const pages = Math.max(1, Math.ceil(data.total / data.perPage));
    return <><header className={styles.header}><div><p>{data.total.toLocaleString()} records</p><h1>{resource.label}</h1></div><Link className={styles.button} href={`/sysadmin/${slug}?create=1`}>Create</Link></header>
        <form className={styles.toolbar}><input name="q" defaultValue={query.q} placeholder={`Search ${resource.label.toLowerCase()}`} /><button type="submit">Search</button></form>
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr>{columns.map((column) => <th key={column}>{column.replaceAll("_", " ")}</th>)}</tr></thead><tbody>{data.records.map((record) => <tr key={String(record[resource.id])}>{columns.map((column, index) => <td key={column}>{index === 0 ? <Link href={`/sysadmin/${slug}/${String(record[resource.id])}`}>{String(record[column] ?? "")}</Link> : String(record[column] ?? "")}</td>)}</tr>)}</tbody></table></div>
        <nav className={styles.pagination}>{data.page > 1 ? <Link href={`?page=${data.page - 1}&q=${encodeURIComponent(query.q ?? "")}`}>Previous</Link> : <span /> }<span>Page {data.page} of {pages}</span>{data.page < pages ? <Link href={`?page=${data.page + 1}&q=${encodeURIComponent(query.q ?? "")}`}>Next</Link> : <span />}</nav>
    </>;
};
export default ResourcePage;
