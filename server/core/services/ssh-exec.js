// Non-interactive, one-command SSH execution shared by container collection
// and fabric correlation. The auth handler deliberately makes one real attempt
// only: old network devices can lock an account after ssh2 retries methods.
const SSH_ALGORITHMS = Object.freeze({
  kex: ["curve25519-sha256", "curve25519-sha256@libssh.org", "ecdh-sha2-nistp256", "ecdh-sha2-nistp384", "ecdh-sha2-nistp521", "diffie-hellman-group-exchange-sha256", "diffie-hellman-group-exchange-sha1", "diffie-hellman-group14-sha256", "diffie-hellman-group14-sha1", "diffie-hellman-group1-sha1"],
  serverHostKey: ["ssh-ed25519", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521", "rsa-sha2-512", "rsa-sha2-256", "ssh-rsa", "ssh-dss"],
  cipher: ["aes128-gcm@openssh.com", "aes256-gcm@openssh.com", "aes128-ctr", "aes192-ctr", "aes256-ctr", "aes128-cbc", "3des-cbc"],
  hmac: ["hmac-sha2-256", "hmac-sha2-512", "hmac-sha1"],
});

function oneAttemptAuth(username, password) {
  let attempted = false;
  return (methodsLeft, _partial, next) => {
    if (methodsLeft === null) return next("none");
    if (attempted) return next(false);
    attempted = true;
    if (password && methodsLeft.includes("password")) return next({ type: "password", username, password });
    if (password && methodsLeft.includes("keyboard-interactive")) {
      return next({ type: "keyboard-interactive", username, prompt(_n, _i, _l, prompts, done) { done(prompts.map((prompt) => (prompt.prompt || "").toLowerCase().includes("pass") ? password : "")); } });
    }
    next(false);
  };
}

function executeSsh({ SSHClient, ip, port = 22, username, password, command, timeoutMs = 12000, jump = null }) {
  return new Promise((resolve, reject) => {
    const connection = new SSHClient(); let jumpConnection = null; let out = ""; let err = ""; let done = false;
    const finish = (callback, value) => { if (done) return; done = true; try { connection.end(); } catch {} try { jumpConnection?.end(); } catch {} callback(value); };
    const timer = setTimeout(() => finish(reject, new Error("ssh-exec-timeout")), timeoutMs);
    const fail = (error) => { clearTimeout(timer); finish(reject, error); };
    connection.on("ready", () => connection.exec(command, (error, stream) => {
      if (error) return fail(error);
      stream.on("data", (data) => { out += data; });
      stream.stderr.on("data", (data) => { err += data; });
      stream.on("close", () => { clearTimeout(timer); finish(resolve, { out, err }); });
    }));
    connection.on("error", fail);
    const target = { readyTimeout: timeoutMs, hostVerifier: () => true, algorithms: SSH_ALGORITHMS, authHandler: oneAttemptAuth(username, password) };
    if (!jump?.host) return connection.connect({ host: ip, port: parseInt(port, 10) || 22, username, ...target });
    jumpConnection = new SSHClient();
    jumpConnection.on("ready", () => jumpConnection.forwardOut("127.0.0.1", 0, ip, parseInt(port, 10) || 22, (error, stream) => error ? fail(error) : connection.connect({ sock: stream, username, ...target })));
    jumpConnection.on("error", fail);
    jumpConnection.connect({ host: jump.host, port: parseInt(jump.port, 10) || 22, username: jump.user || username, readyTimeout: timeoutMs, hostVerifier: () => true, algorithms: SSH_ALGORITHMS, authHandler: oneAttemptAuth(jump.user || username, jump.password) });
  });
}

module.exports = { SSH_ALGORITHMS, executeSsh, oneAttemptAuth };
