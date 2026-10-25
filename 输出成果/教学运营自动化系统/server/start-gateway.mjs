import { createTaskGateway, gatewayListenOptions } from "./task-gateway.mjs";

const { host, port } = gatewayListenOptions();

createTaskGateway().listen(port, host, () => {
  console.log(`本机任务网关已启动：http://${host}:${port}`);
});
