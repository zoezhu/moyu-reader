#!/bin/zsh
cd -- "${0:A:h}"
if ! command -v npm >/dev/null 2>&1; then
  print "没有找到 npm。请先安装 Node.js，再重新打开本文件。"
  read "?按回车退出…"
  exit 1
fi
if [[ ! -d node_modules ]]; then
  npm install || exit 1
fi
npm run dev -- --open
