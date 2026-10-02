import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const port = 8792;
const token = "sse-test-only";
const child = spawn(process.execPath, ["server.mjs"], {
  cwd: new URL("../", import.meta.url),
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", PROJECT_CONTROL_TOKEN: token },
  stdio: ["ignore","pipe","pipe"]
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitHealth(){
  for(let i=0;i<50;i++){
    try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return}catch{}
    await sleep(100);
  }
  throw new Error("server did not start");
}

try {
  await waitHealth();
  const controller = new AbortController();
  const stream = await fetch(`http://127.0.0.1:${port}/api/stream`, { signal: controller.signal });
  assert.equal(stream.status, 200);
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let text = "";

  async function readUntil(needle, timeoutMs=4000){
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline){
      const read=reader.read();
      const timeout=sleep(250).then(()=>({timeout:true}));
      const result=await Promise.race([read,timeout]);
      if(result.timeout) continue;
      if(result.done) throw new Error("SSE stream ended before " + needle);
      text += decoder.decode(result.value,{stream:true});
      if(text.includes(needle)) return;
    }
    throw new Error("SSE did not receive " + needle);
  }

  await readUntil('"type":"snapshot"');
  await sleep(300);

  const evt = await fetch(`http://127.0.0.1:${port}/api/events`, {
    method:"POST",
    headers:{"content-type":"application/json","x-project-control-token":token},
    body:JSON.stringify({
      project_id:"project-relay",
      project_name:"Project Relay",
      status:"healthy",
      stage:"SSE persistence test",
      message:"Event delivered after stream remained open",
      source:"test"
    })
  });
  assert.equal(evt.status, 202);
  await readUntil("SSE persistence test");
  controller.abort();
  console.log("sse_ok");
} finally {
  child.kill();
}

