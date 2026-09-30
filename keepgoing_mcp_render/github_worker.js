import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REF_RE = /^[A-Za-z0-9._\/-]{1,200}$/;
const BRANCH_SUFFIX_RE = /^[A-Za-z0-9._\/-]{1,180}$/;

export function createGithubWorker({
  token,
  repositories,
  branchPrefix = "keepgoing/",
  apiBase = "https://api.github.com",
  fetchImpl = globalThis.fetch
} = {}) {
  const apiToken = String(token || "").trim();
  if (!apiToken) throw new Error("GitHub worker token required");
  if (typeof fetchImpl !== "function") throw new Error("fetch implementation required");

  const allowedRepos = new Map();
  for (const value of normaliseRepoList(repositories)) {
    allowedRepos.set(value.toLowerCase(), value);
  }
  if (!allowedRepos.size) throw new Error("At least one GitHub repository must be allowlisted");

  const safePrefix = normaliseBranchPrefix(branchPrefix);
  const base = String(apiBase || "https://api.github.com").replace(/\/$/, "");

  async function request(path, init = {}) {
    const response = await fetchImpl(base + path, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + apiToken,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        ...(init.headers || {})
      }
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(
        data?.message
          ? "GitHub worker request failed: " + String(data.message).slice(0, 220)
          : "GitHub worker request failed (" + response.status + ")"
      );
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function repo(value) {
    const wanted = String(value || "").trim();
    if (!REPO_RE.test(wanted)) throw new Error("Invalid GitHub repository");
    const exact = allowedRepos.get(wanted.toLowerCase());
    if (!exact) throw new Error("GitHub repository is not allowlisted");
    return exact;
  }

  function ref(value, fallback = null) {
    const text = String(value || fallback || "").trim();
    if (!text) return null;
    if (!REF_RE.test(text) || text.includes("..") || text.startsWith("/") || text.endsWith("/")) {
      throw new Error("Invalid GitHub ref");
    }
    return text;
  }

  function path(value, { allowEmpty = false } = {}) {
    const raw = String(value || "").replace(/\\/g, "/").trim();
    if (!raw && allowEmpty) return "";
    if (!raw || raw.startsWith("/") || raw.includes("\0")) throw new Error("Invalid repository path");
    const parts = raw.split("/").filter(Boolean);
    if (!parts.length || parts.some((part) => part === "." || part === "..")) {
      throw new Error("Invalid repository path");
    }
    return parts.join("/");
  }

  function safeBranch(value) {
    let branch = String(value || "").trim();
    if (!branch) throw new Error("branch required");
    if (!branch.startsWith(safePrefix)) {
      if (!BRANCH_SUFFIX_RE.test(branch) || branch.includes("..")) {
        throw new Error("Invalid branch name");
      }
      branch = safePrefix + branch.replace(/^\/+/, "");
    }
    if (!REF_RE.test(branch) || branch.includes("..")) throw new Error("Invalid branch name");
    return branch;
  }

  async function repositoryInfo(repository) {
    const r = repo(repository);
    const data = await request("/repos/" + encodeRepo(r), { method: "GET" });
    return {
      full_name: data.full_name,
      default_branch: data.default_branch,
      private: Boolean(data.private),
      archived: Boolean(data.archived),
      disabled: Boolean(data.disabled)
    };
  }

  async function listPath({ repository, path: target = "", ref: refValue = null }) {
    const r = repo(repository);
    const p = path(target, { allowEmpty: true });
    const revision = ref(refValue);
    const query = revision ? "?ref=" + encodeURIComponent(revision) : "";
    const url = "/repos/" + encodeRepo(r) + "/contents/" + encodeContentPath(p) + query;
    const data = await request(url, { method: "GET" });
    const rows = Array.isArray(data) ? data : [data];
    return rows.map((item) => ({
      type: item.type,
      name: item.name,
      path: item.path,
      sha: item.sha,
      size: Number(item.size || 0),
      html_url: item.html_url || null
    }));
  }

  async function getFile({ repository, path: target, ref: refValue = null }) {
    const r = repo(repository);
    const p = path(target);
    const revision = ref(refValue);
    const query = revision ? "?ref=" + encodeURIComponent(revision) : "";
    const data = await request(
      "/repos/" + encodeRepo(r) + "/contents/" + encodeContentPath(p) + query,
      { method: "GET" }
    );
    if (Array.isArray(data) || data?.type !== "file") throw new Error("Requested path is not a file");
    if (String(data.encoding || "") !== "base64") throw new Error("Unsupported GitHub file encoding");
    const bytes = Buffer.from(String(data.content || "").replace(/\s/g, ""), "base64");
    if (bytes.length > 1_000_000) throw new Error("File exceeds 1 MB KeepGoing worker read limit");
    return {
      path: data.path,
      sha: data.sha,
      size: bytes.length,
      content: bytes.toString("utf8"),
      html_url: data.html_url || null
    };
  }

  async function searchCode({ repository, query, limit = 20 }) {
    const r = repo(repository);
    const q = String(query || "").trim();
    if (!q) throw new Error("query required");
    const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20));
    const data = await request(
      "/search/code?q=" + encodeURIComponent(q + " repo:" + r) +
      "&per_page=" + safeLimit,
      { method: "GET" }
    );
    return {
      total_count: Number(data?.total_count || 0),
      items: (data?.items || []).slice(0, safeLimit).map((item) => ({
        name: item.name,
        path: item.path,
        sha: item.sha,
        html_url: item.html_url || null
      }))
    };
  }

  async function createBranch({ repository, branch, baseRef = null }) {
    const r = repo(repository);
    const info = await repositoryInfo(r);
    if (info.archived || info.disabled) throw new Error("Repository is not writable");
    const newBranch = safeBranch(branch);
    const baseBranch = ref(baseRef, info.default_branch);

    const source = await request(
      "/repos/" + encodeRepo(r) + "/git/ref/heads/" + encodeURIComponent(baseBranch),
      { method: "GET" }
    );
    const sha = String(source?.object?.sha || "");
    if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error("Could not resolve base branch");

    try {
      await request("/repos/" + encodeRepo(r) + "/git/refs", {
        method: "POST",
        body: JSON.stringify({
          ref: "refs/heads/" + newBranch,
          sha
        })
      });
      return { repository: r, branch: newBranch, base: baseBranch, sha, created: true };
    } catch (error) {
      if (Number(error?.status) !== 422) throw error;
      const existing = await request(
        "/repos/" + encodeRepo(r) + "/git/ref/heads/" + encodeURIComponent(newBranch),
        { method: "GET" }
      );
      return {
        repository: r,
        branch: newBranch,
        base: baseBranch,
        sha: String(existing?.object?.sha || ""),
        created: false
      };
    }
  }

  async function putFile({
    repository,
    path: target,
    content,
    message,
    branch,
    expectedSha = null
  }) {
    const r = repo(repository);
    const p = path(target);
    const safe = safeBranch(branch);
    const text = String(content ?? "");
    const bytes = Buffer.from(text, "utf8");
    if (bytes.length > 1_000_000) throw new Error("File exceeds 1 MB KeepGoing worker write limit");
    const commitMessage = String(message || "KeepGoing update " + p).trim().slice(0, 240);
    if (!commitMessage) throw new Error("commit message required");

    const body = {
      message: commitMessage,
      content: bytes.toString("base64"),
      branch: safe
    };
    if (expectedSha) {
      const sha = String(expectedSha).trim();
      if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error("Invalid expected SHA");
      body.sha = sha;
    }

    const data = await request(
      "/repos/" + encodeRepo(r) + "/contents/" + encodeContentPath(p),
      { method: "PUT", body: JSON.stringify(body) }
    );
    return {
      repository: r,
      branch: safe,
      path: p,
      content_sha: data?.content?.sha || null,
      commit_sha: data?.commit?.sha || null,
      html_url: data?.content?.html_url || null
    };
  }

  async function compare({ repository, baseRef, headRef }) {
    const r = repo(repository);
    const baseName = ref(baseRef);
    const headName = ref(headRef);
    if (!baseName || !headName) throw new Error("baseRef and headRef are required");
    const data = await request(
      "/repos/" + encodeRepo(r) + "/compare/" +
      encodeURIComponent(baseName) + "..." + encodeURIComponent(headName),
      { method: "GET" }
    );
    return {
      status: data.status || null,
      ahead_by: Number(data.ahead_by || 0),
      behind_by: Number(data.behind_by || 0),
      total_commits: Number(data.total_commits || 0),
      files: (data.files || []).slice(0, 100).map((file) => ({
        filename: file.filename,
        status: file.status,
        additions: Number(file.additions || 0),
        deletions: Number(file.deletions || 0),
        changes: Number(file.changes || 0),
        previous_filename: file.previous_filename || null
      }))
    };
  }

  async function openPullRequest({
    repository,
    head,
    baseRef = null,
    title,
    body = ""
  }) {
    const r = repo(repository);
    const info = await repositoryInfo(r);
    const headBranch = safeBranch(head);
    const baseBranch = ref(baseRef, info.default_branch);
    if (headBranch === baseBranch) throw new Error("Pull request head and base must differ");

    const data = await request("/repos/" + encodeRepo(r) + "/pulls", {
      method: "POST",
      body: JSON.stringify({
        title: String(title || "").trim().slice(0, 240),
        body: String(body || "").slice(0, 20_000),
        head: headBranch,
        base: baseBranch
      })
    });
    return {
      number: data.number,
      state: data.state,
      title: data.title,
      html_url: data.html_url,
      head: data.head?.ref || headBranch,
      base: data.base?.ref || baseBranch
    };
  }

  return {
    allowedRepositories: () => [...allowedRepos.values()],
    branchPrefix: safePrefix,
    repositoryInfo,
    listPath,
    getFile,
    searchCode,
    createBranch,
    putFile,
    compare,
    openPullRequest
  };
}

export function createGithubWorkerMcpServer(worker) {
  if (!worker) throw new Error("GitHub worker required");
  const server = new McpServer(
    { name: "KeepGoing GitHub Worker", version: "1.0.0" },
    { instructions: "Use only allowlisted repositories. Reads may use any ref. Writes are restricted to KeepGoing-safe branches; do not merge pull requests or modify repository settings." }
  );

  server.registerTool("github_list_repositories", {
    description: "List repositories explicitly allowlisted for this private KeepGoing GitHub worker.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async () => toolResult({ repositories: worker.allowedRepositories(), branch_prefix: worker.branchPrefix }));

  server.registerTool("github_get_repository", {
    description: "Read basic metadata for one allowlisted GitHub repository.",
    inputSchema: { repository: z.string().min(3).max(200) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (args) => toolResult(await worker.repositoryInfo(args.repository)));

  server.registerTool("github_list_path", {
    description: "List a directory or inspect one path in an allowlisted GitHub repository.",
    inputSchema: {
      repository: z.string().min(3).max(200),
      path: z.string().max(1000).default(""),
      ref: z.string().max(200).optional()
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (args) => toolResult(await worker.listPath(args)));

  server.registerTool("github_get_file", {
    description: "Read a UTF-8 text file up to 1 MB from an allowlisted GitHub repository.",
    inputSchema: {
      repository: z.string().min(3).max(200),
      path: z.string().min(1).max(1000),
      ref: z.string().max(200).optional()
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (args) => toolResult(await worker.getFile(args)));

  server.registerTool("github_search_code", {
    description: "Search code within one allowlisted GitHub repository.",
    inputSchema: {
      repository: z.string().min(3).max(200),
      query: z.string().min(1).max(500),
      limit: z.number().int().min(1).max(50).default(20)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (args) => toolResult(await worker.searchCode(args)));

  server.registerTool("github_compare", {
    description: "Compare two refs in an allowlisted GitHub repository and return bounded file statistics.",
    inputSchema: {
      repository: z.string().min(3).max(200),
      baseRef: z.string().min(1).max(200),
      headRef: z.string().min(1).max(200)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (args) => toolResult(await worker.compare(args)));

  server.registerTool("github_create_branch", {
    description: "Create or reuse a KeepGoing-safe branch in an allowlisted GitHub repository. Direct writes to protected/default branches are not permitted.",
    inputSchema: {
      repository: z.string().min(3).max(200),
      branch: z.string().min(1).max(180),
      baseRef: z.string().max(200).optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (args) => toolResult(await worker.createBranch(args)));

  server.registerTool("github_put_file", {
    description: "Create or update one UTF-8 file on a KeepGoing-safe branch. Use expectedSha when updating an existing file to prevent lost updates.",
    inputSchema: {
      repository: z.string().min(3).max(200),
      path: z.string().min(1).max(1000),
      content: z.string().max(1_000_000),
      message: z.string().min(1).max(240),
      branch: z.string().min(1).max(200),
      expectedSha: z.string().max(40).optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async (args) => toolResult(await worker.putFile(args)));

  server.registerTool("github_open_pull_request", {
    description: "Open a pull request from a KeepGoing-safe branch. This tool never merges the pull request.",
    inputSchema: {
      repository: z.string().min(3).max(200),
      head: z.string().min(1).max(200),
      baseRef: z.string().max(200).optional(),
      title: z.string().min(1).max(240),
      body: z.string().max(20_000).default("")
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async (args) => toolResult(await worker.openPullRequest(args)));

  return server;
}

export function normaliseRepoList(value) {
  const values = Array.isArray(value)
    ? value
    : String(value || "").split(",");
  const seen = new Set();
  const out = [];
  for (const item of values) {
    const repo = String(item || "").trim();
    if (!repo) continue;
    if (!REPO_RE.test(repo)) throw new Error("Invalid GitHub repository allowlist entry");
    const key = repo.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(repo);
  }
  return out;
}

function normaliseBranchPrefix(value) {
  let prefix = String(value || "keepgoing/").trim();
  if (!prefix.endsWith("/")) prefix += "/";
  if (!REF_RE.test(prefix.slice(0, -1)) || prefix.includes("..")) {
    throw new Error("Invalid KeepGoing GitHub branch prefix");
  }
  return prefix;
}

function encodeRepo(repo) {
  return repo.split("/").map(encodeURIComponent).join("/");
}

function encodeContentPath(path) {
  if (!path) return "";
  return path.split("/").map(encodeURIComponent).join("/");
}

function toolResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value
  };
}
