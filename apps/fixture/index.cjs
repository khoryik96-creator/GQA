const http = require("node:http");
http.createServer((req, res) => {
  if (req.method !== "GET") {
    res.writeHead(405).end("Method not allowed"); return;
  }
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "gqa-fixture" })); return;
  }
  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<!doctype html><html lang='en'><head><title>GQA Smoke Fixture</title></head><body><main><h1>GQA Read-Only Smoke Target</h1><p>This is a controlled local testing fixture.</p></main></body></html>");
    return;
  }
  res.writeHead(404).end("Not found");
}).listen(8081, "0.0.0.0", () => console.log("fixture ready"));
