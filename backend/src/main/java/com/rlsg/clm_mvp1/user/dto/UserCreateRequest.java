package com.rlsg.clm_mvp1.user.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.UUID;

public record UserCreateRequest(

        @NotNull(message = "Tenant ID is required")
        UUID tenantId,

        @NotBlank(message = "Username is required")
        @Size(max = 100)
        String username,

        @NotBlank(message = "Name is required")
        @Size(max = 255)
        String name,

        @NotBlank(message = "Email is required")
        @Email(message = "Invalid email format")
        @Size(max = 255)
        String email,

        @Size(max = 50)
        String mobile,

        @Size(max = 255)
        String federationId,

        String password,

        @Size(max = 20)
        String language,

        @Size(max = 100)
        String timezone

) {
}