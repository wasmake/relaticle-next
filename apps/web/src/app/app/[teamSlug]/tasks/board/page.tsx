import { renderBoardPage } from "../../_board-page";
const TaskBoardPage = (properties: { params: Promise<{ teamSlug: string }> }) => renderBoardPage("tasks", properties);
export default TaskBoardPage;
