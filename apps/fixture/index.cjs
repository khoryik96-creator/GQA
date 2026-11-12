"use strict";
const http = require("node:http");
http.createServer((req, res) => {
  if (req.method !== "GET") { res.writeHead(405).end("Method not allowed"); return; }
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "gqa-fixture" })); return;
  }
  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html lang="en"><head><title>GQA Smoke Fixture</title></head>
      <body><main><h1>GQA Read-Only Smoke Target</h1>
      <p>This is a controlled local test fixture.</p>
      <button type="button" id="show-details">Show details</button>
      <p id="details" hidden>Fixture details visible</p>
      <label for="email">Email</label><input type="email" id="email" />
      <button type="button" id="preview">Preview email</button>
      <p id="preview-result" hidden>Email preview ready</p>
      </main><script>
        document.getElementById("show-details").addEventListener("click", () => {
          document.getElementById("details").hidden = false;
        });
        document.getElementById("preview").addEventListener("click", () => {
          if (document.getElementById("email").value.includes("@")) {
            document.getElementById("preview-result").hidden = false;
          }
        });
      </script></body></html>`);
    return;
  }
  res.writeHead(404).end("Not found");
}).listen(8081, "0.0.0.0", () => console.log("fixture ready"));
