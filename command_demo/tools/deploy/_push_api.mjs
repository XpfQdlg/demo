/* 通过 GitHub REST API 提交当前工作树（本机 github.com:443 不通，api.github.com 可达）。
   只在部署/应急时用；token 从 git credential 里取，不打印。 */
import { execFileSync } from "node:child_process";

const OWNER = process.env.GH_OWNER || "XpfQdlg";
const REPO = process.env.GH_REPO || "demo";
const BRANCH = process.env.GH_BRANCH || "main";
const BASE = process.env.GH_BASE_SHA || "fbba16ad4fcdea44f850ae640a40c92de0c4b1e0";
const MESSAGE = process.env.GH_MESSAGE || "上线建筑沙盘与作战地图视觉，补齐四模型值守、平板/扫码参与和公网部署";

function token() {
  const out = execFileSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8",
    stdio: ["pipe", "pipe", "ignore"],
  });
  const m = out.match(/^password=(.+)$/m);
  if (!m) throw new Error("no github token in credential manager");
  return m[1].trim();
}

const TOKEN = token();
const api = async (path, init = {}) => {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: "application/vnd.github+json",
      "user-agent": "aegis-deploy",
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`${init.method || "GET"} ${path} -> ${res.status} ${body?.message || text.slice(0, 200)}`);
  }
  return body;
};

function changed() {
  const raw = execFileSync("git", ["diff", "--name-status", "-z", BASE, "HEAD"], {
    maxBuffer: 50 * 1024 * 1024,
  }).toString("utf8");
  const parts = raw.split("\0").filter(Boolean);
  const out = [];
  for (let i = 0; i < parts.length; ) {
    const st = parts[i++];
    const path = parts[i++];
    out.push({ st: st[0], path });
  }
  return out;
}

function blob(path) {
  const buf = execFileSync("git", ["show", `HEAD:${path}`], {
    maxBuffer: 60 * 1024 * 1024,
  });
  return buf.toString("base64");
}

const repo = await api(`/repos/${OWNER}/${REPO}`);
const head = await api(`/repos/${OWNER}/${REPO}/git/commits/${BASE}`);
console.log(`repo ${repo.full_name}  base ${BASE.slice(0, 7)}  tree ${head.tree.sha.slice(0, 7)}`);

const list = changed();
console.log(`changed ${list.length} files`);

const entries = [];
let done = 0;
for (let i = 0; i < list.length; i += 4) {
  const chunk = list.slice(i, i + 4);
  const results = await Promise.all(
    chunk.map(async ({ st, path }) => {
      if (st === "D") return { path, mode: "100644", type: "blob", sha: null };
      const sha = (await api(`/repos/${OWNER}/${REPO}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: blob(path), encoding: "base64" }),
      })).sha;
      return { path, mode: "100644", type: "blob", sha };
    })
  );
  entries.push(...results);
  done += chunk.length;
  process.stdout.write(`\r  blobs ${done}/${list.length}`);
}
console.log("");

const tree = await api(`/repos/${OWNER}/${REPO}/git/trees`, {
  method: "POST",
  body: JSON.stringify({ base_tree: head.tree.sha, tree: entries }),
});
const commit = await api(`/repos/${OWNER}/${REPO}/git/commits`, {
  method: "POST",
  body: JSON.stringify({
    message: MESSAGE,
    tree: tree.sha,
    parents: [BASE],
    author: { name: "SRLove-git", email: "SRLove-git@users.noreply.github.com", date: new Date().toISOString() },
  }),
});
await api(`/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
  method: "PATCH",
  body: JSON.stringify({ sha: commit.sha, force: false }),
});
console.log(`pushed commit ${commit.sha} to ${BRANCH}`);
