# Stage 1 : Build avec Maven
FROM maven:3.9-eclipse-temurin-21 AS builder
WORKDIR /app

COPY pom.xml .
RUN mvn dependency:go-offline -B

COPY src ./src
RUN mvn package -DskipTests -B

# Stage 2 : Image de run légère
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

COPY --from=builder /app/target/*.jar app.jar
RUN mkdir -p images/small images/big

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
