package com.rlsg.clm_mvp1.tenant.mapper;

import com.rlsg.clm_mvp1.tenant.dto.TenantCreateRequest;
import com.rlsg.clm_mvp1.tenant.dto.TenantResponse;
import com.rlsg.clm_mvp1.tenant.entity.Tenant;
import org.springframework.stereotype.Component;

@Component
public class TenantMapper {

    public Tenant toEntity(
            TenantCreateRequest request
    ) {

        Tenant tenant = new Tenant();

        tenant.setName(request.name());
        tenant.setCode(request.code());
        tenant.setEmail(request.email());
        tenant.setMobile(request.mobile());

        tenant.setStatus(
                request.status() != null
                        ? request.status()
                        : "ACTIVE"
        );

        tenant.setActive(
                request.active() != null
                        ? request.active()
                        : true
        );

        return tenant;
    }

    public TenantResponse toResponse(
            Tenant tenant
    ) {

        return new TenantResponse(
                tenant.getId(),
                tenant.getName(),
                tenant.getCode(),
                tenant.getEmail(),
                tenant.getMobile(),
                tenant.getStatus(),
                tenant.getActive(),
                tenant.getCreatedAt(),
                tenant.getUpdatedAt()
        );
    }
}