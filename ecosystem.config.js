module.exports = {
  apps: [{
    name: "toto-smm-final-strong",
    script: "./bot.js",
    watch: false,
    autorestart: true,
    max_restarts: 50,
    min_uptime: "10s",
    max_memory_restart: "500M",
    env: { NODE_ENV: "production" },
    error_file: "./logs/error.log",
    out_file: "./logs/out.log",
    log_date_format: "YYYY-MM-DD HH:mm:ss"
  }]
}
