import { createServer } from "node:http";
import { WebSocketServer } from "ws";

// Isolated transport fixture: no application credentials, database, or tasks.
const streams = new Set();
const server = createServer((request, response) => {
  if (request.url.startsWith("/events")) {
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    streams.add(response);
    response.once("close", () => streams.delete(response));
    response.write("data: ready\n\n");
    return;
  }
  if (request.url === "/api") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      activeStreams: streams.size,
      host: request.headers.host,
      origin: request.headers.origin,
      protocol: request.headers["x-forwarded-proto"],
    }));
    return;
  }
  response.end("LinkSense development transport fixture");
});
const sockets = new WebSocketServer({ server, path: "/hmr" });
sockets.on("connection", (socket) => socket.on("message", (message) => socket.send(message)));
server.listen(18173, "0.0.0.0");
