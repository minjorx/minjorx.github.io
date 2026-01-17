---
title: SpringBoot4接入MicromerterTracing
tags: [SpringBoot,SpringBoot4,Tracing,Mricrometer]
createTime: 2026/01/17 14:22:27
permalink: /blog/vgfuwgih/
---

## 版本信息
- **Spring Boot**: 4.0.1 (截至 2026/01/17 )

## 问题背景
在 Spring Boot 4 中，传统的 Spring Boot 3 Micrometer Tracing 配置方式不再有效，官方文档[Tracing::SpringBoot](https://docs.spring.io/spring-boot/reference/actuator/tracing.html)也未更新。


## 解决方案

### 1. 依赖配置
要成功在 Spring Boot 4 中集成 Micrometer Tracing，需要添加以下依赖：

[Maven::spring-boot-micrometer-tracing-brave](https://mvnrepository.com/artifact/org.springframework.boot/spring-boot-micrometer-tracing-brave)

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-micrometer-tracing-brave</artifactId>
</dependency>
<dependency>
    <groupId>io.micrometer</groupId>
    <artifactId>micrometer-tracing-bridge-brave</artifactId>
</dependency>
```

### 2. 重要说明
- **无需额外配置**：上述依赖配置完成后，追踪功能会自动启用
- **无需引入** `spring-boot-starter-actuator`：Micrometer Tracing 可独立工作
- **自动 MDC 集成**：配置会自动在 MDC 上下文中生效，并将追踪信息输出到日志中

### 3. 数据上报扩展
如需将追踪数据上报到外部系统（如 Jaeger、Zipkin 等），需要根据具体需求引入相应的额外依赖。

## 总结
Spring Boot 4 对 Micrometer Tracing 的集成方式进行了调整，通过正确的依赖组合可以实现无缝集成，无需复杂的配置步骤。