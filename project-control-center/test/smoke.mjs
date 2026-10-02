import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const port = 8791;
const child = spawn(process.execPath, ["server.mjs"], {
  cwd: new URL("../", import.meta.url),
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", PROJECT_CONTROL_TOKEN: "smoke-test-only" },
  stdio: ["ignore","pipe","pipe"]
});
async function waitHealth(){
  for(let i=0;i<40;i++){
    try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return await r.json()}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  throw new Error("server did not start");
}
try{
  const health=await waitHealth(); assert.equal(health.ok,true);
  const unauthorized=await fetch(`http://127.0.0.1:${port}/api/events`,{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
  assert.equal(unauthorized.status,401);
  const event=await fetch(`http://127.0.0.1:${port}/api/events`,{
    method:"POST",
    headers:{"content-type":"application/json","x-project-control-token":"smoke-test-only"},
    body:JSON.stringify({project_id:"keepgoing",project_name:"KeepGoing",status:"working",stage:"Smoke test",progress:42,message:"Live event accepted",source:"test",attempt:1,max_attempts:12})
  });
  assert.equal(event.status,202);
  const snap=await (await fetch(`http://127.0.0.1:${port}/api/snapshot`)).json();
  const kg=snap.projects.find(p=>p.id==="keepgoing");
  assert.equal(kg.status,"working"); assert.equal(kg.progress,42); assert.equal(snap.totals.active,1);
  const page=await (await fetch(`http://127.0.0.1:${port}/`)).text();
  assert.match(page,/Project Control Center/);
  console.log("smoke_ok", JSON.stringify({health,keepgoing:kg.status,progress:kg.progress,projects:snap.projects.length}));
} finally {
  child.kill();
}


