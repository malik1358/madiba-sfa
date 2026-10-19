import { DEFAULT_DEV_PORT, killProcessOnPort } from "./dev-port.mjs";

const port = Number(process.env.PORT || DEFAULT_DEV_PORT);

killProcessOnPort(port);
console.log(`Port ${port} is free. You can run: npm run dev`);
