// PM2 config. Quick reference (run as the `bot` user inside ~/mrmoo-bot):
//   pm2 start ecosystem.config.js        start
//   pm2 save                             persist process list for reboot restore
//   pm2 status | pm2 monit               state / live CPU+RAM
//   pm2 logs mrmoo-bot --lines 100       tail logs (Ctrl+C leaves the bot running)
//   pm2 restart mrmoo-bot --update-env   apply edited env below
//   pm2 stop mrmoo-bot | pm2 delete mrmoo-bot
//   pm2 install pm2-logrotate            stop logs from filling the disk
module.exports = {
  apps: [
    {
      name: 'mrmoo-bot',
      cwd: __dirname,

      // xvfb-run starts a virtual display, runs node on it, and tears Xvfb (and Chrome) down on exit.
      script: 'xvfb-run',
      args: ['-a', '--server-args=-screen 0 1366x768x24', 'node', 'index.js'],
      interpreter: 'none',

      autorestart: true,
      exp_backoff_restart_delay: 5000, // 5s, 8s, 12s ... on repeated crashes
      min_uptime: '60s',
      max_restarts: 20,
      stop_exit_codes: [2], // exit 2 = login wall / bad config: stay stopped instead of hammering the site
      kill_timeout: 15000, // give the bot time to close Chrome on stop/restart
      cron_restart: '0 */6 * * *', // fresh Chrome every 6h, Chrome leaks memory over days
      time: true, // timestamp every log line

      env: {
        TARGET_URLS: '', // comma-separated feed/group URLs
        KEYWORDS: 'REPLACE_ME', // regex, e.g. 'word1|word2'
        COMMENT_TEXT: 'REPLACE_ME',
        DRY_RUN: '1', // set to '0' only after a dry run logs what you expect
        POLL_MS: '90000',
        MAX_COMMENTS_PER_HOUR: '6',
        MIN_GAP_MS: '120000',
        // PROXY_SERVER: 'http://user:pass@host:port', // optional; datacenter IPs get challenged more often
      },
    },
  ],
};
