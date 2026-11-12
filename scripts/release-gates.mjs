import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root=path.resolve(import.meta.dirname,"..");
const read=(file)=>fs.readFileSync(path.join(root,file),"utf8");
const check=(predicate,message)=>{
 if(!predicate){process.stderr.write("FAIL: "+message+"\n");process.exitCode=1;}
 else process.stdout.write("PASS: "+message+"\n");
};
const compose=read("compose.yaml");
const runner=read("apps/host-broker/launcher.cjs");
const broker=read("apps/host-broker/index.cjs");
const gate=read("apps/host-broker/job-store.cjs");
const auth=read("apps/api/auth.go");
const rbac=read("apps/api/rbac.go");
const docs=read("README.md");

check(/GQA_ADMIN_PASSWORD:\s*\$\{GQA_ADMIN_PASSWORD:\?/.test(compose),
 "compose refuses missing administrator password");
check(/GQA_RUNNER_TOKEN:\s*\$\{GQA_RUNNER_TOKEN:\?/.test(compose),
 "compose refuses missing internal runner secret");
check(/127\.0\.0\.1:8080:8080/.test(compose) &&
      /127\.0\.0\.1:3000:3000/.test(compose),
 "API and UI are published on local loopback only");
check(/qa_private:\s*\n\s*internal:\s*true/.test(compose) &&
      /qa_execution:\s*\n[\s\S]*?internal:\s*true/.test(compose),
 "both browser execution networks are configured internal-only");
check(!compose.includes("/var/run/docker.sock") &&
      !read("apps/runner/Dockerfile").includes("/var/run/docker.sock") &&
      !read("apps/api/Dockerfile").includes("/var/run/docker.sock"),
 "Docker socket is not mounted into the app or default runner");
check(/"run","--rm","--pull","never"/.test(runner) &&
      /"--read-only"/.test(runner) &&
      /"--cap-drop","ALL"/.test(runner) &&
      /"--network",project\+"_qa_execution"/.test(runner),
 "disposable jobs use fixed no-pull image and constrained network");
check(/"http:\/\/fixture:8081,http:\/\/fixture-renamed:8081"/.test(broker),
 "optional broker accepts only bundled fixture targets");
check(/validStoredSpec\(j\.spec\)/.test(gate) &&
      /this\.store\.recoverable/.test(read("apps/host-broker/scheduler.cjs")),
 "journal is validated before restart replay and interruption reconciliation");
check(/sessionIdentity/.test(auth) && /validOrigin/.test(auth),
 "Go API includes authenticated sessions and write-origin checks");
check(/allowedProject/.test(rbac) && /canAccess/.test(rbac),
 "server-side per-project role enforcement is present");
check(!/prototype API is \*\*unauthenticated/.test(docs) &&
      /v0\.11 RC1/.test(docs) && /Do not expose GQA publicly/.test(docs),
 "README describes current authenticated local-only build");
check(fs.existsSync(path.join(root,"SECURITY.md")) &&
      fs.existsSync(path.join(root,"docs/RELEASE_CHECKLIST.md")),
 "security and release acceptance documents exist");
if(process.exitCode){process.stderr.write("Release gates FAILED.\n");}
else process.stdout.write("Release static gates passed (not a security certification).\n");
