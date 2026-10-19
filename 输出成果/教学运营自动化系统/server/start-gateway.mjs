import { createTaskGateway } from "./task-gateway.mjs";

const host = process.env.LOCAL_GATEWAY_HOST ?? "127.0.0.1";
const port = Number(process.env.LOCAL_GATEWAY_PORT ?? 4174);

createTaskGateway().listen(port, host, () => {
  console.log(`本机任务网关已启动：http://${host}:${port}`);
});
