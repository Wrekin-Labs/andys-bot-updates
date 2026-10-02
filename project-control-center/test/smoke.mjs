import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const port = 8791;
const token = "smoke-test-only";
const child = spawn(process.execPath, ["server.mjs"], {
  cwd: new URL("../", import.meta.url),
  env: { ...process.env, PORT:String(port), HOST:"127.0.0.1", PROJECT_CONTROL_TOKEN:token },
  stdio:["ignore","pipe","pipe"]
});

async function waitHealth() {
  for (let i=0;i<50;i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return await r.json();
    } catch {}
    await new Promise(r => setTimeout(r,100));
  }
  throw new Error("server did not start");
}

try {
  const health = await waitHealth();
  assert.equal(health.ok, true);
  assert.equal(health.version, "0.3.0");

  const unauthorized = await fetch(`http://127.0.0.1:${port}/api/events`, {
    method:"POST",
    headers:{"content-type":"application/json"},
    body:"{}"
  });
  assert.equal(unauthorized.status, 401);

  const event = await fetch(`http://127.0.0.1:${port}/api/events`, {
    method:"POST",
    headers:{"content-type":"application/json","x-project-control-token":token},
    body:JSON.stringify({project_id:"keepgoing",project_name:"KeepGoing",status:"working",stage:"Smoke test",progress:42,message:"Live event accepted",source:"test",attempt:1,max_attempts:12})
  });
  assert.equal(event.status, 202);

  const created = await fetch(`http://127.0.0.1:${port}/api/engineering/tasks`, {
    method:"POST",
    headers:{"content-type":"application/json","x-project-control-token":token},
    body:JSON.stringify({title:"Smoke engineering session",project_name:"Project Control Center",repository:"Wrekin-Labs/andys-bot-updates"})
  });
  assert.equal(created.status, 201);
  const task = (await created.json()).task;
  assert.equal(task.phase, "planning");

  const transitioned = await fetch(`http://127.0.0.1:${port}/api/engineering/tasks/${task.id}/transition`, {
    method:"POST",
    headers:{"content-type":"application/json","x-project-control-token":token},
    body:JSON.stringify({phase:"coding",summary:"Smoke implementation"})
  });
  assert.equal(transitioned.status, 200);

  const snap = await (await fetch(`http://127.0.0.1:${port}/api/snapshot`)).json();
  assert.equal(snap.projects.find(p => p.id === "keepgoing").status, "working");
  assert.equal(snap.engineering_tasks.find(t => t.id === task.id).phase, "coding");
  assert.equal(snap.engineering_totals.active, 1);

  const page = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  assert.match(page, /Autonomous engineering control plane/);

  console.log("smoke_ok", JSON.stringify({ version:health.version, task:task.id, projects:snap.projects.length }));
} finally {
  child.kill();
}
