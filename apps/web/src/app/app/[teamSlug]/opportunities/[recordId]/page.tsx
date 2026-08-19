import { renderCrmRecordPage } from "../../_record-page";
const OpportunityPage = (properties: { params: Promise<{ teamSlug: string; recordId: string }> }) => renderCrmRecordPage("opportunities", properties);
export default OpportunityPage;
