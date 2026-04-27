FROM eclipse-temurin:17-jdk
WORKDIR /app
COPY . .
RUN chmod +x mvnw || true
RUN if [ -f "./mvnw" ]; then ./mvnw clean package -DskipTests; else mvn clean package -DskipTests; fi
EXPOSE 8080
CMD sh -c 'java -jar target/*.jar'
