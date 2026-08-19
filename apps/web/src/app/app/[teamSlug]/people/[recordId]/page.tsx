import { renderCrmRecordPage } from "../../_record-page";
const PersonPage = (properties: { params: Promise<{ teamSlug: string; recordId: string }> }) => renderCrmRecordPage("people", properties);
export default PersonPage;
