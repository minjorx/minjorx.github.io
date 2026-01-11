---
title: Superset简单安装
createTime: 2026/01/11 18:05:36
permalink: /blog/3exghpi0/
---
# Superset简单安装

> 本地简单安装
> 环境：windows, docker, pgsql

## 1. 生成密钥
   
运行命令生成密钥，并放进文件superset_config.py中
```bash
# 生成密钥

```

## 2. 制作镜像

编写Dockerfile文件
```bash
# 将配置文件superset_config.py cp到镜像/app/pythonpath目录下
```

构建镜像
```bash
docker build -t apache/superset:latest . superset:<version>
```

## 3. 运行镜像
```bash

```

## 4. 初始化

进入镜像
1. 初始化数据库表
```bash
docker exec -it superset_app superset db upgrade
```
2. 导入示例数据(可选)
```bash
docker exec -it superset_app superset load_examples
```
3. 创建管理员用户
```bash
# 根据提示输入
docker exec -it superset_app superset fab create-admin
```
