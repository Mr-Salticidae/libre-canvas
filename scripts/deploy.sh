#!/usr/bin/env bash
# 本地一键部署：构建 + 上传到香港服务器（Git Bash 下运行：npm run deploy）
set -euo pipefail
cd "$(dirname "$0")/.."

npm run build
tar czf - -C dist . | ssh -i ~/.ssh/tiaozhu_hk root@43.128.2.172 \
  "rm -rf /var/www/libre-canvas && mkdir -p /var/www/libre-canvas && tar xzf - -C /var/www/libre-canvas && chown -R www-data:www-data /var/www/libre-canvas && echo '部署完成: canvas.tiaozhuxiansheng.com'"
