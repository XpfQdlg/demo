/* 上传构建产物到服务器（密码只从环境变量读） */
import { Client } from "ssh2";
import fs from "node:fs";

const host = process.env.SSH_HOST;
const username = process.env.SSH_USER;
const password = process.env.SSH_PASS;
const local = process.argv[2];
const remote = process.argv[3];
if (!host || !username || !password || !local || !remote) {
  console.error("usage: SSH_HOST= SSH_USER= SSH_PASS= node _upload.mjs <local> <remote>");
  process.exit(1);
}

const conn = new Client();
conn
  .on("ready", () => {
    conn.sftp((err, sftp) => {
      if (err) throw err;
      sftp.fastPut(local, remote, (e) => {
        if (e) throw e;
        console.log(`uploaded ${local} -> ${remote}`);
        conn.end();
      });
    });
  })
  .on("error", (e) => {
    console.error("ssh error:", e.message);
    process.exit(1);
  })
  .connect({ host, port: 22, username, password, readyTimeout: 20000 });
