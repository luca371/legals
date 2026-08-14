package com.rlsg.clm_mvp1.user.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Size;

public record UserUpdateRequest(

        @Size(max = 255)
        String name,

        @Email(message = "Invalid email format")
        @Size(max = 255)
        String email,

        @Size(max = 50)
        String mobile,

        @Size(max = 255)
        String federationId,

        @Size(max = 20)
        String language,

        @Size(max = 100)
        String timezone,

        @Size(max = 50)
        String status,

        Boolean active

) {
}