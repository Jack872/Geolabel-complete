# 仅用于临时开发环境（Java 18 已 EOL）
FROM openjdk:18.0.2-jdk-slim

WORKDIR /app

# 复制构建好的 Spring Boot JAR
COPY target/*.jar app.jar

# 暴露端口
EXPOSE 1290

# 启动应用
ENTRYPOINT ["java", "-jar", "app.jar"]
