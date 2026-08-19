import { renderCrmResourcePage, type CrmRouteProperties } from "../_resource-page";

const TasksPage = (properties: CrmRouteProperties) =>
    renderCrmResourcePage("tasks", properties);

export default TasksPage;
