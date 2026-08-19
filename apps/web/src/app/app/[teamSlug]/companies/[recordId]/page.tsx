import { renderCrmRecordPage } from "../../_record-page";
const CompanyPage = (properties: { params: Promise<{ teamSlug: string; recordId: string }> }) => renderCrmRecordPage("companies", properties);
export default CompanyPage;
