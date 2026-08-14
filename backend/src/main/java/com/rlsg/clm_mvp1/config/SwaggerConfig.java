package com.rlsg.clm_mvp1.config;

import org.springdoc.core.models.GroupedOpenApi;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class SwaggerConfig {

    /**
     * Tenant APIs
     */
    @Bean
    public GroupedOpenApi tenantApi() {

        return GroupedOpenApi.builder()
                .group("tenant")
                .pathsToMatch("/api/v1/tenants/**")
                .build();
    }

    /**
     * User APIs
     */
    @Bean
    public GroupedOpenApi userApi() {

        return GroupedOpenApi.builder()
                .group("user")
                .pathsToMatch("/api/v1/users/**")
                .build();
    }
}