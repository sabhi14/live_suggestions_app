package com.livesuggestions.backend.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.lang.NonNull;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class CorsConfig implements WebMvcConfigurer {

    @Value(
            "${app.cors.allowed-origins:http://localhost:4200,https://live-suggestions-611x08vmo-sabhi14s-projects.vercel.app}"
    )
    private String[] allowedOrigins =
            new String[] {
                    "http://localhost:4200",
                    "https://live-suggestions-611x08vmo-sabhi14s-projects.vercel.app"
            };

    @Override
    public void addCorsMappings(@NonNull CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins(getAllowedOrigins())
                .allowedMethods("GET", "POST", "OPTIONS")
                .allowedHeaders("*");
    }

    @NonNull
    private String[] getAllowedOrigins() {
        if (allowedOrigins == null || allowedOrigins.length == 0) {
            return new String[] { "http://localhost:4200" };
        }
        return allowedOrigins;
    }
}
