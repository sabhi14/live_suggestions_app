package com.livesuggestions.backend.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.lang.NonNull;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class CorsConfig implements WebMvcConfigurer {

    @Value(
            "${app.cors.allowed-origin-patterns:http://localhost:*,https://*.vercel.app}"
    )
    private String[] allowedOriginPatterns =
            new String[] { "http://localhost:*", "https://*.vercel.app" };

    @Override
    public void addCorsMappings(@NonNull CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOriginPatterns(getAllowedOriginPatterns())
                .allowedMethods("GET", "POST", "OPTIONS")
                .allowedHeaders("*")
                .maxAge(3600);
    }

    @NonNull
    private String[] getAllowedOriginPatterns() {
        if (allowedOriginPatterns == null || allowedOriginPatterns.length == 0) {
            return new String[] { "http://localhost:*" };
        }
        return allowedOriginPatterns;
    }
}
