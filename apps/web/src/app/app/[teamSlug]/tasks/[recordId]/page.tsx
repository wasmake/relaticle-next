import { renderCrmRecordPage } from "../../_record-page";
const TaskPage = (properties: { params: Promise<{ teamSlug: string; recordId: string }> }) => renderCrmRecordPage("tasks", properties);
export default TaskPage;
