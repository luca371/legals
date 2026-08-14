package com.rlsg.clm_mvp1.tenant.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record TenantCreateRequest(

        @NotBlank(message = "Tenant name is required")
        @Size(max = 200)
        String name,

        @NotBlank(message = "Tenant code is required")
        @Size(max = 100)
        String code,

        @NotBlank(message = "Email is required")
        @Email(message = "Invalid email format")
        @Size(max = 255)
        String email,

        @Size(max = 30)
        String mobile,

        @Size(max = 30)
        String status,

        Boolean active
) {
}