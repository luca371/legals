package com.rlsg.clm_mvp1.user.dto;

import java.time.LocalDateTime;
import java.util.UUID;

public record UserResponse(

        UUID id,

        UUID tenantId,

        String username,

        String name,

        String email,

        String mobile,

        String federationId,

        String language,

        String timezone,

        String status,

        Boolean active,

        LocalDateTime createdAt,

        LocalDateTime updatedAt

) {
}