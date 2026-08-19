import { renderCrmTrashPage } from "../../_trash-page";
const TaskTrashPage = (properties: { params: Promise<{ teamSlug: string }> }) => renderCrmTrashPage("tasks", properties);
export default TaskTrashPage;
