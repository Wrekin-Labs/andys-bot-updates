import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import assert from "node:assert/strict";
const port=8793, token="persist-test-only";
const state=new URL("./persist-state.json",import.meta.url);
await rm(state,{force:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function start(){
 return spawn(process.execPath,["server.mjs"],{cwd:new URL("../",import.meta.url),env:{...process.env,PORT:String(port),HOST:"127.0.0.1",PROJECT_CONTROL_TOKEN:token,PROJECT_CONTROL_STATE_FILE:state.pathname.replace(/^\/(.:)/,"$1")},stdio:"ignore"});
}
async function health(){for(let i=0;i<50;i++){try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return}catch{}await sleep(100)}throw new Error("server did not start")}
let child=start();
try{
 await health();
 const post=await fetch(`http://127.0.0.1:${port}/api/events`,{method:"POST",headers:{"content-type":"application/json","x-project-control-token":token},body:JSON.stringify({project_id:"giglink",project_name:"GigLink",status:"working",stage:"Persistence proof",message:"Survives restart",source:"test"})});
 assert.equal(post.status,202);
 await sleep(500);
 child.kill(); await sleep(500);
 child=start(); await health();
 const snap=await(await fetch(`http://127.0.0.1:${port}/api/snapshot`)).json();
 const item=snap.projects.find(p=>p.id==="giglink");
 assert.equal(item.status,"working"); assert.equal(item.stage,"Persistence proof");
 assert.ok(snap.recent_events.some(e=>e.project_id==="giglink"&&e.stage==="Persistence proof"));
 console.log("persistence_ok");
}finally{child.kill();await rm(state,{force:true})}
