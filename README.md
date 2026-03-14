# Minjor's Pages

个人技术博客与在线工具集，由 [VuePress](https://vuejs.org/) + [VuePress Theme Plume](https://github.com/pengzhanbo/vuepress-theme-plume) 驱动。

## 项目简介

这是一个**个人技术博客** + **在线工具箱**混合项目：

### 🛠️ 在线工具
- **记账本** - 简单易用的网页记账工具
- **统计记账本** - 带统计功能的记账工具
- **同步记账本** - 支持数据同步的记账工具

### 📝 博客内容
- **Spring 生态** - Spring Boot、MicroMeter Tracing 等
- **中间件** - Superset 安装教程等
- **开发相关** - 常用网站、工具推荐
- **模板** - Markdown 写作模板

### 技术栈
- **VuePress 2.0** - 静态网站生成器
- **Vite** - 下一代构建工具
- **TypeScript** - 类型安全
- **ECharts** - 数据可视化
- **Vue 3** - 渐进式前端框架

## 安装

```sh
npm install
```

## 本地开发

```sh
# 启动开发服务器
npm run docs:dev
# 构建生产版本
npm run docs:build
# 本地预览构建结果
npm run docs:preview
# 更新 VuePress 和主题
npm run vp-update
```

## 部署到 GitHub Pages

主题已配置 GitHub Actions (`.github/workflows/docs-deploy.yml`)，部署前需进行以下设置：

1. ** Actions 权限**
   - 进入 `Settings > Actions > General`
   - 滚动到页面底部，在 `Workflow permissions` 中勾选 `Read and write permissions`
   - 点击保存

2. **Pages 配置**
   - 进入 `Settings > Pages`
   - 在 `Build and deployment` 的 `Source` 中选择 `Deploy from a branch`
   - `Branch` 选择 `gh-pages`，点击保存

3. **修改 base 配置** (`docs/.vuepress/config.ts`)
   - 部署到 `https://<用户名>.github.io/` → 无需修改
   - 部署到 `https://<用户名>.github.io/<仓库名>/` → 设置 `base` 为 `"/<仓库名>/"`

自定义域名配置请参考 [GitHub Pages 文档](https://docs.github.com/zh/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages)

## 相关文档

- [VuePress 官方文档](https://vuepress.vuejs.org/)
- [VuePress Theme Plume](https://theme-plume.vuejs.press/)
