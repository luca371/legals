package com.rlsg.clm_mvp1.tenant.dto;

import java.time.Instant;
import java.util.UUID;

public record TenantResponse(

        UUID id,

        String name,

        String code,

        String email,

        String mobile,

        String status,

        Boolean active,

        Instant createdAt,

        Instant updatedAt
) {
}