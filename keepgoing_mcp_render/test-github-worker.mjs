import assert from "node:assert/strict";
import { createGithubWorker, normaliseRepoList } from "./github_worker.js";

assert.deepEqual(
  normaliseRepoList("chipblock2/project-relay, chipblock2/project-relay,chipblock2/andys-bot-updates"),
  ["chipblock2/project-relay", "chipblock2/andys-bot-updates"]
);
assert.throws(() => normaliseRepoList("bad"), /Invalid GitHub repository/);

const calls = [];
const shaMain = "a".repeat(40);
const shaFile = "b".repeat(40);
const shaCommit = "c".repeat(40);

const worker = createGithubWorker({
  token: "gh-test",
  repositories: ["chipblock2/project-relay"],
  branchPrefix: "keepgoing/",
  fetchImpl: async (url, init) => {
    calls.push({ url, init });
    const parsed = new URL(url);
    const path = parsed.pathname;

    if (path === "/repos/chipblock2/project-relay" && init.method === "GET") {
      return reply({ full_name: "chipblock2/project-relay", default_branch: "main", private: true, archived: false, disabled: false });
    }
    if (path.endsWith("/git/ref/heads/main")) {
      return reply({ object: { sha: shaMain } });
    }
    if (path.endsWith("/git/refs") && init.method === "POST") {
      const body = JSON.parse(init.body);
      assert.equal(body.ref, "refs/heads/keepgoing/feature-x");
      assert.equal(body.sha, shaMain);
      return reply({ ref: body.ref, object: { sha: shaMain } }, 201);
    }
    if (path.endsWith("/contents/src/index.js") && init.method === "GET") {
      return reply({
        type: "file",
        path: "src/index.js",
        sha: shaFile,
        size: 18,
        encoding: "base64",
        content: Buffer.from("export const x = 1;").toString("base64"),
        html_url: "https://github.example/file"
      });
    }
    if (path.endsWith("/contents/src/index.js") && init.method === "PUT") {
      const body = JSON.parse(init.body);
      assert.equal(body.branch, "keepgoing/feature-x");
      assert.equal(body.sha, shaFile);
      assert.equal(Buffer.from(body.content, "base64").toString("utf8"), "export const x = 2;");
      return reply({
        content: { sha: "d".repeat(40), html_url: "https://github.example/new-file" },
        commit: { sha: shaCommit }
      });
    }
    if (path.endsWith("/compare/main...keepgoing%2Ffeature-x")) {
      return reply({
        status: "ahead",
        ahead_by: 1,
        behind_by: 0,
        total_commits: 1,
        files: [{ filename: "src/index.js", status: "modified", additions: 1, deletions: 1, changes: 2 }]
      });
    }
    if (path.endsWith("/pulls") && init.method === "POST") {
      const body = JSON.parse(init.body);
      assert.equal(body.head, "keepgoing/feature-x");
      assert.equal(body.base, "main");
      return reply({ number: 9, state: "open", title: body.title, html_url: "https://github.example/pr/9", head: { ref: body.head }, base: { ref: body.base } }, 201);
    }
    if (path === "/search/code") {
      assert.match(parsed.searchParams.get("q"), /repo:chipblock2\/project-relay/);
      return reply({ total_count: 1, items: [{ name: "index.js", path: "src/index.js", sha: shaFile, html_url: "https://github.example/file" }] });
    }
    if (path.endsWith("/contents/src")) {
      return reply([{ type: "file", name: "index.js", path: "src/index.js", sha: shaFile, size: 18, html_url: "https://github.example/file" }]);
    }

    return reply({ message: "not found" }, 404);
  }
});

const info = await worker.repositoryInfo("chipblock2/project-relay");
assert.equal(info.default_branch, "main");

const branch = await worker.createBranch({
  repository: "chipblock2/project-relay",
  branch: "feature-x"
});
assert.equal(branch.branch, "keepgoing/feature-x");

const file = await worker.getFile({
  repository: "chipblock2/project-relay",
  path: "src/index.js",
  ref: "main"
});
assert.equal(file.content, "export const x = 1;");

const listing = await worker.listPath({
  repository: "chipblock2/project-relay",
  path: "src"
});
assert.equal(listing[0].path, "src/index.js");

const search = await worker.searchCode({
  repository: "chipblock2/project-relay",
  query: "createServer"
});
assert.equal(search.total_count, 1);

const updated = await worker.putFile({
  repository: "chipblock2/project-relay",
  path: "src/index.js",
  content: "export const x = 2;",
  message: "Update index",
  branch: "keepgoing/feature-x",
  expectedSha: shaFile
});
assert.equal(updated.commit_sha, shaCommit);

const diff = await worker.compare({
  repository: "chipblock2/project-relay",
  baseRef: "main",
  headRef: "keepgoing/feature-x"
});
assert.equal(diff.ahead_by, 1);

const pr = await worker.openPullRequest({
  repository: "chipblock2/project-relay",
  head: "keepgoing/feature-x",
  title: "Feature X"
});
assert.equal(pr.number, 9);

assert.throws(
  () => worker.getFile({ repository: "someone/else", path: "x" }),
  /not allowlisted/
);
await assert.rejects(
  () => worker.putFile({
    repository: "chipblock2/project-relay",
    path: "../secret",
    content: "x",
    message: "bad",
    branch: "main"
  }),
  /Invalid repository path/
);
await assert.rejects(
  () => worker.putFile({
    repository: "chipblock2/project-relay",
    path: "x.txt",
    content: "x",
    message: "bad",
    branch: "../main"
  }),
  /Invalid branch/
);

assert.ok(calls.every((call) => call.init.headers.Authorization === "Bearer gh-test"));

console.log("github worker tests passed");

function reply(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return data; }
  };
}
