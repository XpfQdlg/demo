import { Client } from "ssh2";
const host = process.env.SSH_HOST;
const username = process.env.SSH_USER || "root";
const password = process.env.SSH_PASS;
const cmd = process.argv.slice(2).join(" ") || "echo ok";
const conn = new Client();
conn.on("ready", () => {
  conn.exec(cmd, (err, stream) => {
    if (err) { console.error(err.message); conn.end(); process.exit(1); }
    let out = "", errout = "";
    stream.on("data", (d) => (out += d));
    stream.stderr.on("data", (d) => (errout += d));
    stream.on("close", (code) => {
      process.stdout.write(out);
      if (errout) process.stderr.write(errout);
      conn.end();
      process.exit(code || 0);
    });
  });
}).on("error", (e) => { console.error("SSH", e.message); process.exit(1); })
  .connect({ host, port: 22, username, password, readyTimeout: 20000 });
