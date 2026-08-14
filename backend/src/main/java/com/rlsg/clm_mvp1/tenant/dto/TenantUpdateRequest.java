package com.rlsg.clm_mvp1.tenant.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Size;

public record TenantUpdateRequest(

        @Size(max = 200)
        String name,

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