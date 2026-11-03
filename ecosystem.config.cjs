module.exports = {
  apps: [{
    name: "alcor-api",
    cwd: __dirname,
    script: "tools/start-local.mjs",
    args: JSON.parse(process.env.ALCOR_LOCAL_ARGS || "[]"),
    interpreter: "node",
    instances: 1,
    exec_mode: "fork",
    kill_timeout: 60000,
    min_uptime: 10000,
    max_restarts: 3,
    restart_delay: 3000,
    time: true,
  }],
};
