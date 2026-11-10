# AEGIS 展台站点（静态产物 + 联动总线）的容器镜像。
#
# 构建上下文需要：site/（Vite 产物）、server.mjs、alert_bus.mjs。
# 构建发生在外面（Windows 上 npm run build），镜像只负责跑，不装依赖。
#
#   docker build -t aegis-stage:2026 .
#   docker compose up -d
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    PORT=2026 \
    HOST=0.0.0.0

COPY --chown=node:node server.mjs alert_bus.mjs ./
COPY --chown=node:node site ./site

# 总线状态落盘目录：compose 把命名卷挂在这里，镜像里先把属主给 node，
# 否则 Docker 新建卷默认 root:root，非 root 进程写不进去
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 2026

# 容器自己探活，compose 的 depends_on / 重启策略才有依据
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:2026/api/commands/health || exit 1

CMD ["node", "server.mjs"]
