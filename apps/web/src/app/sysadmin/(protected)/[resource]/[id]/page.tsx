import Link from "next/link";
import { notFound } from "next/navigation";

import styles from "@/components/sysadmin/admin.module.css";
import { ResourceEditor } from "@/components/sysadmin/resource-editor";
import { findAdminRecord, getAdminResource } from "@/server/sysadmin/resources";

type Properties = Readonly<{ params: Promise<{ resource: string; id: string }> }>;
const DetailPage = async ({ params }: Properties) => {
    const { resource: slug, id } = await params; const resource = getAdminResource(slug); if (resource === undefined) notFound();
    const record = await findAdminRecord(resource, id); if (record === undefined) notFound();
    return <><header className={styles.header}><div><p>{resource.label}</p><h1>{String(record[resource.title] ?? id)}</h1></div><Link className={styles.button} href={`/sysadmin/${slug}`}>Back to list</Link></header><ResourceEditor resource={resource} record={record} /></>;
};
export default DetailPage;
