"use strict";
process.on("message", (job) => {
  process.send({
    kind: "result",
    result: {checks:[{name:"Echo fixture",status:"passed",detail:String(job.kind),duration_ms:0}],
      evidence:{worker_lifecycle:"single_job_process"},screenshot_base64:""}
  }, () => process.exit(0));
});
