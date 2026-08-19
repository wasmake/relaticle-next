import { renderCrmRecordPage } from "../../_record-page";
const NotePage = (properties: { params: Promise<{ teamSlug: string; recordId: string }> }) => renderCrmRecordPage("notes", properties);
export default NotePage;
