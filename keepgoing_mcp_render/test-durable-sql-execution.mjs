import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(new URL("./sql/durable_jobs.sql", import.meta.url), "utf8");
const db = await PGlite.create();
try {
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to service_role;");
  await db.exec(migration);
  await db.exec(migration); // The same release must be safe to reapply.
  const reserve = `select * from public.reserve_keepgoing_job(
    $1::text,$2::text,$3::text,'agents'::text,null::text,null::text,
    6::integer,120000::bigint,30::integer,now()+interval '1 hour',
    now()+interval '1 minute','github-read'::text,$4::text,false)`;
  const id = "kgj_" + "a".repeat(32);
  const owner = "b".repeat(64);
  const policy = "c".repeat(64);
  await db.exec("set role service_role");
  const first = (await db.query(reserve, [id, owner, "same-request", policy])).rows[0];
  const duplicate = (await db.query(reserve, ["kgj_" + "d".repeat(32), owner, "same-request", policy])).rows[0];
  assert.equal(first.job_id, duplicate.job_id);
  assert.equal(first.tool_profile, "github-read");
  assert.equal(first.tool_policy_hash, policy);
  assert.equal(first.tool_write_capable, false);
  assert.equal((await db.query("update keepgoing_jobs set version=version+1 where job_id=$1 and version=1 returning version", [id])).rows.length, 1);
  assert.equal((await db.query("update keepgoing_jobs set version=version+1 where job_id=$1 and version=1 returning version", [id])).rows.length, 0);
  await db.exec("reset role");
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    for (const query of [
      "select * from keepgoing_jobs", "select * from keepgoing_job_events",
      "insert into keepgoing_jobs(job_id) values ('invalid')",
      "update keepgoing_jobs set status='completed'", "delete from keepgoing_jobs",
      "insert into keepgoing_job_events(event_type) values ('blocked')",
      "update keepgoing_job_events set event_type='blocked'", "delete from keepgoing_job_events"
    ]) await assert.rejects(() => db.query(query), /permission denied/);
    await assert.rejects(() => db.query(reserve, [id, owner, "blocked", policy]), /permission denied/);
    await db.exec("reset role");
  }
  // Upgrade from the deployed pre-tool-policy table, retaining an existing row.
  await db.exec("alter table keepgoing_jobs drop column tool_profile, drop column tool_policy_hash, drop column tool_write_capable");
  await db.exec(migration);
  const upgraded = (await db.query("select * from keepgoing_jobs where job_id=$1", [id])).rows[0];
  assert.equal(upgraded.tool_profile, "web");
  assert.equal(upgraded.version, 2);
  assert.equal(upgraded.tool_write_capable, false);
  console.log("durable SQL execution passed: fresh install, reapply, upgrade, idempotency, optimistic locking, and role isolation");
} finally {
  await db.close();
}
